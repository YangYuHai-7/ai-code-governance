import type { WorkItem } from '../../../../../packages/contracts/src/index';

export function workItemLabel(item: WorkItem): string {
  return `${item.title} (${item.state})`;
}
