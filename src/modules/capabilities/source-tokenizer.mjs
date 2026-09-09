function isRegexStart(tokens) {
  const previous = tokens.at(-1);
  if (!previous) return true;
  if (previous.kind === 'identifier') return ['return', 'throw', 'case', 'delete', 'typeof', 'void', 'new', 'in', 'of', 'yield', 'await'].includes(previous.value);
  return ['(', '[', '{', '=', ':', ',', ';', '!', '?', '&&', '||', '=>'].includes(previous.value);
}

export function sourceTokens(content) {
  const tokens = [];
  let index = 0;
  while (index < content.length) {
    const current = content[index];
    const next = content[index + 1];
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      index = content.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (current === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      index = end === -1 ? content.length : end + 2;
      continue;
    }
    if (current === '/' && isRegexStart(tokens)) {
      index += 1;
      let characterClass = false;
      while (index < content.length) {
        if (content[index] === '\\') {
          index += 2;
          continue;
        }
        if (content[index] === '[') characterClass = true;
        if (content[index] === ']') characterClass = false;
        if (content[index] === '/' && !characterClass) {
          index += 1;
          while (/[a-z]/i.test(content[index] ?? '')) index += 1;
          break;
        }
        if (content[index] === '\n') break;
        index += 1;
      }
      continue;
    }
    if (current === '\'' || current === '"') {
      const quote = current;
      let value = '';
      index += 1;
      while (index < content.length && content[index] !== quote) {
        if (content[index] === '\\') {
          value += content[index + 1] ?? '';
          index += 2;
        } else {
          value += content[index];
          index += 1;
        }
      }
      if (content[index] === quote) index += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (current === '`') {
      index += 1;
      while (index < content.length && content[index] !== '`') {
        index += content[index] === '\\' ? 2 : 1;
      }
      if (content[index] === '`') index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(current)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/.test(content[index] ?? '')) index += 1;
      tokens.push({ kind: 'identifier', value: content.slice(start, index) });
      continue;
    }
    const twoCharacter = content.slice(index, index + 2);
    if (['=>', '&&', '||', '?.', '??'].includes(twoCharacter)) {
      tokens.push({ kind: 'punctuation', value: twoCharacter });
      index += 2;
      continue;
    }
    tokens.push({ kind: 'punctuation', value: current });
    index += 1;
  }
  return tokens;
}
