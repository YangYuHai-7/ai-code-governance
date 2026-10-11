import { ConflictError } from "./errors";

export type WorkItemState = "todo" | "in-progress" | "done";

export interface WorkItem {
  id: string;
  organizationId: string;
  boardId: string;
  title: string;
  state: WorkItemState;
  version: number;
}

const TRANSITIONS: Record<WorkItemState, WorkItemState[]> = {
  todo: ["in-progress"],
  "in-progress": ["done"],
  done: [],
};

export function transitionItem(
  item: WorkItem,
  next: WorkItemState,
  expectedVersion: number,
): WorkItem {
  if (item.version !== expectedVersion)
    throw new ConflictError("stale work item version");
  if (!TRANSITIONS[item.state].includes(next))
    throw new ConflictError(`cannot move ${item.state} to ${next}`);
  return { ...item, state: next, version: item.version + 1 };
}

export function paginate<T extends { id: string }>(
  items: T[],
  cursor: string | null,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const start =
    cursor === null ? 0 : items.findIndex((item) => item.id === cursor) + 1;
  const page = items.slice(start, start + limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: last && start + limit < items.length ? last.id : null,
  };
}
