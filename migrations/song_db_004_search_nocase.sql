-- Replace the binary search indexes with indexes matching SQLite's
-- case-insensitive ASCII LIKE prefix search. Existing song data stays intact.
DROP INDEX IF EXISTS idx_songSearch_name_click;
CREATE INDEX idx_songSearch_name_click ON songSearch(nameKey COLLATE NOCASE, clickTime DESC);

DROP INDEX IF EXISTS idx_songSearch_initial_click;
CREATE INDEX idx_songSearch_initial_click ON songSearch(initialKey COLLATE NOCASE, clickTime DESC);
