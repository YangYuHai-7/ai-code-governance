import { usageError } from '../../kernel/index.mjs';

export const SKILL_QUALITY_CONTRACT_VERSION = 1;

const REQUIRED_SECTIONS = [
  'When to use',
  'When not to use',
  'Required invariants',
  'Decision flow',
  'Exceptions and escalation',
  'Verification matrix',
  'Project evidence boundary',
  'Sources',
];

const IMPLEMENTATION_SECTIONS = [
  'Correct implementation shape',
  'Incorrect implementation shape',
];

// A fenced block made of bare paths is not an implementation example. Require the correct
// shape to carry a real code construct so a generated Skill teaches the shape instead of
// telling the reader to go read another file.
// Script constructs or component/markup syntax both prove the fence holds a real excerpt
// rather than a list of file paths. A pure template is real code too.
const CODE_TOKEN = /(?:=>|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bdef\b|\bfunc\b|\breturn\b|\bimport\b|\brequire\b|\bmodule\.exports\b|\bexport\b|\bpublic\b|\bprivate\b|\bawait\b|\bnew\b|\([^)\n]*\)\s*\{|<\/?[A-Za-z][\w:-]*|v-[a-z]+|@[a-z][\w-]*|:[A-Za-z][\w-]*=)/;
const RULE_REFERENCE = /`[^`]*[./][^`]*`/;

function frontMatterBlock(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : '';
}

// A Skill that cites a line number or an inline content digest breaks the first time the
// referenced file moves. Edge edits reflow line numbers, so `Foo.java:42` silently points at
// unrelated code and the reader cannot tell that it drifted. Cite stable targets instead:
// a path plus a symbol name (class, function, exported member), or the machine-readable
// catalog that owns digests.
const LINE_NUMBER_REFERENCE = /[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|java|kt|kts|scala|py|go|rb|rs|php|cs|vue|svelte|sql|json|ya?ml|md|css|scss|html|xml|gradle|toml|sh|proto):\d+(?:-\d+)?/g;

// Machine comments carry the receiving tool its own metadata (evidenceHash, generated
// markers). They are not prose a reader follows, so they are exempt from the style rules.
function proseBody(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, '');
}

function sectionBody(markdown, heading) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = start + marker.length;
  const next = markdown.indexOf('\n## ', bodyStart);
  return markdown.slice(bodyStart, next < 0 ? markdown.length : next).trim();
}

// Real code legitimately contains words such as "placeholder" (a UI input attribute) or a TODO
// comment. Only the prose around a fenced example can carry an unfilled template placeholder, so
// strip the code before looking for placeholder sentinels.
function outsideFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function frontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const values = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

/**
 * Audit semantic Skill structure instead of rewarding word count. The workflow
 * profile intentionally does not require code samples; implementation Skills do.
 */
