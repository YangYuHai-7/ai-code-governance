import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  isWorkItemState,
  type Board,
} from "../../../../packages/contracts/src/index";

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
  organizationId?: string;
  boardId: string;
  state: "todo" | "in-progress" | "done";
  expectedVersion: number;
}

export interface Session {
  organizationId: string;
  actorId: string;
}

export type ResolveSession = (request: FastifyRequest) => Session | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Malformed input is a client error, never an internal one: a non-UUID tenant or board would
// otherwise reach the database and surface as a 500 while leaking the driver's message.
function malformed(value: unknown): boolean {
  return typeof value !== "string" || !UUID.test(value);
}

export function registerBoardRoutes(
  server: Pick<FastifyInstance, "get" | "patch">,
  service: BoardService,
  resolveSession: ResolveSession = () => null,
  enabled = true,
): void {
  server.get("/health", async (request) => ({
    status: "ok",
    correlationId: request.id,
  }));

  server.get("/boards", async (request, reply) => {
    if (!enabled)
      return reply.code(503).send({ error: "work tracker disabled" });
    const session = resolveSession(request);
    if (!session)
      return reply.code(401).send({ error: "active session required" });
    const query = request.query as { organizationId?: string };
    if (query.organizationId !== undefined && malformed(query.organizationId))
      return reply.code(400).send({ error: "organizationId must be a UUID" });
    if (
      query.organizationId !== undefined &&
      query.organizationId !== session.organizationId
    )
      return reply.code(404).send({ error: "not found" });
    const organizationId = session.organizationId;
    return { items: service.listBoards(organizationId) };
  });

  server.get("/boards/:boardId/items", async (request, reply) => {
    if (!enabled)
      return reply.code(503).send({ error: "work tracker disabled" });
    const session = resolveSession(request);
    if (!session)
      return reply.code(401).send({ error: "active session required" });
    const params = request.params as { boardId: string };
    const query = request.query as {
      organizationId?: string;
      cursor?: string;
      limit?: string;
    };
    if (query.organizationId !== undefined && malformed(query.organizationId))
      return reply.code(400).send({ error: "organizationId must be a UUID" });
    if (
      query.organizationId !== undefined &&
      query.organizationId !== session.organizationId
    )
      return reply.code(404).send({ error: "not found" });
    const limit = Number(query.limit ?? 20);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (query.cursor !== undefined && malformed(query.cursor))
    )
      return reply.code(400).send({ error: "invalid pagination" });
    if (malformed(params.boardId)) {
      return reply
        .code(400)
        .send({ error: "organizationId and boardId must be UUIDs" });
    }
    try {
      return service.pageItems(
        session.organizationId,
        params.boardId,
        query.cursor ?? null,
        limit,
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
    if (!enabled)
      return reply.code(503).send({ error: "work tracker disabled" });
    const session = resolveSession(request);
    if (!session)
      return reply.code(401).send({ error: "active session required" });
    const params = request.params as { itemId: string };
    const body = request.body as MoveBody;
    if (
      body?.organizationId !== undefined &&
      body.organizationId !== session.organizationId
    )
      return reply.code(404).send({ error: "not found" });
    if (malformed(params.itemId) || malformed(body?.boardId)) {
      return reply
        .code(400)
        .send({ error: "organizationId and boardId must be UUIDs" });
    }
    if (
      !Number.isSafeInteger(body?.expectedVersion) ||
      body.expectedVersion < 1
    ) {
      return reply
        .code(400)
        .send({ error: "expectedVersion must be an integer" });
    }
    if (!isWorkItemState(body?.state)) {
      return reply.code(400).send({ error: "state is not a supported value" });
    }
    try {
      return service.moveItem(
        session.organizationId,
        session.actorId,
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
