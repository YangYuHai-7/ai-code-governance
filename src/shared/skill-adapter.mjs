/** Keep the complete Skill in one canonical file. Client discovery files only route to it. */
export function skillAdapterContent(canonicalPath, canonicalContent) {
  const frontmatter = canonicalContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error(`Skill is missing frontmatter: ${canonicalPath}`);
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1];
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!name || !description) throw new Error(`Skill is missing name or description: ${canonicalPath}`);
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nRead the complete Skill at \`${canonicalPath}\` before performing this task. This file is a generated discovery adapter; edit the canonical Skill only.\n`;
}