export function auditSkillQuality(markdown, { profile = 'implementation', id = '<unknown>' } = {}) {
  const issues = [];
  const metadata = frontMatter(markdown);
  if (!metadata?.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)) issues.push('front matter needs a safe kebab-case name');
  if (!metadata?.description || metadata.description.length < 24) issues.push('front matter description must state a concrete trigger');

  const required = [...REQUIRED_SECTIONS, ...(profile === 'implementation' ? IMPLEMENTATION_SECTIONS : [])];
  for (const heading of required) {
    const body = sectionBody(markdown, heading);
    if (!body) issues.push(`missing or empty section: ${heading}`);
  }

  const trigger = sectionBody(markdown, 'When to use');
  const nonTrigger = sectionBody(markdown, 'When not to use');
  if (!/^- /m.test(trigger)) issues.push('When to use needs explicit trigger cases');
  if (!/^- /m.test(nonTrigger)) issues.push('When not to use needs explicit non-trigger cases');

  const flow = sectionBody(markdown, 'Decision flow');
  if ((flow.match(/^\d+\. /gm) ?? []).length < 3) issues.push('Decision flow needs at least three ordered decisions');

  const matrix = sectionBody(markdown, 'Verification matrix');
  if (!/^\|.+\|$/m.test(matrix) || !/Expected|期望/.test(matrix)) issues.push('Verification matrix needs explicit scenario and expected-result columns');
  if (!/not yet verified|unverified|未验证|尚未验证/i.test(matrix) && !/`[^`]+`/.test(matrix)) issues.push('Verification matrix must name a command or mark it unverified');

  if (profile === 'implementation') {
    for (const heading of IMPLEMENTATION_SECTIONS) {
      const body = sectionBody(markdown, heading);
      const blocks = body.match(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g) ?? [];
      if (blocks.length !== 1 || blocks[0].split('\n').length < 4) issues.push(`${heading} needs one non-trivial fenced example`);
      const language = blocks[0]?.match(/^```([a-zA-Z0-9_-]*)\n/)?.[1] ?? '';
      if (!language || (['text', 'plain', 'txt'].includes(language) && !CODE_TOKEN.test(blocks[0]))) issues.push(`${heading} must fence real code, not ${language ? '`' + language + '`' : 'a bare'} text`);
      if (/\bTODO\b|\bFIXME\b|fill this|example only|<placeholder>|placeholder text/i.test(outsideFences(body))) issues.push(`${heading} contains placeholder text`);
    }
    if (!CODE_TOKEN.test(sectionBody(markdown, 'Correct implementation shape'))) issues.push('Correct implementation shape needs a real code excerpt, not a path list');
  }

  const prose = proseBody(markdown);
  const lineReferences = [...new Set(prose.match(LINE_NUMBER_REFERENCE) ?? [])];
  if (lineReferences.length > 0) {
    issues.push(`line-number references drift when code moves, so cite a path plus symbol instead: ${lineReferences.slice(0, 3).join(', ')}`);
  }
  if (/\b[0-9a-f]{64}\b/i.test(prose)) {
    issues.push('content digests belong to the machine-readable catalog, not to Skill prose');
  }

  const score = Math.max(0, 100 - issues.length * 10);
  return {
    schemaVersion: SKILL_QUALITY_CONTRACT_VERSION,
    id,
    profile,
    status: issues.length === 0 ? 'pass' : 'fail',
    score,
    issues,
  };
}

export function assertSkillQuality(markdown, options) {
  const report = auditSkillQuality(markdown, options);
  if (report.status !== 'pass') throw usageError(`Generated Skill ${report.id} failed the quality contract: ${report.issues.join('; ')}`);
  return report;
}

/**
 * Rules are the always-on and profile-loaded constraints. A rule that carries no repository
 * reference is a boundary statement, not a governance rule, so it fails the contract instead
 * of shipping as filler.
 */
export function auditRuleQuality(markdown, { id = '<unknown>' } = {}) {
  const issues = [];
  const metadata = frontMatter(markdown);
  const selector = frontMatterBlock(markdown);
  if (metadata?.alwaysApply !== 'true' && !/\bprofiles:|\bloadWhen:/.test(selector)) issues.push('rule front matter needs alwaysApply or a profile/loadWhen selector');
  const body = proseBody(markdown);
  if (!RULE_REFERENCE.test(body)) issues.push('rule needs at least one concrete repository reference');
  if (/\$\{|<placeholder>/i.test(body)) issues.push('rule contains an unresolved placeholder');
  return { schemaVersion: SKILL_QUALITY_CONTRACT_VERSION, id, profile: 'rule', status: issues.length === 0 ? 'pass' : 'fail', score: Math.max(0, 100 - issues.length * 10), issues };
}

export function assertRuleQuality(markdown, options = {}) {
  const report = auditRuleQuality(markdown, options);
  if (report.status !== 'pass') throw usageError(`Generated rule ${options.id ?? '<unknown>'} failed the quality contract: ${report.issues.join('; ')}`);
  return report;
}
