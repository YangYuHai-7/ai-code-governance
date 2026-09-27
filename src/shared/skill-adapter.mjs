/**
 * Client Skill discovery is one directory deep: `<skill root>/<name>/SKILL.md`. The canonical
 * tree may organize a family into a group (`docs/ai/skills/standards/<id>/SKILL.md`), but that
 * group must never be copied into the client directory: a client that does not recurse would then
 * see the group directory, find no `SKILL.md` inside it, and skip the whole family. This derives
 * the flat, one-level adapter suffix for a canonical Skill path.
 */
export function adapterSkillSuffix(canonicalPath) {
  const suffix = canonicalPath.slice('docs/ai/skills/'.length);
  const parts = suffix.split('/');
  if (parts.length <= 2) return suffix;
  const group = parts[0];
  const name = parts.slice(1, -1).join('-');
  if (group === 'standards') return 'standard-' + name + '/SKILL.md';
  if (group === 'project-conventions') return 'convention-' + name + '/SKILL.md';
  // Capability harvests live under `project/`; the flat name uses a distinct `capability-`
  // namespace so it can never be confused with a user Skill named `project-...`.
  if (group === 'project') return 'capability-' + name + '/SKILL.md';
  return group + '-' + name + '/SKILL.md';
}

/** Keep the complete Skill in one canonical file. Client discovery files only route to it. */
export function skillAdapterContent(canonicalPath, canonicalContent) {
  const frontmatter = canonicalContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error(`Skill is missing frontmatter: ${canonicalPath}`);
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1];
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!name || !description) throw new Error(`Skill is missing name or description: ${canonicalPath}`);
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nRead the complete Skill at \`${canonicalPath}\` before performing this task. This file is a generated discovery adapter; edit the canonical Skill only.\n`;
}
