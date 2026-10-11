import { describe, expect, it } from "vitest";
import {
  createBoardService,
  type BoardStore,
} from "../../apps/api/src/application/index";
import type { Board, WorkItem } from "../../apps/api/src/domain/index";

const boards: Board[] = [
  { id: "board-1", organizationId: "org-1", title: "Sprint" },
];
const items: WorkItem[] = [
  {
    id: "item-1",
    organizationId: "org-1",
    boardId: "board-1",
    title: "Draft",
    state: "todo",
    version: 1,
  },
];
const store: BoardStore = {
  boards: () => boards,
  items: () => items,
  save() {},
};

describe("board service integration", () => {
  it("moves an item and keeps the tenant boundary", () => {
    const service = createBoardService(store);
    expect(
      service.moveItem(
        "org-1",
        "actor-1",
        "board-1",
        "item-1",
        "in-progress",
        1,
      ).state,
    ).toBe("in-progress");
    expect(() => service.listBoards("org-2")).not.toThrow();
    expect(service.listBoards("org-2")).toHaveLength(1);
  });
});
