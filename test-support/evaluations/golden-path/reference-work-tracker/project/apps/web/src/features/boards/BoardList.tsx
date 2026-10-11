import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import type { Board } from '../../../../../packages/contracts/src/index';

export function BoardList(props: { boards: Board[]; selectedId: string | null; onSelect: (boardId: string) => void }) {
  return (
    <section aria-label="Boards">
      <h2>Boards</h2>
      <Stack gap="xs" role="list" aria-label="Boards">
        {props.boards.map((board) => (
          <Card key={board.id} withBorder padding="sm" role="listitem">
            <Group justify="space-between">
              <button type="button" onClick={() => props.onSelect(board.id)} aria-pressed={props.selectedId === board.id}>
                {board.title}
              </button>
              <Badge variant="light">{board.organizationId.slice(0, 8)}</Badge>
            </Group>
          </Card>
        ))}
      </Stack>
    </section>
  );
}
