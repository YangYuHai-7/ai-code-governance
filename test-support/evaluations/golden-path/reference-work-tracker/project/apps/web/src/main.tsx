import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import type { Board, WorkItem } from "../../../packages/contracts/src/index";
import { BoardList } from "./features/boards/index";
import { createClient } from "./api-client";
import { WorkItemBoard } from "./features/work-items/index";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:3103";
const client = createClient(
  API_BASE,
  (import.meta.env.VITE_SESSION_TOKEN as string | undefined) ?? "",
);

export function App() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mutation = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void client
      .boards(controller.signal)
      .then((payload) => {
        if (!active) return;
        setBoards(payload.items);
        setSelected(payload.items[0]?.id ?? null);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    mutation.current?.abort();
    const controller = new AbortController();
    let active = true;
    setItems([]);
    if (selected !== null) {
      void client
        .items(selected, controller.signal)
        .then((payload) => {
          if (active && current === generation.current) setItems(payload);
        })
        .catch((failure: Error) => {
          if (active) setError(failure.message);
        });
    }
    return () => {
      active = false;
      ++generation.current;
      controller.abort();
      mutation.current?.abort();
    };
  }, [selected]);

  async function move(item: WorkItem, next: WorkItem["state"]) {
    if (selected === null) return;
    mutation.current?.abort();
    const controller = new AbortController();
    mutation.current = controller;
    const current = generation.current;
    setError(null);
    try {
      await client.move(selected, item, next, controller.signal);
      const refreshed = await client.items(selected, controller.signal);
      if (!controller.signal.aborted && current === generation.current)
        setItems(refreshed);
    } catch (failure) {
      if (!controller.signal.aborted && current === generation.current)
        setError((failure as Error).message);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Reference work tracker</h1>
      {error && <p role="alert">{error}</p>}
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
