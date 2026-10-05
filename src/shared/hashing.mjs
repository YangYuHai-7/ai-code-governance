import crypto from 'node:crypto';

export function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function omitKeys(value, omitted) {
  if (Array.isArray(value)) return value.map((entry) => omitKeys(entry, omitted));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)).map(([key, entry]) => [key, omitKeys(entry, omitted)]));
}

export function canonicalValueDigest(value, { omit = [] } = {}) {
  return sha256(canonicalJson(omitKeys(value, new Set(omit))));
}
