import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { shouldAutoOpen } from '../scripts/postinstall-open-config.mjs';

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
    const config = boot.template;
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
    assert.match(page, /id="quick-preview"/);
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
    assert.equal((await request('save', { config: boot.template, expectedSha: null })).status, 200);
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
    const saved = await request('save', { config: chosen.value.template, expectedSha: null });
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
