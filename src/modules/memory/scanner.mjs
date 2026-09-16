import path from 'node:path';
import { readBoundedRepositoryFile } from '../../adapters/filesystem/index.mjs';
import { sha256 } from '../../shared/index.mjs';
import { publicDeclarations, implementationBodyAfter } from '../capabilities/index.mjs';
import { isProductionScopePath } from '../repository/index.mjs';
import { emptyMemory, readMemoryFile } from './schema.mjs';

const JS = /\.(?:[cm]?js|ts)$/;
const CODE = /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|kt|vue|svelte|cs|php|rb|swift|dart|sql|prisma)$/;
const TEST = /(?:^|\/)(?:tests?|__tests__|fixtures?)(?:\/|$)|\.(?:test|spec)\./;
const DATA = /(?:\.schema\.json|\.prisma|\.sql)$/;
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const id = (kind, value) => `${kind}-${sha256(value).slice(0, 16)}`;

function callableExpression(tokens, closes, start, end) {
  let cursor = start;
  if (tokens[cursor]?.value === 'async') cursor += 1;
  if (tokens[cursor]?.value === 'function') {
    cursor += 1;
    if (tokens[cursor]?.kind === 'identifier') cursor += 1;
    if (tokens[cursor]?.value !== '(' || !closes.has(cursor)) return false;
    const body = implementationBodyAfter(tokens, closes, closes.get(cursor) + 1);
    return body >= 0 && closes.get(body) < end;
  }
  if (tokens[cursor]?.value === '(' && closes.has(cursor)) cursor = closes.get(cursor) + 1;
  else if (tokens[cursor]?.kind === 'identifier') cursor += 1;
  else return false;
  return tokens[cursor]?.value === '=>' && cursor + 1 < end;
}

function initializerEnd(tokens, depths, start, fallback) {
  for (let cursor = start + 1; cursor < tokens.length; cursor += 1) {
    if (depths[cursor] === depths[start] && tokens[cursor].value === ';') return cursor;
  }
  return fallback;
}

function literalFetchMethod({ tokens, closes }, start, callEnd) {
  const objectEnd = closes.get(start);
  if (tokens[start]?.value !== '{' || objectEnd === undefined
    || !(objectEnd + 1 === callEnd || (tokens[objectEnd + 1]?.value === ',' && objectEnd + 2 === callEnd))) return null;
  let method = 'GET';
  let seenMethod = false;
  for (let cursor = start + 1; cursor < objectEnd;) {
    const key = tokens[cursor];
    if (!['identifier', 'string'].includes(key.kind) || key.raw.includes('\\') || key.value === '__proto__' || tokens[cursor + 1]?.value !== ':') return null;
    const valueStart = cursor + 2;
    let valueEnd = valueStart;
    while (valueEnd < objectEnd && tokens[valueEnd].value !== ',') {
      valueEnd = closes.has(valueEnd) ? closes.get(valueEnd) + 1 : valueEnd + 1;
    }
    if (key.value === 'method') {
      const value = tokens[valueStart];
      if (seenMethod || valueEnd !== valueStart + 1 || value?.kind !== 'string' || value.raw.includes('\\') || !METHODS.has(value.value.toLowerCase())) return null;
      method = value.value.toUpperCase();
      seenMethod = true;
    }
    if (valueEnd === valueStart) return null;
    cursor = valueEnd + 1;
  }
  return method;
}
export function isMemoryCodePath(relative) {
  return isProductionScopePath(relative);
}

/** Bounded static recognizers: ESM declarations/imports, Express Router literals,
 * global fetch and imported axios literal calls. No business-purpose inference. */
