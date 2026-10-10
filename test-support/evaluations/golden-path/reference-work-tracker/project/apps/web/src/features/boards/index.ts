import type { Board } from '../../../../../packages/contracts/src/index';

export function boardSummary(boards: Board[]): string {
  return boards.map((board) => board.title).join(', ');
}
