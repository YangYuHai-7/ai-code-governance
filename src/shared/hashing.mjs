import crypto from 'node:crypto';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