export function scanProjectMemoryFacts(scan, { maxFiles = 160 } = {}) {
  const memory = emptyMemory();
  const files = scan.files.filter((file) => file.type === 'file' && isMemoryCodePath(file.relative)).sort((a, b) => a.relative.localeCompare(b.relative));
  const paths = new Set(files.map((file) => file.relative));
  const modules = new Map();
  const imports = new Map();
  memory.tests = scan.files.filter((file) => file.type === 'file' && TEST.test(file.relative) && CODE.test(file.relative)).map((file) => file.relative).sort().slice(0, 160);
  const gap = (relative, reason) => {
    if (memory.gaps.length < 1000 && !memory.gaps.some((entry) => entry.path === relative && entry.reason === reason)) memory.gaps.push({ path: relative, reason, status: 'unverified' });
  };
  const budget = Math.max(0, Math.min(Number.isInteger(maxFiles) ? maxFiles : 160, 160));
  for (const file of files.slice(budget, budget + 160)) gap(file.relative, 'memory scan file budget exceeded');
  for (const file of files.slice(0, budget)) {
    const relative = file.relative;
    let bytes;
    try { bytes = readBoundedRepositoryFile(scan.root, relative, 128 * 1024).bytes; } catch (error) { gap(relative, error.message); continue; }
    const directory = path.posix.dirname(relative);
    const moduleId = id('module', directory);
    if (!modules.has(directory)) modules.set(directory, { id: moduleId, path: directory, memoryPage: `docs/memory/modules/${moduleId}.md`, owns: [], codeGlobs: [], status: 'stated', summary: { status: 'unverified', text: '', verifiedFrom: [] }, pageIds: [], apiIds: [], methodIds: [], dataSourceIds: [], callSiteIds: [], verifiedFrom: [] });
    const module = modules.get(directory);
    module.owns.push(relative); module.codeGlobs.push(relative); module.verifiedFrom.push(relative);
    const sourceId = id('source', relative);
    memory.sources.push({ id: sourceId, path: relative, record: `docs/memory/sources/${sourceId}.json`, sha256: sha256(bytes), status: 'stated' });
    const fact = (kind, key, details) => ({ id: id(kind, `${relative}:${key}`), moduleId, ...details, verifiedFrom: [relative], status: 'stated' });
    if (!CODE.test(relative) && !DATA.test(relative)) { gap(relative, 'unsupported syntax; raw file ownership and digest only'); continue; }
    let text;
    try { text = readMemoryFile(scan.root, relative, 128 * 1024); } catch (error) { gap(relative, error.message); continue; }
    if (DATA.test(relative)) {
      const data = fact('data', relative, { path: relative });
      memory.dataSources.push(data); module.dataSourceIds.push(data.id);
    }
    if (!JS.test(relative)) { if (!relative.endsWith('.schema.json')) gap(relative, 'unsupported syntax; only file/module ownership is stated'); continue; }
    const declarations = publicDeclarations(text);
    if (!declarations.closes) { gap(relative, 'unbalanced or unsupported syntax; only file ownership is stated'); continue; }
    const tokens = declarations.tokens;
    const values = tokens.map((token) => token.value);
    if (tokens.length > 12000) { gap(relative, 'syntax token budget exceeded; only file ownership is stated'); continue; }
    if (tokens.some((token) => ['opaque', 'template'].includes(token.kind))) gap(relative, 'opaque or dynamic syntax is not interpreted');
    for (const entry of declarations.declarations) {
      const callable = entry.kind === 'function' || entry.kind === 'class'
        || (['const', 'let', 'var'].includes(entry.kind) && callableExpression(tokens, declarations.closes, entry.initializer,
          initializerEnd(tokens, declarations.depths, entry.initializer, entry.endIndex)));
      if (!callable) continue;
      if (memory.methods.length >= 1000) { gap(relative, 'public declaration budget exceeded'); break; }
      const method = fact('method', entry.exportedAs, { path: relative, symbol: entry.symbol, exportedAs: entry.exportedAs, kind: entry.kind });
      memory.methods.push(method); module.methodIds.push(method.id);
      if (entry.kind === 'class') for (let i = entry.bodyStartIndex + 1; i < entry.endIndex - 1; i += 1) {
        if (declarations.depths[i] !== declarations.depths[entry.bodyStartIndex] + 1 || tokens[i].kind !== 'identifier') continue;
        let prefix = i - 1;
        while (['public', 'private', 'protected', 'static', 'async', 'override', 'abstract', 'get', 'set'].includes(values[prefix])) prefix -= 1;
        if (values[prefix] === '#' || values.slice(prefix + 1, i).some((value) => ['private', 'protected', 'abstract'].includes(value))) continue;
        let memberKind = 'method';
        if (values[i + 1] === '(') {
          const close = declarations.closes?.get(i + 1);
          if (close === undefined || implementationBodyAfter(tokens, declarations.closes, close + 1) < 0) { gap(relative, 'unsupported class method syntax'); continue; }
        } else if (values[i + 1] === '=') {
          let end = i + 2;
          while (end < entry.endIndex - 1 && !(declarations.depths[end] === declarations.depths[i] && values[end] === ';')) end += 1;
          if (!callableExpression(tokens, declarations.closes, i + 2, end)) continue;
          memberKind = 'callable-field';
        } else continue;
        if (memory.methods.length >= 1000) { gap(relative, 'public declaration budget exceeded'); break; }
        const symbol = `${entry.symbol}.${values[i]}`;
        const modifiers = values.slice(prefix + 1, i);
        const scope = modifiers.includes('static') ? 'static' : 'instance';
        if (memberKind === 'method') memberKind = modifiers.find((value) => ['get', 'set'].includes(value)) ?? 'method';
        // Export alias, receiver scope and accessor kind are distinct public
        // identities; source offsets would make formatting change their IDs.
        const identity = `${entry.exportedAs}:${scope}:${memberKind}:${values[i]}`;
        const member = fact('method', identity, { path: relative, symbol, exportedAs: `${entry.exportedAs}.${values[i]}`, kind: 'public-method', scope, memberKind });
        memory.methods.push(member); module.methodIds.push(member.id);
      }
    }
    for (const entry of declarations.defaultExpressions) {
      if (!callableExpression(tokens, declarations.closes, entry.initializer, entry.endIndex)) continue;
      if (memory.methods.length >= 1000) { gap(relative, 'public declaration budget exceeded'); break; }
      const method = fact('method', 'default', { path: relative, symbol: 'default', exportedAs: 'default', kind: 'callable-expression' });
      memory.methods.push(method); module.methodIds.push(method.id);
    }
    if (/(?:^|\/)(?:pages|views)\//.test(relative) && declarations.declarations.length) {
      const page = fact('page', relative, { path: relative, apiIds: [], callSiteIds: [] });
      memory.pages.push(page); module.pageIds.push(page.id);
    }
    const importRecords = [];
    for (let i = 0; i < tokens.length; i += 1) {
      if (values[i] !== 'import' || declarations.depths[i] !== 0) continue;
      let end = i + 1;
      while (end < tokens.length && values[end] !== ';' && !(end > i + 1 && tokens[end].lineBreakBefore && ['export', 'import', 'const'].includes(values[end]))) end += 1;
      const from = tokens.slice(i, end).findIndex((token) => token.value === 'from');
      if (from < 0 || tokens[i + from + 1]?.kind !== 'string') continue;
      importRecords.push({ specifier: tokens[i + from + 1].value, names: tokens.slice(i + 1, i + from).map((token) => token.value) });
    }
    imports.set(relative, importRecords.filter((entry) => entry.specifier.startsWith('.')).flatMap((entry) => {
      const target = path.posix.normalize(path.posix.join(directory, entry.specifier));
      const found = [target, `${target}.mjs`, `${target}.js`, `${target}.ts`, `${target}/index.mjs`, `${target}/index.js`, `${target}/index.ts`].find((item) => paths.has(item));
      if (!found) gap(relative, `unresolved local import: ${entry.specifier}`);
      return found ? [found] : [];
    }));
    const express = importRecords.some((entry) => entry.specifier === 'express' && entry.names.join(' ') === '{ Router }');
    const routers = new Set();
    if (express) for (let i = 0; i < tokens.length - 5; i += 1) {
      if (declarations.depths[i] === 0 && values[i] === 'const' && tokens[i + 1].kind === 'identifier' && values.slice(i + 2, i + 6).join(' ') === '= Router ( )') routers.add(values[i + 1]);
    }
    const axiosNames = importRecords.filter((entry) => entry.specifier === 'axios' && entry.names.length === 1).map((entry) => entry.names[0]);
    const ambiguousFetch = tokens.some((token, i) => token.value === 'fetch' && token.kind === 'identifier'
      && (values[i + 1] !== '(' || ['function', 'const', 'let', 'var', '.', '?.'].includes(values[i - 1])));
    const ambiguousRouter = (name) => tokens.some((token, i) => token.kind === 'identifier' && token.value === name
      && !(values[i + 1] === '.' || (values[i - 1] === 'const' && values.slice(i + 1, i + 5).join(' ') === '= Router ( )')));
    const ambiguousAxios = (name) => tokens.some((token, i) => token.kind === 'identifier' && token.value === name && values[i + 1] !== '.' && values[i - 1] !== 'import');
    for (let i = 0; i < tokens.length; i += 1) {
      if (memory.apis.length + memory.callSites.length >= 1000) { gap(relative, 'HTTP fact budget exceeded'); break; }
      const receiver = values[i];
      const memberCall = values[i + 1] === '.' && METHODS.has(values[i + 2]) && values[i + 3] === '(';
      const isFetch = receiver === 'fetch' && values[i + 1] === '(' && !['.', 'function'].includes(values[i - 1]);
      if (!memberCall && !isFetch) continue;
      const route = memberCall && routers.has(receiver);
      const client = isFetch || (memberCall && axiosNames.includes(receiver));
      if (!route && !client) { gap(relative, 'unresolved HTTP receiver; no route or client semantics inferred'); continue; }
      if ((isFetch && ambiguousFetch) || (route && ambiguousRouter(receiver)) || (!isFetch && client && ambiguousAxios(receiver))) { gap(relative, 'shadowed or rebound HTTP receiver is unresolved'); continue; }
      const argument = i + (isFetch ? 2 : 4);
      if (tokens[argument]?.kind !== 'string' || tokens[argument].raw.includes('\\') || !values[argument].startsWith('/') || values[argument].length > 1024 || ![',', ')'].includes(values[argument + 1])) { gap(relative, 'dynamic, escaped or oversized HTTP path is unresolved'); continue; }
      let method = isFetch ? 'GET' : values[i + 2].toUpperCase();
      if (isFetch && values[argument + 1] === ',') {
        method = literalFetchMethod(declarations, argument + 2, declarations.closes.get(i + 1));
        if (method === null) { gap(relative, 'dynamic fetch options or method are unresolved'); continue; }
      }
      const example = text.slice(tokens[i].start, tokens[declarations.closes?.get(i + (isFetch ? 1 : 3)) ?? argument].end);
      if (example.length > 2048) { gap(relative, 'HTTP example budget exceeded'); continue; }
      const entry = fact(route ? 'api' : 'call', `${i}`, { path: route ? values[argument] : relative, method, ...(route ? { implementationPath: relative, pageIds: [], callSiteIds: [] } : { apiPath: values[argument], apiIds: [], pageIds: [], clientStyle: isFetch ? 'fetch' : 'axios', example }) });
      if (route) { memory.apis.push(entry); module.apiIds.push(entry.id); }
      else { memory.callSites.push(entry); module.callSiteIds.push(entry.id); }
    }
  }
  for (const call of memory.callSites) {
    const matches = memory.apis.filter((api) => api.method === call.method && api.path === call.apiPath);
    if (matches.length !== 1) { gap(call.path, matches.length ? 'ambiguous method/path endpoint pairing' : `unresolved API ${call.method} ${call.apiPath}`); continue; }
    call.apiIds.push(matches[0].id); matches[0].callSiteIds.push(call.id);
  }
  const reachable = (start) => {
    const found = new Set(); const pending = [start];
    while (pending.length) { const next = pending.pop(); if (found.has(next)) continue; found.add(next); pending.push(...(imports.get(next) ?? [])); }
    return found;
  };
  for (const page of memory.pages) for (const call of memory.callSites.filter((entry) => reachable(page.path).has(entry.path))) {
    call.pageIds.push(page.id);
    page.callSiteIds.push(call.id);
    for (const apiId of call.apiIds) {
      if (!page.apiIds.includes(apiId)) page.apiIds.push(apiId);
      const api = memory.apis.find((entry) => entry.id === apiId);
      if (!api.pageIds.includes(page.id)) api.pageIds.push(page.id);
    }
  }
  memory.modules = [...modules.values()];
  for (const api of memory.apis) {
    api.moduleIds = [...new Set([api.moduleId,
      ...memory.pages.filter((page) => api.pageIds.includes(page.id)).map((page) => page.moduleId),
      ...memory.callSites.filter((call) => api.callSiteIds.includes(call.id)).map((call) => call.moduleId),
    ])].sort();
    for (const moduleId of api.moduleIds) {
      const module = memory.modules.find((entry) => entry.id === moduleId);
      if (!module.apiIds.includes(api.id)) module.apiIds.push(api.id);
    }
  }
  return memory;
}
