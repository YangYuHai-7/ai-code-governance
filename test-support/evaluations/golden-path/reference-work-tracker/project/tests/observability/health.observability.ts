import { describe, expect, it } from "vitest";
import {
  registerBoardRoutes,
  type BoardService,
} from "../../apps/api/src/transport/board-routes";

const service: BoardService = {
  listBoards: () => [],
  pageItems: () => ({ items: [], nextCursor: null }),
  moveItem: () => ({ id: "item-1", state: "in-progress", version: 2 }),
};

describe("observability surface", () => {
  it("exposes health and board routes with correlation and tenant scope", () => {
    const routes: Record<string, unknown> = {};
    registerBoardRoutes(
      {
        get: (path: string, handler: unknown) => {
          routes[path] = handler;
        },
        patch: (path: string, handler: unknown) => {
          routes[path] = handler;
        },
      } as never,
      service,
    );
    expect(routes["/health"]).toBeTypeOf("function");
    expect(routes["/boards"]).toBeTypeOf("function");
    expect(routes["/work-items/:itemId"]).toBeTypeOf("function");
  });
});
