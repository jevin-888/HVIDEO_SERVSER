ALTER TABLE importTasks ADD COLUMN processedCount INTEGER DEFAULT 0;
ALTER TABLE importTasks ADD COLUMN insertedCount INTEGER DEFAULT 0;
ALTER TABLE importTasks ADD COLUMN updatedCount INTEGER DEFAULT 0;
ALTER TABLE importTasks ADD COLUMN currentRow INTEGER DEFAULT 0;
ALTER TABLE importTasks ADD COLUMN updatedTime INTEGER DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_importTasks_single_active
ON importTasks((1)) WHERE status IN ('pending', 'running');
