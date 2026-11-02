import type {
  Board,
  Page,
  WorkItem,
} from "../../../packages/contracts/src/index";

export function createClient(
  base: string,
  token: string,
  send: typeof fetch = fetch,
) {
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await send(`${base}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error ?? `Request failed (${response.status})`);
    return payload as T;
  }
  return {
    boards(signal?: AbortSignal) {
      return request<{ items: Board[] }>("/boards", { signal });
    },
    async items(boardId: string, signal?: AbortSignal): Promise<WorkItem[]> {
      const items: WorkItem[] = [];
      let cursor: string | null = null;
      do {
        const query =
          cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
        const page: Page<WorkItem> = await request(
          `/boards/${encodeURIComponent(boardId)}/items${query}`,
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return items;
    },
    move(
      boardId: string,
      item: Pick<WorkItem, "id" | "version">,
      state: WorkItem["state"],
      signal?: AbortSignal,
    ) {
      return request<WorkItem>(`/work-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        signal,
        body: JSON.stringify({ boardId, state, expectedVersion: item.version }),
      });
    },
  };
}
