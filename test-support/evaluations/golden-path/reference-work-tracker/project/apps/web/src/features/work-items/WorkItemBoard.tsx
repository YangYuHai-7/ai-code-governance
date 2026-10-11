import { Button, Group, Stack, Text } from "@mantine/core";
import type { WorkItem } from "../../../../../packages/contracts/src/index";

export function WorkItemBoard(props: {
  items: WorkItem[];
  onMove: (item: WorkItem, next: WorkItem["state"]) => void;
}) {
  return (
    <Stack gap="xs" component="section" aria-label="Work items">
      <Text fw={600}>Work items</Text>
      {props.items.map((item) => (
        <Group key={item.id} justify="space-between">
          <Text>
            {item.title} ({item.state})
          </Text>
          <Button
            size="xs"
            onClick={() =>
              props.onMove(item, item.state === "todo" ? "in-progress" : "done")
            }
            disabled={item.state === "done"}
          >
            Start
          </Button>
        </Group>
      ))}
    </Stack>
  );
}
