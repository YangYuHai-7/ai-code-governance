BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'todo',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  item_id UUID NOT NULL,
  action TEXT NOT NULL
);

-- Upgrade existing evaluation databases as well as fresh installations.
ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_organization_id_fkey;
ALTER TABLE boards ADD CONSTRAINT boards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_organization_id_fkey;
ALTER TABLE work_items ADD CONSTRAINT work_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_board_id_fkey;
ALTER TABLE work_items ADD CONSTRAINT work_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE;
ALTER TABLE audit_entries DROP CONSTRAINT IF EXISTS audit_entries_organization_id_fkey;
ALTER TABLE audit_entries ADD CONSTRAINT audit_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS work_items_organization_board_idx ON work_items (organization_id, board_id);

COMMIT;
