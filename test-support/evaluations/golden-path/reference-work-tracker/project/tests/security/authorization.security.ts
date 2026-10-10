import { describe, expect, it } from 'vitest';
import { requireOwnedBoard } from '../../apps/api/src/domain/index';

describe('tenant authorization', () => {
  const boards = [{ id: 'board-1', organizationId: 'org-1', title: 'Sprint' }];
  it('denies cross-tenant access through a valid identifier', () => {
    expect(() => requireOwnedBoard(boards, 'board-1', 'org-2')).toThrow(/not found/);
  });
});
