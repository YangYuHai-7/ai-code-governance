import { randomUUID } from "node:crypto";
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
      const expected = updated.version - 1;
      const id = sqlLiteral(updated.id);
      const organization = sqlLiteral(updated.organizationId);
      // Each attempt carries its own token in the audit action. The update is conditional on the
      // version the caller saw, the audit row is written only from the rows that update returned,
      // and the attempt is confirmed by looking for its own token. Comparing the row's final
      // version instead would let a later writer mistake another writer's commit for its own.
      const token = randomUUID();
      const taggedAction = `${action}#${token}`;
      database.execute(
        [
          "BEGIN",
          `WITH updated AS (UPDATE work_items SET state = ${sqlLiteral(updated.state)}, version = ${updated.version} WHERE id = ${id} AND organization_id = ${organization} AND version = ${expected} RETURNING id) INSERT INTO audit_entries (id, organization_id, actor_id, item_id, action) SELECT gen_random_uuid(), ${organization}, ${sqlLiteral(actorId)}, id, ${sqlLiteral(taggedAction)} FROM updated`,
          "COMMIT",
        ].join("; "),
      );
      const [row] = database.query(
        `SELECT count(*) FROM audit_entries WHERE item_id = ${id} AND action = ${sqlLiteral(taggedAction)}`,
      );
      if (Number(row?.[0]) !== 1) {
        const error = new Error(
          "the item version changed while this write was in flight",
        );
        error.name = "ConflictError";
        throw error;
      }
    },
  };
}

export type BoardRepository = ReturnType<typeof createBoardRepository>;
