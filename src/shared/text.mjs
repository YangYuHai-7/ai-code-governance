// Preserve token boundaries and line positions while ignoring markup comments in source analysis.
// This is not an HTML sanitizer; callers never render the result as markup.
export function maskMarkupComments(text) {
  return text.replace(/<!--[\s\S]*?(?:--!?>|$)/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
