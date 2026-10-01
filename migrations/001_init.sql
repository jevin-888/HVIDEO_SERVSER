-- ============================================================
-- HVideo 点歌系统数据库初始化
-- ============================================================

-- 歌星表
CREATE TABLE IF NOT EXISTS artists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    pinyin      TEXT NOT NULL DEFAULT '',      -- 拼音（用于搜索）
    initial     TEXT NOT NULL DEFAULT '',      -- 首字母
    gender      INTEGER NOT NULL DEFAULT 0,    -- 0:未知 1:男 2:女 3:组合
    region      TEXT NOT NULL DEFAULT '',      -- 地区
    avatar_url  TEXT NOT NULL DEFAULT '',      -- 头像地址
    song_count  INTEGER NOT NULL DEFAULT 0,    -- 歌曲数量（冗余，提升查询性能）
    status      INTEGER NOT NULL DEFAULT 1,    -- 0:禁用 1:启用
    createdAt  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_artists_pinyin ON artists(pinyin);
CREATE INDEX IF NOT EXISTS idx_artists_initial ON artists(initial);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

-- 歌曲表
CREATE TABLE IF NOT EXISTS songs (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    pinyin          TEXT NOT NULL DEFAULT '',       -- 拼音
    initial         TEXT NOT NULL DEFAULT '',       -- 首字母
    artist_id       TEXT NOT NULL DEFAULT '',       -- 歌星ID
    artistName     TEXT NOT NULL DEFAULT '',       -- 歌星名（冗余）
    language        TEXT NOT NULL DEFAULT '',       -- 语种: 国语/粤语/英语/日语/韩语/其他
    genre           TEXT NOT NULL DEFAULT '',       -- 分类: 流行/摇滚/民谣/古典 等
    duration        INTEGER NOT NULL DEFAULT 0,     -- 时长(秒)
    filePath       TEXT NOT NULL DEFAULT '',       -- 本地文件路径
    mv_path         TEXT NOT NULL DEFAULT '',       -- MV文件路径
    cloudFileId   TEXT NOT NULL DEFAULT '',       -- 云端文件ID
    file_hash       TEXT NOT NULL DEFAULT '',       -- 文件哈希值（校验完整性）
    fileSize       INTEGER NOT NULL DEFAULT 0,     -- 文件大小(字节)
    quality         INTEGER NOT NULL DEFAULT 0,     -- 音质: 0:标准 1:高清 2:无损
    play_count      INTEGER NOT NULL DEFAULT 0,     -- 播放次数
    is_hot          INTEGER NOT NULL DEFAULT 0,     -- 是否热门
    is_new          INTEGER NOT NULL DEFAULT 0,     -- 是否新歌
    status          INTEGER NOT NULL DEFAULT 1,     -- 0:禁用 1:启用 2:下载中
    createdAt      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_pinyin ON songs(pinyin);
CREATE INDEX IF NOT EXISTS idx_songs_initial ON songs(initial);
CREATE INDEX IF NOT EXISTS idx_songs_artist_id ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_language ON songs(language);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_play_count ON songs(play_count DESC);

-- 房间表
CREATE TABLE IF NOT EXISTS rooms (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    terminalId     TEXT NOT NULL DEFAULT '',        -- 关联终端ID
    room_type       INTEGER NOT NULL DEFAULT 0,      -- 0:标准 1:VIP 2:总统
    status          INTEGER NOT NULL DEFAULT 0,      -- 0:空闲 1:使用中 2:维护中
    currentSongId TEXT NOT NULL DEFAULT '',        -- 当前播放歌曲ID
    volume          INTEGER NOT NULL DEFAULT 50,     -- 音量 0-100
    micStatus      INTEGER NOT NULL DEFAULT 1,      -- 麦克风 0:关 1:开
    createdAt      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_terminal_id ON rooms(terminalId);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- 房间已点歌曲队列
CREATE TABLE IF NOT EXISTS room_queue (
    id          TEXT PRIMARY KEY,
    roomId     TEXT NOT NULL,
    songId     TEXT NOT NULL,
    songTitle  TEXT NOT NULL DEFAULT '',
    artistName TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,     -- 队列位置
    status      INTEGER NOT NULL DEFAULT 0,     -- 0:等待 1:播放中 2:已播放 3:已跳过
    isPriority INTEGER NOT NULL DEFAULT 0,     -- 是否置顶（插播）
    addedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_room_queue_room_id ON room_queue(roomId, position);

-- 终端设备表
CREATE TABLE IF NOT EXISTS terminals (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    terminalIp      TEXT NOT NULL,
    macAddress     TEXT NOT NULL DEFAULT '',
    port            INTEGER NOT NULL DEFAULT 5000,
    deviceType     TEXT NOT NULL DEFAULT 'ktv',     -- ktv/tv/mobile
    roomId         TEXT NOT NULL DEFAULT '',
    onlineStatus   INTEGER NOT NULL DEFAULT 0,      -- 0:离线 1:在线
    lastHeartbeat  TEXT NOT NULL DEFAULT '',
    hardwareInfo   TEXT NOT NULL DEFAULT '',         -- JSON: 硬件信息
    softwareVer    TEXT NOT NULL DEFAULT '',         -- 客户端版本
    createdAt      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_ip ON terminals(terminalIp);
CREATE INDEX IF NOT EXISTS idx_terminals_online ON terminals(onlineStatus);

-- API 用户/密钥表（接口注册管理）
CREATE TABLE IF NOT EXISTS api_clients (
    id              TEXT PRIMARY KEY,
    clientName     TEXT NOT NULL,
    clientKey      TEXT NOT NULL UNIQUE,         -- API Key
    clientSecret   TEXT NOT NULL,                -- API Secret（bcrypt加密）
    permissions     TEXT NOT NULL DEFAULT '[]',   -- JSON: 权限列表
    rateLimit      INTEGER NOT NULL DEFAULT 100, -- 每分钟请求限制
    status          INTEGER NOT NULL DEFAULT 1,   -- 0:禁用 1:启用
    lastAccess     TEXT NOT NULL DEFAULT '',
    createdAt      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_clients_key ON api_clients(clientKey);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
    id          TEXT PRIMARY KEY,
    clientId   TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL,
    targetType TEXT NOT NULL DEFAULT '',     -- song/artist/room/terminal
    targetId   TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '',     -- JSON: 详细信息
    ipAddress   TEXT NOT NULL DEFAULT '',
    createdAt  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_logs_client ON operation_logs(clientId);
CREATE INDEX IF NOT EXISTS idx_logs_action ON operation_logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(createdAt);

-- 云端同步任务表
CREATE TABLE IF NOT EXISTS sync_tasks (
    id              TEXT PRIMARY KEY,
    taskType       TEXT NOT NULL,              -- upload/download
    targetType     TEXT NOT NULL,              -- song/artist
    targetId       TEXT NOT NULL,
    cloud_url       TEXT NOT NULL DEFAULT '',
    localPath      TEXT NOT NULL DEFAULT '',
    fileSize       INTEGER NOT NULL DEFAULT 0,
    downloaded_size INTEGER NOT NULL DEFAULT 0,
    status          INTEGER NOT NULL DEFAULT 0, -- 0:待处理 1:进行中 2:完成 3:失败
    retry_count     INTEGER NOT NULL DEFAULT 0,
    errorMessage   TEXT NOT NULL DEFAULT '',
    createdAt      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sync_tasks_status ON sync_tasks(status);
