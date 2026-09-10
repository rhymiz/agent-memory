CREATE TABLE memories (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('fact','observation','decision','constraint','note','result')),
  content TEXT NOT NULL, importance REAL CHECK(importance BETWEEN 0 AND 1),
  metadata TEXT CHECK(metadata IS NULL OR json_valid(metadata)), created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX memories_project ON memories(project_id, created_at);
CREATE VIRTUAL TABLE memories_fts USING fts5(content, content='memories', content_rowid='rowid');
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER memories_no_update BEFORE UPDATE ON memories BEGIN
  SELECT RAISE(ABORT, 'Memories are append-only');
END;
CREATE TRIGGER memories_no_delete BEFORE DELETE ON memories BEGIN
  SELECT RAISE(ABORT, 'Memories are append-only');
END;

CREATE TABLE claims (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, resource TEXT NOT NULL, agent_id TEXT NOT NULL,
  intent TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(project_id, resource), CHECK(expires_at > created_at)
) STRICT;
CREATE INDEX claims_expiry ON claims(project_id, expires_at);

CREATE TABLE project_contexts (
  project_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE decisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, subject TEXT NOT NULL, decision TEXT NOT NULL,
  reasoning TEXT, status TEXT NOT NULL CHECK(status IN ('active','superseded')),
  supersedes_id TEXT UNIQUE, agent_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, supersedes_id) REFERENCES decisions(project_id, id)
) STRICT;
CREATE INDEX decisions_project ON decisions(project_id, status, created_at);

CREATE TABLE activity (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_id TEXT NOT NULL, type TEXT NOT NULL,
  resource TEXT, message TEXT, metadata TEXT CHECK(metadata IS NULL OR json_valid(metadata)), created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX activity_project ON activity(project_id, created_at);
CREATE TRIGGER activity_no_update BEFORE UPDATE ON activity BEGIN
  SELECT RAISE(ABORT, 'Activity is append-only');
END;
CREATE TRIGGER activity_no_delete BEFORE DELETE ON activity BEGIN
  SELECT RAISE(ABORT, 'Activity is append-only');
END;
