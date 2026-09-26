import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { shouldAutoOpen } from '../scripts/postinstall-open-config.mjs';
import { detectInstalledClients, locateDroppedDirectory, nativePickerCommand } from '../src/cli/commands/configuration-web.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageRoot, 'bin/aicg.js');

function start(root, stateHome, cwd = packageRoot, extraEnv = {}) {
  const args = [bin, 'config', 'open', ...(root === null ? [] : [root]), '--no-open', '--json'];
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(stateHome ? { XDG_CONFIG_HOME: stateHome } : {}), ...extraEnv } });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 20000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n').find((value) => value.startsWith('{"url"'));
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line).url); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
  });
  return { child, ready };
}

test('visual editor serves loopback UI and enforces save, preview, exact approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-'));
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    assert.match(url, /^http:\/\/127\.0\.0\.1:/);
    const page = await (await fetch(url)).text();
    assert.match(page, /上传配置 JSON/);
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body, session = token, origin = url.slice(0, -1)) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST', headers: {
        'x-aicg-session': session, ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }),
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    assert.equal((await request('bootstrap', undefined, 'wrong')).status, 403);
    assert.equal((await request('save', {}, token, 'https://foreign.example')).status, 403);
    const { value: boot } = await request('bootstrap');
    assert.equal(boot.sha, null);
    assert.equal(boot.configSource, 'scan');
    assert.equal(boot.assessment.codebase.lifecycle.value, 'greenfield');
    assert.equal(boot.scanComplete, true);
    // The tool chooser is curated and ordered, and a greenfield project has no code to scan,
    // so its stacks start unselected for the owner to choose.
    assert.deepEqual(boot.agents.map((agent) => agent.id), ['deepseek', 'codex', 'cursor', 'claude-code', 'github-copilot']);
    assert.deepEqual(boot.template.stacks, []);
    // A greenfield owner cannot save without choosing a stack; the scanner fallback is an
    // explicit choice here, not a default.
    const config = { ...boot.template, stacks: ['generic-unknown'] };
    assert.equal((await request('apply', { planHash: 'stale' })).status, 409);
    assert.equal((await request('validate', { config: { ...config, testing: { ...config.testing, caseRoot: '/outside' } } })).status, 400);
    assert.equal(fs.existsSync(path.join(root, 'aicg.config.json')), false);
    assert.equal((await request('validate', { config })).status, 200);
    const saved = await request('save', { config, expectedSha: null });
    assert.equal(saved.status, 200);
    assert.ok(fs.existsSync(path.join(root, 'aicg.config.json')));
    assert.equal((await request('save', { config, expectedSha: null })).status, 409);
    const preview = await request('preview', {});
    assert.equal(preview.status, 200);
    assert.match(preview.value.planHash, /^[a-f0-9]{64}$/);
    assert.equal((await request('apply', { planHash: 'wrong' })).status, 409);
    fs.appendFileSync(path.join(root, 'aicg.config.json'), '\n');
    assert.equal((await request('apply', { planHash: preview.value.planHash })).status, 409);
    const freshPreview = await request('preview', {});
    assert.equal(freshPreview.status, 200);
    const applied = await request('apply', { planHash: freshPreview.value.planHash });
    assert.equal(applied.status, 200, JSON.stringify(applied.value));
    assert.ok(fs.existsSync(path.join(root, '.ai-governance/config.json')));
    assert.equal((await request('apply', { planHash: freshPreview.value.planHash })).status, 409);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('existing project reuses recorded governance choices after selecting its directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-existing-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-existing-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"existing-app"}\n');
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    assert.match(page, /id="project-summary"/);
    assert.match(page, /id="save-preview"/);
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const initial = await request('bootstrap');
    assert.equal(initial.value.assessment.codebase.lifecycle.value, 'existing');
    assert.equal(initial.value.scanComplete, true);
    assert.equal(initial.value.template.initialization.existingCodeStrategy, 'keep-existing');
    const config = { ...initial.value.template, clients: ['claude-code'],
      clientSupport: { mode: 'selected', selectedClients: ['claude-code'], source: 'config' } };
    assert.equal((await request('save', { config, expectedSha: null })).status, 200);
    const preview = await request('preview', {});
    assert.equal(preview.status, 200);
    const applied = await request('apply', { planHash: preview.value.planHash });
    assert.equal(applied.status, 200, JSON.stringify(applied.value));
    fs.rmSync(path.join(root, 'aicg.config.json'));
    const reused = await request('bootstrap');
    assert.equal(reused.value.configSource, 'managed');
    assert.equal(reused.value.sha, null);
    assert.deepEqual(reused.value.template.clients, ['claude-code']);
    assert.equal(reused.value.template.initialization.existingCodeStrategy, 'keep-existing');
    assert.equal((await request('save', { config: reused.value.template, expectedSha: null })).status, 200);
    assert.equal((await request('preview', {})).status, 200);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('the page defaults the tool selection to locally installed clients in curated order', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-detect-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-detect-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-home-detect-'));
  fs.mkdirSync(path.join(fakeHome, '.cursor'));
  fs.mkdirSync(path.join(fakeHome, '.dsh'));
  const { child, ready } = start(root, stateHome, packageRoot, { HOME: fakeHome, PATH: '/usr/bin:/bin' });
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    assert.deepEqual(boot.agents.map((agent) => agent.id), ['deepseek', 'codex', 'cursor', 'claude-code', 'github-copilot']);
    // Detection keeps registry order internally, and the curated list is what the page renders.
    assert.deepEqual(boot.detectedClients, ['cursor', 'deepseek']);
    assert.deepEqual(boot.template.clients, ['cursor', 'deepseek']);
    assert.deepEqual(boot.template.clientSupport.selectedClients, ['cursor', 'deepseek']);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('an applied governance framework is restored even when a different editable draft exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-restore-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-restore-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"restore-app"}\n');
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    const applied = {
      ...boot.template,
      clients: ['deepseek'],
      clientSupport: { mode: 'selected', selectedClients: ['deepseek'], source: 'config' },
      governanceDepth: 'standard',
      domainConstraints: ['applied constraint'],
    };
    assert.equal((await request('save', { config: applied, expectedSha: boot.sha })).status, 200);
    const preview = await request('preview', {});
    assert.equal((await request('apply', { planHash: preview.value.planHash })).status, 200);
    // A later editable draft (for example a manual aicg config init) must not shadow the
    // governance that was actually applied.
    const draft = { ...boot.template, clients: ['codex'], clientSupport: { mode: 'selected', selectedClients: ['codex'], source: 'config' } };
    fs.writeFileSync(path.join(root, 'aicg.config.json'), JSON.stringify(draft, null, 2) + '\n');
    const restored = await request('bootstrap');
    assert.equal(restored.value.configSource, 'managed');
    assert.deepEqual(restored.value.template.clients, ['deepseek']);
    assert.equal(restored.value.template.governanceDepth, 'standard');
    assert.deepEqual(restored.value.template.domainConstraints, ['applied constraint']);
    assert.ok(fs.existsSync(path.join(root, 'aicg.config.json')), 'the draft stays on disk');
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('a drifted managed config is reported read-only and refuses preview instead of rewriting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-drift-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-drift-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"drift-app"}\n');
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    assert.equal((await request('save', { config: boot.template, expectedSha: boot.sha })).status, 200);
    const preview = await request('preview', {});
    assert.equal((await request('apply', { planHash: preview.value.planHash })).status, 200);
    const configPath = path.join(root, '.ai-governance/config.json');
    const trusted = fs.readFileSync(configPath, 'utf8');
    assert.equal((await request('bootstrap')).value.managedTrust.state, 'trusted');

    const drifted = JSON.parse(trusted);
    drifted.domainConstraints = ['owner edit after approval'];
    fs.writeFileSync(configPath, JSON.stringify(drifted, null, 2) + '\n');
    const afterDrift = await request('bootstrap');
    assert.equal(afterDrift.value.managedTrust.state, 'drifted');
    assert.match(afterDrift.value.managedTrust.expectedSha, /^[a-f0-9]{64}$/);
    assert.match(afterDrift.value.managedTrust.actualSha, /^[a-f0-9]{64}$/);
    assert.notEqual(afterDrift.value.managedTrust.expectedSha, afterDrift.value.managedTrust.actualSha);
    // The write gate still refuses, and the page never rewrites the drifted baseline.
    const refused = await request('preview', {});
    assert.equal(refused.status, 400);
    assert.match(refused.value.error, /drifted/);
    assert.equal(fs.readFileSync(configPath, 'utf8'), JSON.stringify(drifted, null, 2) + '\n');

    // A failed rebuild leaves the editable draft byte-identical, so the page's sha stays valid.
    const failedRebuild = await request('rebaseline', {
      config: { ...afterDrift.value.template, testing: { ...afterDrift.value.template.testing, caseRoot: '/outside' } },
      expectedSha: afterDrift.value.sha,
    });
    assert.equal(failedRebuild.status, 400);
    assert.equal((await request('bootstrap')).value.sha, afterDrift.value.sha);

    // One-click owner-confirmed rebuild: back up the drifted file, regenerate config + manifest.
    const rebuilt = await request('rebaseline', { config: afterDrift.value.template, expectedSha: afterDrift.value.sha });
    assert.equal(rebuilt.status, 200, JSON.stringify(rebuilt.value));
    assert.equal(rebuilt.value.rebaselined, true);
    assert.match(rebuilt.value.backupPath, /^reports\/aicg\/rebaseline-backup\//);
    assert.equal(fs.readFileSync(path.join(root, rebuilt.value.backupPath), 'utf8'), JSON.stringify(drifted, null, 2) + '\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).domainConstraints, ['owner edit after approval']);
    assert.equal((await request('bootstrap')).value.managedTrust.state, 'trusted');
    assert.equal((await request('preview', {})).status, 200);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('visual apply preserves a selected Codex reviewer while suppressing post-generation writes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-review-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-review-'));
  const { child, ready } = start(root, stateHome, packageRoot, { PATH: '/usr/bin:/bin' });
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    const config = {
      ...boot.template,
      stacks: ['generic-unknown'],
      clients: ['codex'],
      clientSupport: { mode: 'selected', selectedClients: ['codex'], source: 'config' },
      features: { ...boot.template.features, aiAssist: true },
    };
    assert.equal((await request('save', { config, expectedSha: null })).status, 200);
    const preview = await request('preview', {});
    const applied = await request('apply', { planHash: preview.value.planHash });
    assert.equal(applied.status, 200, JSON.stringify(applied.value));
    const managed = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
    assert.equal(managed.features.aiAssist, true);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('visual apply replaces colliding governance files and skips uninitialized submodules', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-collision-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-collision-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs/ai/policies'), { recursive: true });
  fs.mkdirSync(path.join(root, 'optional-client'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"existing-app"}\n');
  fs.writeFileSync(path.join(root, 'src/app.mjs'), 'export const ready = true;\n');
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "optional-client"]\n\tpath = optional-client\n\turl = git@example.invalid:optional-client.git\n');
  fs.writeFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'version: 1\nprofiles:\n  custom:\n    level: L1\n');
  fs.writeFileSync(path.join(root, 'docs/ai/policies/00_always.mdc'), 'User-owned text that must be in the preview.\n');
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    assert.equal(boot.assessment.codebase.lifecycle.value, 'existing');
    assert.equal(boot.scanComplete, true);
    const saved = await request('save', { config: boot.template, expectedSha: null });
    assert.equal(saved.status, 200, JSON.stringify(saved.value));
    const preview = await request('preview', {});
    assert.equal(preview.status, 200, JSON.stringify(preview.value));
    assert.deepEqual(preview.value.conflicts, []);
    assert.deepEqual(preview.value.skippedMembers, ['optional-client']);
    assert.ok(preview.value.files.some((entry) => entry.path === 'docs/ai/context-map.yaml' && entry.action === 'replace-owned'));
    assert.ok(preview.value.files.some((entry) => entry.path === 'docs/ai/policies/00_always.mdc' && entry.action === 'replace-owned'));
    const applied = await request('apply', { planHash: preview.value.planHash });
    assert.equal(applied.status, 200, JSON.stringify(applied.value));
    assert.match(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8'), /behavior_change:/);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.mjs'), 'utf8'), 'export const ready = true;\n');
    assert.equal(fs.existsSync(path.join(root, 'optional-client/.git')), false);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('visual apply refuses foreign governance before writing and leaves the project untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-check-failure-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-check-failure-'));
  fs.mkdirSync(path.join(root, '.agents/skills/foreign'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/foreign/SKILL.md'), '# Foreign skill\n');
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    assert.match(page, /progress\.css/);
    assert.match(page, /handoff-text/);
    assert.match((await (await fetch(new URL('progress.css', url))).text()), /aicg-spin/);
    assert.match((await (await fetch(new URL('app.js', url))).text()), /handoffPrompt/);
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    assert.equal((await request('save', { config: { ...boot.template, stacks: ['generic-unknown'] }, expectedSha: null })).status, 200);
    const preview = await request('preview', {});
    assert.equal(preview.status, 200, JSON.stringify(preview.value));
    // The foreign Skill is a pre-write decision the owner has not made yet, so the preview
    // surfaces it and disables apply instead of generating and then rolling back 100+ files.
    assert.ok(preview.value.conflicts.some((entry) => entry.includes('--adopt-foreign-governance')));
    const applied = await request('apply', { planHash: preview.value.planHash });
    assert.equal(applied.status, 400);
    assert.match(applied.value.error, /--adopt-foreign-governance/);
    assert.equal(fs.existsSync(path.join(root, '.ai-governance/config.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'docs/ai')), false);
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
    assert.equal(fs.readFileSync(path.join(root, '.agents/skills/foreign/SKILL.md'), 'utf8'), '# Foreign skill\n');
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('visual apply governs every checked-out family member under one combined approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-family-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-family-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'modules/frontend/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const app = true;\n');
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "frontend"]\n\tpath = modules/frontend\n\turl = https://example.invalid/frontend.git\n');
  fs.writeFileSync(path.join(root, 'modules/frontend/.git'), 'gitdir: ../../.git/modules/modules/frontend\n');
  fs.writeFileSync(path.join(root, 'modules/frontend/package.json'), JSON.stringify({ name: 'frontend', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(root, 'modules/frontend/src/App.tsx'), 'export const App = () => null;\n');
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const { value: boot } = await request('bootstrap');
    assert.equal(boot.repositoryFamily.family, true);
    assert.deepEqual(boot.repositoryFamily.members, ['modules/frontend']);
    assert.equal((await request('save', { config: boot.template, expectedSha: null })).status, 200);

    const preview = await request('preview', {});
    assert.equal(preview.status, 200, JSON.stringify(preview.value));
    assert.equal(preview.value.family, true);
    assert.deepEqual(preview.value.members, ['modules/frontend']);
    assert.deepEqual(preview.value.units.map((unit) => unit.path), ['modules/frontend', '.']);
    assert.ok(preview.value.files.some((entry) => entry.unit === 'modules/frontend' && entry.path.startsWith('modules/frontend/')));
    assert.ok(preview.value.files.some((entry) => entry.unit === '.'));

    const applied = await request('apply', { planHash: preview.value.planHash });
    assert.equal(applied.status, 200, JSON.stringify(applied.value));
    assert.equal(applied.value.family, true);
    assert.equal(applied.value.units.every((unit) => unit.governanceCheck === 'pass'), true);
    assert.ok(fs.existsSync(path.join(root, '.ai-governance/manifest.json')));
    assert.ok(fs.existsSync(path.join(root, 'modules/frontend/.ai-governance/manifest.json')));
    const parentManifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
    assert.equal(parentManifest.files.some((entry) => entry.path.startsWith('modules/frontend/')), false);
    assert.equal((await request('apply', { planHash: preview.value.planHash })).status, 409);

    // A drifted family baseline rebuilds every unit under one owner-confirmed action.
    const rootConfigPath = path.join(root, '.ai-governance/config.json');
    const familyDrifted = JSON.parse(fs.readFileSync(rootConfigPath, 'utf8'));
    familyDrifted.domainConstraints = ['family drift'];
    fs.writeFileSync(rootConfigPath, `${JSON.stringify(familyDrifted, null, 2)}\n`);
    const driftedBoot = await request('bootstrap');
    assert.equal(driftedBoot.value.managedTrust.state, 'drifted');
    const rebuilt = await request('rebaseline', { config: driftedBoot.value.template, expectedSha: driftedBoot.value.sha });
    assert.equal(rebuilt.status, 200, JSON.stringify(rebuilt.value));
    assert.equal(rebuilt.value.family, true);
    assert.ok(rebuilt.value.backupPaths.length >= 1);
    assert.equal(rebuilt.value.units.every((unit) => unit.governanceCheck === 'pass'), true);
    assert.equal((await request('bootstrap')).value.managedTrust.state, 'trusted');
    // The post-rebuild sha is the one the page holds, so the next save must not 409.
    const afterRebuild = await request('bootstrap');
    assert.equal(afterRebuild.value.sha, rebuilt.value.sha);
    assert.equal((await request('save', { config: afterRebuild.value.template, expectedSha: afterRebuild.value.sha })).status, 200);
    assert.equal((await request('preview', {})).status, 200);
    assert.equal((await request('close', {})).status, 200);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

test('pathless launch selects projects visually, remembers recent roots, and invalidates cross-project approval', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-picker-'));
  const stateHome = path.join(fixture, 'state');
  const first = path.join(fixture, 'first project');
  const second = path.join(fixture, 'second project');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  const canonicalFirst = fs.realpathSync(first);
  const canonicalSecond = fs.realpathSync(second);
  const { child, ready } = start(null, stateHome, fixture);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    assert.match(page, /浏览文件夹/);
    assert.match(page, /最近使用/);
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL(`api/${route}`, url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const empty = await request('bootstrap');
    assert.equal(empty.status, 200);
    assert.equal(empty.value.root, null);
    assert.deepEqual(empty.value.recent, []);
    assert.equal((await request('save', { config: {}, expectedSha: null })).status, 409);
    const listing = await request(`directories?path=${encodeURIComponent(fixture)}`);
    assert.equal(listing.status, 200);
    assert.ok(listing.value.directories.includes('first project'));
    assert.ok(listing.value.directories.includes('second project'));
    assert.equal((await request('project', { path: 'relative/path' })).status, 400);
    assert.equal((await request('project', { path: path.parse(fixture).root })).status, 400);
    const chosen = await request('project', { path: first });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.value.root, canonicalFirst);
    assert.deepEqual(chosen.value.recent, [canonicalFirst]);
    const saved = await request('save', { config: { ...chosen.value.template, stacks: ['generic-unknown'] }, expectedSha: null });
    assert.equal(saved.status, 200);
    const preview = await request('preview', {});
    assert.equal(preview.status, 200);
    const switched = await request('project', { path: second });
    assert.equal(switched.status, 200);
    assert.equal(switched.value.root, canonicalSecond);
    assert.deepEqual(switched.value.recent, [canonicalSecond, canonicalFirst]);
    assert.equal((await request('apply', { planHash: preview.value.planHash })).status, 409);
    assert.equal(fs.existsSync(path.join(second, 'aicg.config.json')), false);
    assert.equal((await request('close', {})).status, 200);
  } finally { child.kill(); }
  const restarted = start(null, stateHome, fixture);
  try {
    const url = await restarted.ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const response = await fetch(new URL('api/bootstrap', url), { headers: { 'x-aicg-session': token } });
    assert.deepEqual((await response.json()).recent, [canonicalSecond, canonicalFirst]);
    await fetch(new URL('api/close', url), { method: 'POST', headers: { 'x-aicg-session': token, origin: url.slice(0, -1) } });
  } finally {
    restarted.child.kill();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('postinstall opens the picker in interactive desktop installs, including global installs', () => {
  const env = { DISPLAY: ':0' };
  assert.equal(shouldAutoOpen({ env, platform: 'linux' }), true);
  assert.equal(shouldAutoOpen({ env: { ...env, npm_config_global: 'true' }, platform: 'linux' }), true);
  assert.equal(shouldAutoOpen({ env: { ...env, CI: '1' }, platform: 'linux' }), false);
  assert.equal(shouldAutoOpen({ env: { ...env, AICG_NO_AUTO_OPEN: '1' }, platform: 'linux' }), false);
  assert.equal(shouldAutoOpen({ env: {}, platform: 'linux' }), false);
  assert.equal(shouldAutoOpen({ env: {}, platform: 'darwin' }), true);
});

test('detected clients combine PATH commands with desktop app and config paths', () => {
  const registry = { agents: [
    { id: 'codex', detect_commands: ['codex'], detect_paths: ['~/.codex', '/Applications/Codex.app'] },
    { id: 'claude-code', detect_commands: ['claude'], detect_paths: ['~/.claude'] },
    { id: 'cursor', detect_commands: ['cursor-agent'], detect_paths: ['~/.cursor'] },
    { id: 'generic', detect_commands: [], detect_paths: [] },
    { id: 'deepseek', detect_commands: ['dsh'], detect_paths: ['~/.dsh'] },
  ] };
  const detected = detectInstalledClients(registry, {
    commandExists: (command) => command === 'dsh',
    pathExists: (candidate) => candidate === '/home/owner/.codex',
    home: '/home/owner',
  });
  assert.deepEqual(detected, [
    { id: 'codex', via: 'path', path: '/home/owner/.codex' },
    { id: 'deepseek', via: 'command' },
  ]);
});

test('a PATH command wins over a path match and generic is never auto-selected', () => {
  const registry = { agents: [
    { id: 'codex', detect_commands: ['codex'], detect_paths: ['~/.codex'] },
    { id: 'generic', detect_commands: [], detect_paths: [] },
  ] };
  const detected = detectInstalledClients(registry, {
    commandExists: (command) => command === 'codex',
    pathExists: () => true,
    home: '/home/owner',
  });
  assert.deepEqual(detected, [{ id: 'codex', via: 'command' }]);
});

test('platform paths are scoped and expanded per operating system', () => {
  const registry = { agents: [{ id: 'cursor', detect_commands: ['cursor-agent'], detect_paths: ['~/.cursor'],
    detect_paths_by_platform: {
      darwin: ['/Applications/Cursor.app'],
      win32: ['%LOCALAPPDATA%/Programs/cursor/Cursor.exe'],
      linux: ['/usr/bin/cursor', '~/.local/share/applications/cursor.desktop'],
    } }] };

  const darwin = detectInstalledClients(registry, {
    commandExists: () => false, pathExists: (candidate) => candidate === '/Applications/Cursor.app',
    home: '/Users/owner', platform: 'darwin', env: {},
  });
  assert.deepEqual(darwin, [{ id: 'cursor', via: 'path', path: '/Applications/Cursor.app' }]);

  const winCandidates = [];
  const win32 = detectInstalledClients(registry, {
    commandExists: () => false,
    pathExists: (candidate) => { winCandidates.push(candidate); return candidate === 'C:/Users/owner/AppData/Local/Programs/cursor/Cursor.exe'; },
    home: 'C:/Users/owner', platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local' },
  });
  assert.deepEqual(winCandidates, ['C:/Users/owner/.cursor', 'C:/Users/owner/AppData/Local/Programs/cursor/Cursor.exe']);
  assert.deepEqual(win32, [{ id: 'cursor', via: 'path', path: 'C:/Users/owner/AppData/Local/Programs/cursor/Cursor.exe' }]);

  const linux = detectInstalledClients(registry, {
    commandExists: () => false, pathExists: (candidate) => candidate === '/home/owner/.local/share/applications/cursor.desktop',
    home: '/home/owner', platform: 'linux', env: {},
  });
  assert.deepEqual(linux, [{ id: 'cursor', via: 'path', path: '/home/owner/.local/share/applications/cursor.desktop' }]);
});

test('POSIX $VAR and Windows %VAR% both expand, and an unknown variable stays literal', () => {
  const registry = { agents: [
    { id: 'codex', detect_commands: [], detect_paths: ['$XDG_CONFIG_HOME/codex', '%MISSING%/codex'] },
  ] };
  const seen = [];
  const detected = detectInstalledClients(registry, {
    commandExists: () => false, pathExists: (candidate) => { seen.push(candidate); return false; },
    home: '/home/owner', platform: 'linux', env: { XDG_CONFIG_HOME: '/home/owner/.config' },
  });
  assert.deepEqual(seen, ['/home/owner/.config/codex', '%MISSING%/codex']);
  assert.deepEqual(detected, []);
});

test('the native folder picker uses the dialog each platform ships', () => {
  const yes = () => true;
  const no = () => false;
  assert.equal(nativePickerCommand('darwin', { hasCommand: yes }).command, 'osascript');
  assert.equal(nativePickerCommand('darwin', { hasCommand: no }), null);
  assert.equal(nativePickerCommand('win32', { hasCommand: yes }).command, 'powershell.exe');
  assert.equal(nativePickerCommand('win32', { hasCommand: no }), null);
  assert.equal(nativePickerCommand('linux', { hasCommand: (command) => command === 'zenity' }).command, 'zenity');
  assert.equal(nativePickerCommand('linux', { hasCommand: (command) => command === 'kdialog' }).command, 'kdialog');
  assert.equal(nativePickerCommand('linux', { hasCommand: no }), null);
  assert.equal(nativePickerCommand('aix', { hasCommand: yes }), null);
});

test('a dropped directory is located by name and child fingerprint', () => {
  const tree = {
    '/home/owner': [{ name: 'Desktop', dir: true }, { name: 'notes.txt', dir: false }],
    '/home/owner/Desktop': [{ name: 'code', dir: true }],
    '/home/owner/Desktop/code': [{ name: 'memora', dir: true }, { name: 'other', dir: true }],
    '/home/owner/Desktop/code/memora': [{ name: 'package.json', dir: false }, { name: 'src', dir: true }],
    '/home/owner/Desktop/code/other': [{ name: 'readme.md', dir: false }],
  };
  const list = (directory) => tree[directory] ?? [];
  const matches = locateDroppedDirectory(
    { name: 'memora', entries: [{ name: 'package.json', dir: false }, { name: 'src', dir: true }] },
    { home: '/home/owner', list },
  );
  assert.deepEqual(matches, ['/home/owner/Desktop/code/memora']);
});

test('a same-name directory with a different fingerprint is rejected', () => {
  const tree = {
    '/home/owner': [{ name: 'a', dir: true }, { name: 'b', dir: true }],
    '/home/owner/a': [{ name: 'memora', dir: true }],
    '/home/owner/a/memora': [{ name: 'one.txt', dir: false }],
    '/home/owner/b': [{ name: 'memora', dir: true }],
    '/home/owner/b/memora': [{ name: 'two.txt', dir: false }],
  };
  const list = (directory) => tree[directory] ?? [];
  const matches = locateDroppedDirectory(
    { name: 'memora', entries: [{ name: 'two.txt', dir: false }] },
    { home: '/home/owner', list },
  );
  assert.deepEqual(matches, ['/home/owner/b/memora']);
});

test('a recent project matches even when the browser returned no children', () => {
  const matches = locateDroppedDirectory(
    { name: 'memora', entries: [] },
    { home: null, recent: ['/Volumes/work/memora'], list: () => [] },
  );
  assert.deepEqual(matches, ['/Volumes/work/memora']);
});

test('progress stays readable while a long mutating operation holds the write lock', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-web-progress-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-state-'));
  // Enough files that the scan and plan behind /api/save hold the write lock for a while, so a
  // concurrent read overlaps the lock.
  for (let i = 0; i < 3000; i += 1) {
    const directory = path.join(root, 'src', 'module' + (i % 50));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'file' + i + '.ts'), 'export const value' + i + ' = ' + i + ';' + String.fromCharCode(10));
  }
  const { child, ready } = start(root, stateHome);
  try {
    const url = await ready;
    const page = await (await fetch(url)).text();
    const token = page.match(/name="aicg-session" content="([a-f0-9]+)"/)[1];
    const request = async (route, body) => {
      const response = await fetch(new URL('api/' + route, url), { method: body === undefined ? 'GET' : 'POST', headers: {
        'x-aicg-session': token, ...(body === undefined ? {} : { origin: url.slice(0, -1), 'content-type': 'application/json' }),
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const boot = (await request('bootstrap')).value;
    const config = { ...boot.template, stacks: boot.template.stacks.length ? boot.template.stacks : ['generic-unknown'] };
    let saving = true;
    const save = request('save', { config, expectedSha: boot.sha }).then((result) => { saving = false; return result; });
    let overlapped = false;
    let sawConflict = false;
    for (let attempt = 0; attempt < 600 && saving; attempt += 1) {
      const progress = await request('progress');
      if (progress.status === 409) sawConflict = true;
      if (saving && progress.status === 200) overlapped = true;
    }
    const saved = await save;
    assert.equal(saved.status, 200, JSON.stringify(saved.value));
    assert.equal(sawConflict, false, 'a read-only progress request must never be refused by the write lock');
    assert.equal(overlapped, true, 'progress must be readable while the save holds the write lock');
    await request('close', {});
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
});

