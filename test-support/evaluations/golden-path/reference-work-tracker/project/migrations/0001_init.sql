BEGIN;

CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE boards (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id),
  title TEXT NOT NULL
);

CREATE TABLE work_items (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id),
  board_id UUID NOT NULL REFERENCES boards (id),
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'todo',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id),
  actor_id UUID NOT NULL,
  item_id UUID NOT NULL,
  action TEXT NOT NULL
);

CREATE INDEX work_items_organization_board_idx ON work_items (organization_id, board_id);

COMMIT;
