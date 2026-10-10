import { workItemLabel } from './index';

export function WorkItemBoard(props: { titles: string[] }): string {
  return props.titles.map((title) => workItemLabel({ id: title, title, state: 'todo', version: 1, organizationId: 'synthetic' })).join(' | ');
}
