import type { FastifyInstance } from "fastify";
import type { Board } from "../../../../packages/contracts/src/index";

export interface BoardService {
  listBoards(organizationId: string): Board[];
  pageItems(
    organizationId: string,
    boardId: string,
    cursor: string | null,
    limit: number,
  ): { items: unknown[]; nextCursor: string | null };
  moveItem(
    organizationId: string,
    actorId: string,
    boardId: string,
    itemId: string,
    next: "todo" | "in-progress" | "done",
    expectedVersion: number,
  ): unknown;
}

interface MoveBody {
  organizationId: string;
  actorId: string;
  boardId: string;
  state: "todo" | "in-progress" | "done";
  expectedVersion: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Malformed input is a client error, never an internal one: a non-UUID tenant or board would
// otherwise reach the database and surface as a 500 while leaking the driver's message.
function malformed(value: unknown): boolean {
  return typeof value !== "string" || !UUID.test(value);
}

export function registerBoardRoutes(
  server: Pick<FastifyInstance, "get" | "patch">,
  service: BoardService,
): void {
  server.get("/health", async () => ({ status: "ok", correlationId: "local" }));

  server.get("/boards", async (request, reply) => {
    const organizationId = String(
      (request.query as { organizationId?: string }).organizationId ?? "",
    );
    if (malformed(organizationId)) {
      return reply.code(400).send({ error: "organizationId must be a UUID" });
    }
    return { items: service.listBoards(organizationId) };
  });

  server.get("/boards/:boardId/items", async (request, reply) => {
    const params = request.params as { boardId: string };
    const query = request.query as {
      organizationId?: string;
      cursor?: string;
      limit?: string;
    };
    if (malformed(query.organizationId) || malformed(params.boardId)) {
      return reply
        .code(400)
        .send({ error: "organizationId and boardId must be UUIDs" });
    }
    try {
      return service.pageItems(
        String(query.organizationId),
        params.boardId,
        query.cursor ?? null,
        Number(query.limit ?? 20),
      );
    } catch (error) {
      const name = (error as Error).name;
      if (name === "NotFoundError")
        return reply.code(404).send({ error: (error as Error).message });
      if (name === "ConflictError")
        return reply.code(409).send({ error: (error as Error).message });
      throw error;
    }
  });

  server.patch("/work-items/:itemId", async (request, reply) => {
    const params = request.params as { itemId: string };
    const body = request.body as MoveBody;
    if (malformed(body?.organizationId) || malformed(body?.boardId)) {
      return reply
        .code(400)
        .send({ error: "organizationId and boardId must be UUIDs" });
    }
    if (!Number.isSafeInteger(body?.expectedVersion)) {
      return reply
        .code(400)
        .send({ error: "expectedVersion must be an integer" });
    }
    if (!["todo", "in-progress", "done"].includes(body?.state)) {
      return reply.code(400).send({ error: "state is not a supported value" });
    }
    try {
      return service.moveItem(
        body.organizationId,
        body.actorId,
        body.boardId,
        params.itemId,
        body.state,
        body.expectedVersion,
      );
    } catch (error) {
      const name = (error as Error).name;
      if (name === "ConflictError")
        return reply.code(409).send({ error: (error as Error).message });
      if (name === "NotFoundError")
        return reply.code(404).send({ error: (error as Error).message });
      throw error;
    }
  });
}
