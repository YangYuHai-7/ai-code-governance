import { describe, expect, it } from 'vitest';
import { paginate, transitionItem, type WorkItem } from '../../apps/api/src/domain/index';

const item: WorkItem = { id: 'item-1', organizationId: 'org-1', boardId: 'board-1', title: 'Draft', state: 'todo', version: 1 };

describe('work item domain', () => {
  it('accepts a versioned transition and rejects a stale version', () => {
    expect(transitionItem(item, 'in-progress', 1).version).toBe(2);
    expect(() => transitionItem(item, 'in-progress', 0)).toThrow(/stale/);
  });
  it('paginates with a stable cursor', () => {
    const page = paginate([item, { ...item, id: 'item-2' }], null, 1);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('item-1');
  });
});
