DROP TRIGGER memories_no_update;
DROP TRIGGER memories_no_delete;

ALTER TABLE memories ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE memories ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'migration';
ALTER TABLE memories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE memories SET updated_by = agent_id, updated_at = created_at;

CREATE TRIGGER memories_fts_update AFTER UPDATE OF content ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
