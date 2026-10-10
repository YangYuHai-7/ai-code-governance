import { describe, expect, it } from 'vitest';
import { isWorkItemState, type Page, type WorkItem } from '../../packages/contracts/src/index';

describe('published contracts', () => {
  it('validates work item states and page shape', () => {
    expect(isWorkItemState('todo')).toBe(true);
    expect(isWorkItemState('archived')).toBe(false);
    const page: Page<WorkItem> = { items: [], nextCursor: null };
    expect(page.nextCursor).toBeNull();
  });
});
