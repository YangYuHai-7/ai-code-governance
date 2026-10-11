import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import type { Board } from "../../../../../packages/contracts/src/index";

export function BoardList(props: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (boardId: string) => void;
}) {
  return (
    <Stack gap="xs" component="section" aria-label="Boards">
      <Text fw={600}>Boards</Text>
      {props.boards.map((board) => (
        <Card key={board.id} withBorder padding="sm">
          <Group justify="space-between">
            <button
              type="button"
              onClick={() => props.onSelect(board.id)}
              aria-pressed={props.selectedId === board.id}
            >
              {board.title}
            </button>
            <Badge variant="light">{board.organizationId.slice(0, 8)}</Badge>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
