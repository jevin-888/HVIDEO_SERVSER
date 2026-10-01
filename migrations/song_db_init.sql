-- ============================================================
-- HVideo 歌曲数据库 (Unified Runtime song.db Schema)
-- 必须与 tools/convert_song_db.py 和单机版 generated/song.db 保持一致
-- ============================================================

CREATE TABLE IF NOT EXISTS schemaMigrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    appliedTime INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
    songId INTEGER PRIMARY KEY AUTOINCREMENT,
    songNo TEXT NOT NULL UNIQUE,
    songName TEXT NOT NULL,
    primarySingerNo TEXT,
    primarySingerName TEXT,
    singerNames TEXT,
    initialKey TEXT,
    languageCode TEXT,
    languageName TEXT,
    categoryCode TEXT,
    categoryName TEXT,
    versionName TEXT,
    track INTEGER,
    scoreEnabled INTEGER DEFAULT 0,
    videoFileType TEXT,
    relativePath TEXT,
    fileName TEXT,
    absolutePath TEXT,
    fileExists INTEGER DEFAULT 0,
    fileSize INTEGER DEFAULT 0,
    durationMs INTEGER DEFAULT 0,
    addedTime INTEGER DEFAULT 0,
    addedBatchId TEXT,
    clickTime INTEGER DEFAULT 0,
    localPlayCount INTEGER DEFAULT 0,
    lastPlayedTime INTEGER DEFAULT 0,
    sourceType TEXT,
    sourceSongId TEXT,
    createdTime INTEGER NOT NULL DEFAULT 0,
    updatedTime INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS singers (
    singerId INTEGER PRIMARY KEY AUTOINCREMENT,
    singerNo TEXT NOT NULL UNIQUE,
    singerName TEXT NOT NULL,
    initialKey TEXT,
    regionCode TEXT,
    regionName TEXT,
    sexCode TEXT,
    sexName TEXT,
    hit INTEGER DEFAULT 0,
    songCount INTEGER DEFAULT 0,
    sourceType TEXT,
    sourceSingerId TEXT,
    createdTime INTEGER NOT NULL DEFAULT 0,
    updatedTime INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS songSingers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    songNo TEXT NOT NULL,
    singerNo TEXT NOT NULL,
    singerName TEXT NOT NULL,
    languageCode TEXT,
    categoryCode TEXT,
    fileExists INTEGER DEFAULT 0,
    clickTime INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0,
    UNIQUE(songNo, singerNo)
);

CREATE TABLE IF NOT EXISTS songSearch (
    songNo TEXT PRIMARY KEY,
    songName TEXT NOT NULL,
    singerNames TEXT,
    nameKey TEXT NOT NULL,
    initialKey TEXT,
    languageCode TEXT,
    categoryCode TEXT,
    primarySingerNo TEXT,
    fileExists INTEGER DEFAULT 0,
    addedTime INTEGER DEFAULT 0,
    addedBatchId TEXT,
    clickTime INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS songBatches (
    batchId TEXT PRIMARY KEY,
    batchName TEXT NOT NULL,
    batchType TEXT NOT NULL,
    isNewBatch INTEGER DEFAULT 0,
    songCount INTEGER DEFAULT 0,
    createdTime INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dictGroup TEXT NOT NULL,
    dictCode TEXT NOT NULL,
    dictName TEXT NOT NULL,
    sortOrder INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    sourceDictId TEXT,
    UNIQUE(dictGroup, dictCode)
);

CREATE TABLE IF NOT EXISTS songFiles (
    songNo TEXT PRIMARY KEY,
    relativePath TEXT,
    fileName TEXT,
    absolutePath TEXT,
    fileExists INTEGER DEFAULT 0,
    fileSize INTEGER DEFAULT 0,
    durationMs INTEGER DEFAULT 0,
    videoCodec TEXT,
    audioCodec TEXT,
    lastCheckedTime INTEGER DEFAULT 0,
    lastError TEXT
);

CREATE TABLE IF NOT EXISTS importTasks (
    taskId TEXT PRIMARY KEY,
    sourceType TEXT NOT NULL,
    sourcePath TEXT NOT NULL,
    status TEXT NOT NULL,
    totalCount INTEGER DEFAULT 0,
    importedCount INTEGER DEFAULT 0,
    skippedCount INTEGER DEFAULT 0,
    failedCount INTEGER DEFAULT 0,
    startedTime INTEGER,
    finishedTime INTEGER,
    errorMessage TEXT
);

CREATE INDEX IF NOT EXISTS idx_songs_initial_click ON songs(initialKey, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songs_language_click ON songs(languageCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songs_category_click ON songs(categoryCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songs_language_category_click ON songs(languageCode, categoryCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songs_file_click ON songs(fileExists, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songs_added ON songs(addedTime DESC);
CREATE INDEX IF NOT EXISTS idx_songs_added_batch ON songs(addedBatchId, addedTime DESC);
CREATE INDEX IF NOT EXISTS idx_singers_initial_hit ON singers(initialKey, hit DESC);
CREATE INDEX IF NOT EXISTS idx_singers_region_hit ON singers(regionCode, hit DESC);
CREATE INDEX IF NOT EXISTS idx_singers_sex_hit ON singers(sexCode, hit DESC);
CREATE INDEX IF NOT EXISTS idx_songSingers_songNo ON songSingers(songNo);
CREATE INDEX IF NOT EXISTS idx_songSingers_singer_click ON songSingers(singerNo, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSingers_singer_file_click ON songSingers(singerNo, fileExists, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSingers_singer_lang_click ON songSingers(singerNo, languageCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSingers_singer_cat_click ON songSingers(singerNo, categoryCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_file_click ON songSearch(fileExists, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_file_language_click ON songSearch(fileExists, languageCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_file_category_click ON songSearch(fileExists, categoryCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_file_lang_cat_click ON songSearch(fileExists, languageCode, categoryCode, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_name_click ON songSearch(nameKey, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_initial_click ON songSearch(initialKey, clickTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_added ON songSearch(fileExists, addedTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_added_batch ON songSearch(fileExists, addedBatchId, addedTime DESC);
CREATE INDEX IF NOT EXISTS idx_songSearch_added_batch_category ON songSearch(fileExists, addedBatchId, categoryCode, addedTime DESC);
CREATE INDEX IF NOT EXISTS idx_songBatches_new ON songBatches(isNewBatch, createdTime DESC);
CREATE INDEX IF NOT EXISTS idx_songFiles_fileExists ON songFiles(fileExists);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dicts_group_code ON dicts(dictGroup, dictCode);
