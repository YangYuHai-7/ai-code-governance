import { sourceTokens } from './source-tokenizer.mjs';

const DECLARATIONS = new Set(['class', 'function', 'const', 'let', 'var']);
const STATEMENTS = new Set([...DECLARATIONS, 'export', 'import']);

function afterGenerics(tokens, closes, start) {
  if (tokens[start]?.value !== '<') return start;
  let depth = 0;
  for (let cursor = start; cursor < tokens.length; cursor += 1) {
    const value = tokens[cursor].value;
    if (closes.has(cursor)) { cursor = closes.get(cursor); continue; }
    if (value === '<') depth += 1;
    else if (/^>{1,3}$/.test(value)) {
      depth -= value.length;
      if (depth === 0) return cursor + 1;
      if (depth < 0) return -1;
    } else if (value === ';' || value === '=') return -1;
  }
  return -1;
}

// Recognize a bounded return-type grammar before accepting a runtime body.
// Type literals and generic constraints are balanced groups, never bodies.
export function implementationBodyAfter(tokens, closes, start) {
  let cursor = start;
  if (tokens[cursor]?.value === ':') {
    cursor += 1;
    let operand = true;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (operand) {
        if (['keyof', 'typeof', 'readonly', 'unique'].includes(token.value)) { cursor += 1; continue; }
        if (['asserts', 'infer', 'new', 'abstract', 'extends', 'is'].includes(token.value)) return -1;
        if (['{', '[', '('].includes(token.value) && closes.has(cursor)) cursor = closes.get(cursor) + 1;
        else if (['identifier', 'string', 'number'].includes(token.kind) && !STATEMENTS.has(token.value)) cursor += 1;
        else return -1;
        operand = false;
      } else if (token.value === '<') {
        cursor = afterGenerics(tokens, closes, cursor);
        if (cursor < 0) return -1;
      } else if (token.value === '[' && closes.has(cursor)) cursor = closes.get(cursor) + 1;
      else if (['.', '|', '&', '=>'].includes(token.value)) { operand = true; cursor += 1; }
      else break;
    }
    if (operand) return -1;
  }
  return tokens[cursor]?.value === '{' && closes.has(cursor) ? cursor : -1;
}

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
    let prefix = index - 1;
    while (['default', 'abstract', 'async', 'declare'].includes(tokens[prefix]?.value)) prefix -= 1;
    const modifiers = tokens.slice(prefix + 1, index).map((token) => token.value);
    if (modifiers.includes('declare') || modifiers.includes('abstract')) continue;
    let end;
    let initializer = null;
    let bodyStartIndex = null;
    if (kind === 'class' || kind === 'function') {
      let body = -1;
      const afterName = afterGenerics(tokens, closes, index + 2);
      if (afterName < 0) continue;
      if (kind === 'function') {
        if (tokens[afterName]?.value !== '(' || !closes.has(afterName)) continue;
        body = implementationBodyAfter(tokens, closes, closes.get(afterName) + 1);
      } else {
        for (let cursor = afterName; cursor < tokens.length; cursor += 1) {
          if (depths[cursor] !== 0) continue;
          if (tokens[cursor].value === '<') {
            cursor = afterGenerics(tokens, closes, cursor) - 1;
            if (cursor < 0) break;
            continue;
          }
          if (tokens[cursor].value === '{') { body = cursor; break; }
          if (tokens[cursor].value === ';' || STATEMENTS.has(tokens[cursor].value)) break;
        }
      }
      if (body === -1 || !closes.has(body)) continue;
      bodyStartIndex = body;
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
    const declaration = { kind, symbol, startIndex: index, endIndex: end, bodyStartIndex, initializer, declarationRange: range(index, end) };
    declarations.push(declaration);
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
