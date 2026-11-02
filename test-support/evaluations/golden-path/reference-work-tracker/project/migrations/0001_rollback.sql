-- Restore the original deletion constraints without dropping retained records.
BEGIN;
ALTER TABLE boards DROP CONSTRAINT boards_organization_id_fkey;
ALTER TABLE boards ADD CONSTRAINT boards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id);
ALTER TABLE work_items DROP CONSTRAINT work_items_organization_id_fkey;
ALTER TABLE work_items ADD CONSTRAINT work_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id);
ALTER TABLE work_items DROP CONSTRAINT work_items_board_id_fkey;
ALTER TABLE work_items ADD CONSTRAINT work_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards (id);
ALTER TABLE audit_entries DROP CONSTRAINT audit_entries_organization_id_fkey;
ALTER TABLE audit_entries ADD CONSTRAINT audit_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id);
COMMIT;
