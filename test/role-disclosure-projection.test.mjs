import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';

test('every generated governance depth projects role disclosure into the ordinary conversation context', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-role-disclosure-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);

  for (const artifactLanguage of ['en', 'zh-CN']) {
    for (const governanceDepth of ['minimal', 'standard', 'complete']) {
      const config = { ...defaultConfig(scan), artifactLanguage, governanceDepth, clients: ['codex'] };
      const artifacts = buildArtifacts(config, scan);
      const entry = artifacts.find((artifact) => artifact.path === 'AGENTS.md')?.content;
      const always = artifacts.find((artifact) => artifact.path.endsWith('00_always.mdc'))?.content;
      assert.ok(entry && always, `${artifactLanguage}/${governanceDepth}: ordinary context is complete`);
      if (artifactLanguage === 'zh-CN') {
        assert.match(entry, /每轮对话.*首条实质回复.*角色.*原因/);
        assert.match(always, /每轮对话.*首条实质回复.*角色.*原因/);
        assert.match(entry, /首行.*当前角色：.*（原因）/);
        assert.match(always, /首行.*当前角色：.*（原因）/);
        assert.match(entry, /角色变化.*继续回复前/);
        assert.match(entry, /不代表.*真人.*审核/);
        assert.match(entry, /即使.*只输出.*也保留角色首行/);
        assert.match(always, /即使.*只输出.*也保留角色首行/);
      } else {
        for (const prose of [entry, always]) {
          assert.match(prose, /every (?:user )?turn.*first substantive (?:response|reply)/i);
          assert.match(prose, /(?:first line.*|starts with.*)Active roles:.*\(reason\)/i);
          assert.match(prose, /(?:role changes.*before continuing|before continuing.*role changes)/i);
          assert.match(prose, /(?:does not mean.*human review|imply no human review)/i);
          assert.match(prose, /(?:even for.*only yes.*keep the role line|even for one-word requests)/i);
        }
      }
    }
  }
});

test('the AICG Skill instructs the assistant to disclose actual roles on each turn', () => {
  const skill = fs.readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /every user turn.*first substantive response.*active role.*why/i);
  assert.match(skill, /first line.*Active roles:.*\(reason\)/i);
  assert.match(skill, /首行.*当前角色：.*（原因）/);
  assert.match(skill, /role changes.*before continuing/i);
  assert.match(skill, /does not mean.*human review/i);
  assert.match(skill, /even if.*only.*must not omit the role line/i);
});
