import { NotFoundError } from './errors';

export interface Board { id: string; organizationId: string; title: string }
export interface AuditEntry { id: string; organizationId: string; actorId: string; itemId: string; action: string }

export function requireOwnedBoard(boards: Board[], boardId: string, organizationId: string): Board {
  const board = boards.find((entry) => entry.id === boardId && entry.organizationId === organizationId);
  if (!board) throw new NotFoundError('board not found in this organization');
  return board;
}

export function auditEntry(organizationId: string, actorId: string, itemId: string, action: string): AuditEntry {
  return { id: `audit-${itemId}-${action}`, organizationId, actorId, itemId, action };
}
