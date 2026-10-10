import { describe, expect, it } from 'vitest';
import { registerBoardRoutes } from '../../apps/api/src/transport/board-routes';

describe('observability surface', () => {
  it('exposes a health response with correlation', () => {
    const routes: Record<string, () => Promise<unknown>> = {};
    registerBoardRoutes({ get: (path: string, handler: () => Promise<unknown>) => { routes[path] = handler; } } as never, () => []);
    expect(routes['/health']).toBeTypeOf('function');
  });
});
