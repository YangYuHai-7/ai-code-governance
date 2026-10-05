import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentRuntimeAdapter, createStructuredAgentAdapter } from '../../src/adapters/agents/index.mjs';
import { executeVerificationProcess } from '../../src/adapters/process/index.mjs';
import {
  buildTraceabilityGraph,
  canonicalContractDigest,
  compileRequirement,
  createVerificationPolicy,
  createDeliveryRuntime,
  evaluateDeliveryCompletion,
  evaluateTraceability,
  runVerificationCommand,
} from '../../src/modules/delivery-core/index.mjs';
import { sha256 } from '../../src/shared/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, digest, repositoryFixture, requirementFixture } from '../support/delivery-core-fixtures.mjs';

function memoryStore() {
  const sessions = new Map();
  const events = new Map();
  let interrupted = false;
  return {
    create(session) { sessions.set(session.id, structuredClone(session)); return session; },
    read(id) { return structuredClone(sessions.get(id)); },
    compareAndSwap(id, expected, next) {
      const current = sessions.get(id);
      assert.equal(canonicalContractDigest('session', current), expected);
      sessions.set(id, structuredClone(next));
      if (!interrupted) { interrupted = true; throw Object.assign(new Error('simulated interruption after durable checkpoint'), { code: 'EIO' }); }
      return next;
    },
    appendEvent(id, event) {
      const list = events.get(id) ?? [];
      if (!list.some((entry) => entry.id === event.id)) list.push(structuredClone(event));
      events.set(id, list);
      return event;
    },
  };
}

function structuredCompiler(id) {
  return createStructuredAgentAdapter({
    id,
    capabilities: { structuredRequirement: true },
    async invoke() { return { exitCode: 0, stdout: JSON.stringify(requirementFixture()), stderr: '', durationMs: 1, usage: { inputTokens: 12, outputTokens: 24, cost: 0 } }; },
  });
}

function runtimeAgent(id, requirementDigest) {
  return createAgentRuntimeAdapter({
    id,
    capabilities: { architectureProposal: true, boundedPatch: true, resume: true, usageEvidence: true, cancellation: true },
    prepareTurn(request) { return { prompt: request.prompt, requestDigest: request.semanticDigest }; },
    async invoke(turn) {
      const proposal = turn.prompt.startsWith('architecture ')
        ? { architecture: architectureFixture(requirementDigest) }
        : { files: [{ path: 'src/fixture.mjs', content: 'export function completeFixture() { return "completed"; }\n' }] };
      return { exitCode: 0, stdout: JSON.stringify({ proposal, findings: [] }), stderr: '', usage: { inputTokens: 10, outputTokens: 10, cost: 0 } };
    },
    async cancel(turnId) { return { turnId, cancelled: true }; },
  });
}

function evidence(session, source, id) {
  return {
    schemaVersion: 1, id, sessionId: session.id, source, verificationLevel: 'verified',
    semanticDigest: session.requirementDigest, repositoryDigest: session.repositoryDigest,
    commandDigest: digest, resultDigest: digest, artifactDigests: [], status: 'passed',
  };
}

