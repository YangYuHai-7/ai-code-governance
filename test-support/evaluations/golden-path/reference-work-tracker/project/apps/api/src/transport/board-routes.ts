import type { FastifyInstance } from 'fastify';
import type { Board } from '../../../../packages/contracts/src/index';

export interface BoardService {
  listBoards(organizationId: string): Board[];
  pageItems(organizationId: string, boardId: string, cursor: string | null, limit: number): { items: unknown[]; nextCursor: string | null };
  moveItem(organizationId: string, actorId: string, boardId: string, itemId: string, next: 'todo' | 'in-progress' | 'done', expectedVersion: number): unknown;
}

interface MoveBody { organizationId: string; actorId: string; boardId: string; state: 'todo' | 'in-progress' | 'done'; expectedVersion: number }

export function registerBoardRoutes(server: Pick<FastifyInstance, 'get' | 'patch'>, service: BoardService): void {
  server.get('/health', async () => ({ status: 'ok', correlationId: 'local' }));
  server.get('/boards', async (request) => {
    const organizationId = String((request.query as { organizationId?: string }).organizationId ?? '');
    return { items: service.listBoards(organizationId) };
  });
  server.get('/boards/:boardId/items', async (request) => {
    const params = request.params as { boardId: string };
    const query = request.query as { organizationId?: string; cursor?: string; limit?: string };
    return service.pageItems(String(query.organizationId ?? ''), params.boardId, query.cursor ?? null, Number(query.limit ?? 20));
  });
  server.patch('/work-items/:itemId', async (request, reply) => {
    const params = request.params as { itemId: string };
    const body = request.body as MoveBody;
    try {
      return service.moveItem(body.organizationId, body.actorId, body.boardId, params.itemId, body.state, body.expectedVersion);
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'ConflictError') return reply.code(409).send({ error: (error as Error).message });
      if (name === 'NotFoundError') return reply.code(404).send({ error: (error as Error).message });
      throw error;
    }
  });
}
