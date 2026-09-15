function isRegexStart(tokens) {
  const previous = tokens.at(-1);
  if (!previous) return true;
  if (previous.kind === 'identifier') return ['return', 'throw', 'case', 'delete', 'typeof', 'void', 'new', 'in', 'of', 'yield', 'await'].includes(previous.value);
  return ['(', '[', '{', '=', ':', ',', ';', '!', '?', '&&', '||', '=>'].includes(previous.value);
}

function quotedEnd(content, start, quote) {
  let cursor = start + 1;
  while (cursor < content.length) {
    if (content[cursor] === '\\') cursor += 2;
    else if (content[cursor++] === quote) return cursor;
  }
  return content.length;
}

function templateEnd(content, start) {
  let cursor = start + 1;
  while (cursor < content.length) {
    if (content[cursor] === '\\') cursor += 2;
    else if (content[cursor] === '`') return cursor + 1;
    else if (content[cursor] === '$' && content[cursor + 1] === '{') {
      cursor += 2;
      let depth = 1;
      while (cursor < content.length && depth > 0) {
        const character = content[cursor];
        if (character === '"' || character === "'") cursor = quotedEnd(content, cursor, character);
        else if (character === '`') cursor = templateEnd(content, cursor);
        else if (character === '/') {
          // Ambiguous slash grammar inside interpolation is outside this lexer.
          // Keep remaining bytes opaque rather than inventing declarations.
          return content.length;
        } else {
          if (character === '{') depth += 1;
          if (character === '}') depth -= 1;
          cursor += 1;
        }
      }
    } else cursor += 1;
  }
  return content.length;
}

const OPERATORS = ['>>>=', '===', '!==', '**=', '&&=', '||=', '??=', '>>>', '<<=', '>>=', '=>', '&&', '||', '?.', '??', '++', '--', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '&=', '|=', '^=', '...'];

export function sourceTokens(content) {
  const tokens = [];
  let index = 0;
  const push = (kind, value, start) => tokens.push({
    kind, value, raw: content.slice(start, index), start, end: index,
    lineBreakBefore: /[\r\n]/.test(content.slice(tokens.at(-1)?.end ?? 0, start)),
  });
  while (index < content.length) {
    const current = content[index];
    const next = content[index + 1];
    if (/\s/.test(current)) { index += 1; continue; }
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
    const start = index;
    if (current === '/' && isRegexStart(tokens)) {
      index += 1;
      let characterClass = false;
      while (index < content.length) {
        if (content[index] === '\\') { index += 2; continue; }
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
      push('regex', content.slice(start, index), start);
      continue;
    }
    if (current === '/') {
      // Slash after a closing expression may be division or a regex statement.
      // Preserve opaque bytes when this bounded lexer cannot prove the grammar.
      index = content.length;
      push('opaque', content.slice(start), start);
      continue;
    }
    if (current === "'" || current === '"') {
      index = quotedEnd(content, start, current);
      const raw = content.slice(start + 1, index - 1);
      push('string', raw.replace(/\\(.)/gs, '$1'), start);
      continue;
    }
    if (current === '`') {
      index = templateEnd(content, start);
      push('template', content.slice(start, index), start);
      continue;
    }
    if (/[A-Za-z_$]/.test(current)) {
      index += 1;
      while (/[A-Za-z0-9_$]/.test(content[index] ?? '')) index += 1;
      push('identifier', content.slice(start, index), start);
      continue;
    }
    if (/[0-9]/.test(current)) {
      index += 1;
      while (/[0-9A-Za-z_.]/.test(content[index] ?? '')) index += 1;
      push('number', content.slice(start, index), start);
      continue;
    }
    const operator = OPERATORS.find((value) => content.startsWith(value, index)) ?? current;
    index += operator.length;
    push('punctuation', operator, start);
  }
  return tokens;
}

export function capabilitySourceChanged(before, after) {
  const comparable = (source) => {
    let depth = 0;
    let declarationStatement = false;
    const values = [];
    let previous = null;
    const tokens = sourceTokens(source);
    const declarations = new Set(['export', 'import', 'const', 'let', 'var', 'class', 'function']);
    for (const [index, token] of tokens.entries()) {
      if (depth === 0 && token.kind === 'identifier' && declarations.has(token.value)) declarationStatement = true;
      // Normalize a declaration terminator only at EOF or before another explicit
      // declaration. Empty control bodies and expression continuations retain it.
      if (token.value === ';' && token.kind === 'punctuation' && depth === 0) {
        const next = tokens[index + 1];
        const optional = declarationStatement && (!next || (next.kind === 'identifier' && declarations.has(next.value)));
        declarationStatement = false;
        if (optional) continue;
      }
      const restricted = previous?.kind === 'identifier' && ['return', 'throw', 'yield', 'break', 'continue', 'async'].includes(previous.value);
      const postfix = ['++', '--'].includes(token.value) || ['++', '--'].includes(previous?.value);
      values.push({
        kind: token.kind,
        raw: token.kind === 'string' ? token.raw.slice(1, -1) : token.raw,
        ...(restricted || postfix ? { lineBreakBefore: token.lineBreakBefore } : {}),
      });
      if (token.kind === 'punctuation' && ['(', '[', '{'].includes(token.value)) depth += 1;
      if (token.kind === 'punctuation' && [')', ']', '}'].includes(token.value)) depth -= 1;
      previous = token;
    }
    return values;
  };
  return JSON.stringify(comparable(before)) !== JSON.stringify(comparable(after));
}
