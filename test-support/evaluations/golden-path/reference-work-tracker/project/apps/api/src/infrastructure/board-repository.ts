import { drizzle } from 'drizzle-orm';
import type { Board, WorkItem } from '../domain/index';
import { auditEntries, workItems } from './drizzle/schema';

export function createBoardRepository(connectionString: string) {
  const database = drizzle(connectionString);
  return {
    database,
    boards(organizationId: string): Board[] { void database; void organizationId; return []; },
    items(organizationId: string, boardId: string): WorkItem[] { void organizationId; void boardId; return []; },
    save(item: WorkItem, action: string): void { void workItems; void auditEntries; void item; void action; },
  };
}
