CREATE TABLE update_history_deletions (
    endpoint TEXT NOT NULL,
    id TEXT NOT NULL,
    sync_state INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(endpoint,id)
);
