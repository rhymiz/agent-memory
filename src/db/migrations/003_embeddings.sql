CREATE TABLE memory_embeddings (
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    memory_version INTEGER NOT NULL CHECK (memory_version > 0),
    model_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    vector BLOB NOT NULL,
    PRIMARY KEY (memory_id, chunk_index)
) STRICT;

-- A version change invalidates every old chunk, even for direct database maintenance.
CREATE TRIGGER memory_embeddings_invalidate AFTER UPDATE ON memories BEGIN
    DELETE FROM memory_embeddings WHERE memory_id = NEW.id;
END;
