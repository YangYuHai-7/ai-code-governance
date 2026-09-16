// Bounded callers supply text. These helpers recognize literals, never evaluate code.
export function withoutComments(text, { hash = false, slash = false, xml = false } = {}) {
  if (xml) return text.replace(/<!--[\s\S]*?-->/g, '');
  let output = '', quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      output += char;
      if (char === '\\' && quote === '"' && i + 1 < text.length) output += text[++i];
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") { quote = char; output += char; }
    else if ((hash && char === '#') || (slash && text.slice(i, i + 2) === '//')) {
      while (i < text.length && text[i] !== '\n') i += 1;
      output += '\n';
    } else if (slash && text.slice(i, i + 2) === '/*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return output;
      output += text.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 1;
    } else output += char;
  }
  return output;
}

export function literalStringArrays(text) {
  const result = [];
  for (const match of text.matchAll(/^\s*([\w.-]+)\s*=\s*\[/gm)) {
    let i = match.index + match[0].length;
    const values = [];
    let complete = false, expectValue = true;
    while (i < text.length) {
      if (/\s/.test(text[i])) { i += 1; continue; }
      if (text[i] === ']') { complete = true; break; }
      if (!expectValue) {
        if (text[i++] !== ',') break;
        expectValue = true;
        continue;
      }
      const quote = text[i];
      if (!['"', "'"].includes(quote) || text.slice(i, i + 3) === quote.repeat(3)) break;
      const start = i++;
      let closed = false;
      while (i < text.length && text[i] !== '\n') {
        if (text[i] === '\\' && quote === '"') { i += 2; continue; }
        if (text[i++] === quote) { closed = true; break; }
      }
      if (!closed) break;
      try { values.push(quote === '"' ? JSON.parse(text.slice(start, i)) : text.slice(start + 1, i - 1)); }
      catch { break; }
      expectValue = false;
    }
    if (complete) result.push({ key: match[1], values });
  }
  return result;
}
