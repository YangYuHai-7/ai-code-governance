import { boardSummary } from './index';

export function BoardList(props: { titles: string[] }): string {
  return boardSummary(props.titles.map((title) => ({ id: title, title, organizationId: 'synthetic' })));
}
