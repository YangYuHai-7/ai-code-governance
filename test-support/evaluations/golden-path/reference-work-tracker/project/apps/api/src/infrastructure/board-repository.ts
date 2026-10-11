import type { Board, WorkItem, WorkItemState } from "../domain/index";
import {
  createDatabase,
  sqlLiteral,
  type Database,
  type DatabaseConfig,
} from "./db";

function board(row: string[]): Board {
  return { id: row[0], organizationId: row[1], title: row[2] };
}
function item(row: string[]): WorkItem {
  return {
    id: row[0],
    organizationId: row[1],
    boardId: row[2],
    title: row[3],
    state: row[4] as WorkItemState,
    version: Number(row[5]),
  };
}

export function createBoardRepository(
  config: DatabaseConfig,
  database: Database = createDatabase(config),
) {
  return {
    database,
    boards(organizationId: string): Board[] {
      return database
        .query(
          `SELECT id, organization_id, title FROM boards WHERE organization_id = ${sqlLiteral(organizationId)} ORDER BY title`,
        )
        .map(board);
    },
    items(organizationId: string, boardId: string): WorkItem[] {
      return database
        .query(
          `SELECT id, organization_id, board_id, title, state, version FROM work_items WHERE organization_id = ${sqlLiteral(organizationId)} AND board_id = ${sqlLiteral(boardId)} ORDER BY title`,
        )
        .map(item);
    },
    save(updated: WorkItem, action: string, actorId = "actor.session"): void {
      // One transaction: the state change and its audit entry are accepted or rejected together.
      database.execute(
        [
          "BEGIN",
          `INSERT INTO work_items (id, organization_id, board_id, title, state, version) VALUES (${sqlLiteral(updated.id)}, ${sqlLiteral(updated.organizationId)}, ${sqlLiteral(updated.boardId)}, ${sqlLiteral(updated.title)}, ${sqlLiteral(updated.state)}, ${updated.version}) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, version = EXCLUDED.version, title = EXCLUDED.title`,
          `INSERT INTO audit_entries (id, organization_id, actor_id, item_id, action) VALUES (gen_random_uuid(), ${sqlLiteral(updated.organizationId)}, ${sqlLiteral(actorId)}, ${sqlLiteral(updated.id)}, ${sqlLiteral(action)})`,
          "COMMIT",
        ].join("; "),
      );
    },
  };
}

export type BoardRepository = ReturnType<typeof createBoardRepository>;
