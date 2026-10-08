CREATE TABLE members (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('github')),
    subject TEXT NOT NULL,
    login TEXT NOT NULL,
    grant_projects TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('read', 'write')),
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
) STRICT;
-- One active membership per identity, so sign-in resolves to exactly one account.
CREATE UNIQUE INDEX members_active_identity ON members(provider, subject) WHERE revoked_at IS NULL;
CREATE INDEX members_account ON members(account_id, created_at);
