export type WorkItemState = 'todo' | 'in-progress' | 'done';

export interface Board { id: string; title: string; organizationId: string }
export interface WorkItem { id: string; title: string; state: WorkItemState; version: number; organizationId: string }
export interface Page<T> { items: T[]; nextCursor: string | null }

const STATES: WorkItemState[] = ['todo', 'in-progress', 'done'];
export function isWorkItemState(value: string): value is WorkItemState { return STATES.includes(value as WorkItemState); }
