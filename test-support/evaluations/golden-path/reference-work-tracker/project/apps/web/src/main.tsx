import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import type { Board, WorkItem } from "../../../packages/contracts/src/index";
import { BoardList } from "./features/boards/index";
import { WorkItemBoard } from "./features/work-items/index";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:3103";
const ORGANIZATION_ID =
  (import.meta.env.VITE_ORGANIZATION_ID as string | undefined) ??
  "11111111-1111-1111-1111-111111111111";

export function App() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);

  useEffect(() => {
    void fetch(`${API_BASE}/boards?organizationId=${ORGANIZATION_ID}`)
      .then((response) => response.json())
      .then((payload: { items: Board[] }) => {
        setBoards(payload.items);
        setSelected(payload.items[0]?.id ?? null);
      });
  }, []);

  useEffect(() => {
    if (selected === null) return;
    void fetch(
      `${API_BASE}/boards/${selected}/items?organizationId=${ORGANIZATION_ID}`,
    )
      .then((response) => response.json())
      .then((payload: { items: WorkItem[] }) => setItems(payload.items));
  }, [selected]);

  async function move(item: WorkItem, next: WorkItem["state"]) {
    if (selected === null) return;
    await fetch(`${API_BASE}/work-items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: ORGANIZATION_ID,
        actorId: "member-synthetic-1",
        boardId: selected,
        state: next,
        expectedVersion: item.version,
      }),
    });
    const refreshed = await fetch(
      `${API_BASE}/boards/${selected}/items?organizationId=${ORGANIZATION_ID}`,
    );
    if (refreshed.ok)
      setItems(((await refreshed.json()) as { items: WorkItem[] }).items);
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Reference work tracker</h1>
      <BoardList boards={boards} selectedId={selected} onSelect={setSelected} />
      <WorkItemBoard
        items={items}
        onMove={(item, next) => void move(item, next)}
      />
    </main>
  );
}

const container = document.getElementById("root");
if (container)
  createRoot(container).render(
    <StrictMode>
      <MantineProvider>
        <App />
      </MantineProvider>
    </StrictMode>,
  );