async function runScenario(agentId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-m1-${agentId}-`));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"delivery-core-scenario"}\n');
  const compiled = await compileRequirement({ requestText: 'Implement one production governed action', adapter: structuredCompiler(`${agentId}.compiler`) });
  assert.equal(compiled.status, 'accepted');
  assert.equal(compiled.processEvidence.semanticApproval, false);

  const requirementDigest = compiled.requirementDigest;
  const store = memoryStore();
  const applied = new Set();
  let verificationRuns = 0;
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent(agentId, requirementDigest)],
    workspace: {
      async apply(_session, key, proposal) {
        assert.deepEqual(proposal.files.map((entry) => entry.path), ['src/fixture.mjs']);
        if (applied.has(key)) return { status: 'already-applied', changedFiles: 0, changedBytes: 0 };
        applied.add(key);
        const content = proposal.files[0].content;
        fs.writeFileSync(path.join(root, 'src', 'fixture.mjs'), content);
        return { status: 'committed', changedFiles: 1, changedBytes: Buffer.byteLength(content) };
      },
    },
    verifier: {
      async run(session) {
        verificationRuns += 1;
        const command = {
          schemaVersion: 1, id: 'root:test', unitId: 'root', cwd: '.',
          argv: verificationRuns === 1
            ? [process.execPath, '-e', 'process.stderr.write("injected technical failure"); process.exit(1)']
            : [process.execPath, '-e', 'import("./src/fixture.mjs").then(m => { if (m.completeFixture() !== "completed") process.exit(1); })'],
          source: { kind: 'manifest', path: 'package.json', sha256: sha256(fs.readFileSync(path.join(root, 'package.json'))) },
          purpose: ['test'], scopeGlobs: ['src/**'], sideEffects: [], trust: { level: 'structurally-trusted', reasons: [] },
        };
        const policy = createVerificationPolicy({
          production: true, timeoutMs: 5000, maxOutputBytes: 4096, allowedSideEffects: [],
          sessionId: session.id, semanticDigest: session.requirementDigest, repositoryDigest: session.repositoryDigest,
        });
        const result = runVerificationCommand(root, command, policy, executeVerificationProcess);
        return { status: result.status, commands: 1, evidence: [result] };
      },
    },
  });
  let session = runtime.start({
    id: `session.${agentId}`, requestText: 'Implement one production governed action', requirement: compiled.requirement,
    architecture: null, authority: authorityFixture(), budgets: budgetsFixture({ maxAgentTurns: 6, maxCommands: 6 }),
    repositorySnapshot: repositoryFixture(), agentId, maxRetries: 2,
  });
  session = await runtime.step(session.id);
  assert.equal(session.state, 'architecture-ready');
  const bindings = {
    requirementDigest: session.requirementDigest, architectureDigest: session.architectureDigest,
    authorityDigest: session.authorityDigest, repositoryDigest: session.repositoryDigest,
  };
  assert.equal(runtime.resume(session.id, bindings).state, 'architecture-ready');
  for (let index = 0; index < 8 && session.state !== 'review-ready'; index += 1) session = await runtime.step(session.id);
  assert.equal(session.state, 'review-ready');
  assert.equal(verificationRuns, 2);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'fixture.mjs'), 'utf8').includes('completeFixture'), true);

  const requirementIds = ['goal.complete', 'rule.once', 'acceptance.fixture'];
  const graph = buildTraceabilityGraph({
    requirement: session.requirement,
    architecture: session.architecture,
    patches: [{ id: 'patch.fixture', path: 'src/fixture.mjs', requirementIds, architectureIds: ['decision.fixture'] }],
    tests: [{ id: 'test.fixture', path: 'test/fixture.test.mjs', requirementIds, evidenceIds: ['evidence.automated'] }],
    evidence: [{ id: 'evidence.automated', status: 'passed', verificationLevel: 'verified' }],
  });
  const traceability = evaluateTraceability(graph);
  const records = [
    evidence(session, 'automated-test', 'evidence.automated'),
    evidence(session, 'independent-review', 'evidence.review'),
    evidence(session, 'human-acceptance', 'evidence.acceptance'),
    evidence(session, 'deployment', 'evidence.deployability'),
  ];
  const completion = evaluateDeliveryCompletion({ session, traceability, evidence: records, profile: 'production' });
  assert.equal(completion.overall, 'complete');
  fs.rmSync(root, { recursive: true, force: true });
  return { requirementDigest: session.requirementDigest, architectureDigest: session.architectureDigest, state: session.state, completion: completion.overall };
}

test('two compatible fake Agents produce equivalent review-ready production outcomes', async () => {
  const first = await runScenario('agent-alpha');
  const second = await runScenario('agent-beta');
  assert.deepEqual(first, second);
});
