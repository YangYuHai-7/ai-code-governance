import assert from 'node:assert/strict';
import test from 'node:test';
import { publicDeclarations } from '../src/modules/capabilities/public-declarations.mjs';

for (const type of ['{ can(): boolean }', 'Promise<Array<{ can(): boolean }>>', '() => { can(): boolean }', 'keyof { can(): boolean }']) {
  test(`declaration resolver does not use ${type} as an overload body`, () => {
    assert.deepEqual(publicDeclarations(`export function Policy(): ${type};`).declarations, []);
  });
  test(`declaration resolver locates the runtime body after ${type}`, () => {
    const source = `export function Policy<T extends { id: string }>(): ${type} { return implementation; }`;
    const model = publicDeclarations(source);
    assert.equal(model.declarations.length, 1);
    const declaration = model.declarations[0];
    const body = model.tokens[declaration.bodyStartIndex];
    assert.equal(source.slice(body.start, declaration.declarationRange.end), '{ return implementation; }');
  });
}

for (const source of [
  'declare function Policy(): { can(): boolean }; export { Policy };',
  'declare class Policy { can(): boolean; } export default Policy;',
  'export abstract class Policy { abstract can(): boolean; }',
  'export interface Policy { can(): boolean }',
  'export type Policy = { can(): boolean };',
]) {
  test(`declaration resolver rejects declaration-only evidence: ${source}`, () => {
    assert.deepEqual(publicDeclarations(source).declarations, []);
  });
}
