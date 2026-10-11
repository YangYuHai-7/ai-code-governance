import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const workItems = pgTable("work_items", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  boardId: uuid("board_id").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditEntries = pgTable("audit_entries", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  itemId: uuid("item_id").notNull(),
  action: text("action").notNull(),
});
