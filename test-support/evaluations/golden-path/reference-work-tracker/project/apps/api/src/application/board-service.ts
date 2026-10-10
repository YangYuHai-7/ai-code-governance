import { auditEntry, paginate, requireOwnedBoard, transitionItem, type Board, type WorkItem, type WorkItemState } from '../domain/index';

export interface BoardStore {
  boards(organizationId: string): Board[];
  items(organizationId: string, boardId: string): WorkItem[];
  save(item: WorkItem, action: string): void;
}

export function createBoardService(store: BoardStore) {
  return {
    listBoards(organizationId: string): Board[] {
      return store.boards(organizationId);
    },
    pageItems(organizationId: string, boardId: string, cursor: string | null, limit: number) {
      requireOwnedBoard(store.boards(organizationId), boardId, organizationId);
      return paginate(store.items(organizationId, boardId), cursor, limit);
    },
    moveItem(organizationId: string, actorId: string, boardId: string, itemId: string, next: WorkItemState, expectedVersion: number): WorkItem {
      requireOwnedBoard(store.boards(organizationId), boardId, organizationId);
      const item = store.items(organizationId, boardId).find((entry) => entry.id === itemId);
      if (!item) throw new Error('work item not found');
      const updated = transitionItem(item, next, expectedVersion);
      store.save(updated, `move:${next}`);
      void auditEntry(organizationId, actorId, itemId, `move:${next}`);
      return updated;
    },
  };
}
