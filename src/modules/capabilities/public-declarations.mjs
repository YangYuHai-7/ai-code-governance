import { sourceTokens } from './source-tokenizer.mjs';

const DECLARATIONS = new Set(['class', 'function', 'const', 'let', 'var']);
const STATEMENTS = new Set([...DECLARATIONS, 'export', 'import']);

export function publicDeclarations(content) {
  const tokens = sourceTokens(content);
  const depths = [];
  const closes = new Map();
  const stack = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    depths[index] = stack.length;
    if (token.kind !== 'punctuation') continue;
    if (['(', '[', '{'].includes(token.value)) stack.push(index);
    if ([')', ']', '}'].includes(token.value)) {
      const start = stack.pop();
      if (start === undefined || tokens[start].value !== { ')': '(', ']': '[', '}': '{' }[token.value]) return { tokens, depths, declarations: [], defaultExpressions: [] };
      closes.set(start, index);
    }
  }
  if (stack.length > 0) return { tokens, depths, declarations: [], defaultExpressions: [] };
  const declarations = [];
  const exports = [];
  const defaultExpressions = [];
  const range = (start, end) => ({ start: tokens[start].start, end: tokens[end - 1].end });
  const statementEnd = (start) => {
    for (let cursor = start; cursor < tokens.length; cursor += 1) {
      if (depths[cursor] !== 0) continue;
      if (tokens[cursor].value === ';' || tokens[cursor].value === ',') return cursor;
      if (cursor > start && STATEMENTS.has(tokens[cursor].value)) return cursor;
    }
    return tokens.length;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    if (depths[index] !== 0 || tokens[index].kind !== 'identifier') continue;
    const kind = tokens[index].value;
    if (!DECLARATIONS.has(kind) || tokens[index + 1]?.kind !== 'identifier') continue;
    const symbol = tokens[index + 1].value;
    let end;
    let initializer = null;
    if (kind === 'class' || kind === 'function') {
      let body = -1;
      for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
        if (depths[cursor] !== 0) continue;
        if (tokens[cursor].value === '{') { body = cursor; break; }
        if (tokens[cursor].value === ';' || STATEMENTS.has(tokens[cursor].value)) break;
      }
      if (body === -1 || !closes.has(body)) continue;
      end = closes.get(body) + 1;
    } else {
      end = statementEnd(index + 2);
      initializer = -1;
      for (let cursor = index + 2; cursor < end; cursor += 1) {
        if (depths[cursor] === 0 && tokens[cursor].value === '=') { initializer = cursor; break; }
      }
      if (initializer === -1) continue;
      initializer += 1;
    }
    const declaration = { kind, symbol, startIndex: index, endIndex: end, initializer, declarationRange: range(index, end) };
    declarations.push(declaration);
    let prefix = index - 1;
    while (['default', 'abstract', 'async'].includes(tokens[prefix]?.value)) prefix -= 1;
    if (tokens[prefix]?.value === 'export' && depths[prefix] === 0) {
      exports.push({ symbol, exportedAs: tokens.slice(prefix, index).some((token) => token.value === 'default') ? 'default' : symbol, exportRange: range(prefix, end) });
    }
    index = end - 1;
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (depths[index] !== 0 || tokens[index].value !== 'export') continue;
    if (tokens[index + 1]?.value === '{') {
      const end = closes.get(index + 1);
      if (end === undefined || tokens[end + 1]?.value === 'from') continue;
      for (let cursor = index + 2; cursor < end;) {
        if (tokens[cursor].kind !== 'identifier' || tokens[cursor].value === 'type') break;
        const symbol = tokens[cursor++].value;
        let exportedAs = symbol;
        if (tokens[cursor]?.value === 'as' && tokens[cursor + 1]?.kind === 'identifier') { exportedAs = tokens[cursor + 1].value; cursor += 2; }
        if (cursor < end && tokens[cursor].value !== ',') break;
        exports.push({ symbol, exportedAs, exportRange: range(index, end + 1) });
        if (tokens[cursor]?.value === ',') cursor += 1;
      }
    } else if (tokens[index + 1]?.value === 'default' && !DECLARATIONS.has(tokens[index + 2]?.value)) {
      const end = statementEnd(index + 2);
      if (end === index + 3 && tokens[index + 2]?.kind === 'identifier') {
        exports.push({ symbol: tokens[index + 2].value, exportedAs: 'default', exportRange: range(index, end) });
      } else if (end > index + 2) {
        defaultExpressions.push({ kind: 'expression', symbol: 'default', exportedAs: 'default', startIndex: index + 2, initializer: index + 2, endIndex: end, declarationRange: range(index + 2, end), exportRange: range(index, end) });
      }
    }
  }
  return {
    tokens, depths, closes, defaultExpressions,
    declarations: declarations.flatMap((declaration) => {
      if (declarations.filter((entry) => entry.symbol === declaration.symbol).length !== 1) return [];
      return exports.filter((entry) => entry.symbol === declaration.symbol).map((entry) => ({ ...declaration, ...entry }));
    }),
  };
}
