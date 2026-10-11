import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createBoardService } from "../../apps/api/src/application/index";
import { createBoardRepository } from "../../apps/api/src/infrastructure/index";
import { readDatabaseConfig } from "../../apps/api/src/infrastructure/db";

// This gate needs a real database. It fails instead of passing with a stub: the tenant boundary,
// optimistic versioning, and the audit transaction are exactly what an in-memory double cannot prove.
const config = readDatabaseConfig(process.env);
const repository = createBoardRepository(config);
const service = createBoardService(repository);
const organization = randomUUID();
const otherOrganization = randomUUID();
const board = randomUUID();
const item = randomUUID();

beforeAll(() => {
  try {
    repository.database.applyFile("migrations/0001_init.sql");
  } catch (error) {
    throw new Error(
      `this integration gate requires PostgreSQL: ${(error as Error).message}`,
    );
  }
  repository.database.execute(
    `INSERT INTO organizations (id, name) VALUES ('${organization}', 'Integration tenant'), ('${otherOrganization}', 'Other tenant') ON CONFLICT (id) DO NOTHING`,
  );
  repository.database.execute(
    `INSERT INTO boards (id, organization_id, title) VALUES ('${board}', '${organization}', 'Integration board') ON CONFLICT (id) DO NOTHING`,
  );
  repository.database.execute(
    `INSERT INTO work_items (id, organization_id, board_id, title, state, version) VALUES ('${item}', '${organization}', '${board}', 'Integration item', 'todo', 1) ON CONFLICT (id) DO UPDATE SET state = 'todo', version = 1`,
  );
});

describe("board service against PostgreSQL", () => {
  it("keeps the tenant boundary", () => {
    expect(service.listBoards(organization).map((entry) => entry.id)).toContain(
      board,
    );
    expect(service.listBoards(otherOrganization)).toHaveLength(0);
  });

  it("persists a state change with its audit entry in one transaction", () => {
    const moved = service.moveItem(
      organization,
      "member-synthetic-1",
      board,
      item,
      "in-progress",
      1,
    );
    expect(moved.state).toBe("in-progress");
    expect(moved.version).toBe(2);
    const [row] = repository.database.query(
      `SELECT state, version FROM work_items WHERE id = '${item}'`,
    );
    expect(row).toEqual(["in-progress", "2"]);
    const [audit] = repository.database.query(
      `SELECT count(*) FROM audit_entries WHERE item_id = '${item}'`,
    );
    expect(audit).toEqual(["1"]);
  });

  it("refuses a stale write and a cross-tenant write", () => {
    expect(() =>
      service.moveItem(
        organization,
        "member-synthetic-1",
        board,
        item,
        "done",
        1,
      ),
    ).toThrowError(/version/i);
    expect(() =>
      service.moveItem(
        otherOrganization,
        "member-synthetic-2",
        board,
        item,
        "done",
        2,
      ),
    ).toThrowError(/not found/i);
    const [row] = repository.database.query(
      `SELECT state, version FROM work_items WHERE id = '${item}'`,
    );
    expect(row).toEqual(["in-progress", "2"]);
  });
});
