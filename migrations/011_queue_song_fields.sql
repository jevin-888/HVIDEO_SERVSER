-- 播放队列补充歌曲管理字段，与新版 song.db 对齐
ALTER TABLE room_queue ADD COLUMN songNo        TEXT NOT NULL DEFAULT '';
ALTER TABLE room_queue ADD COLUMN languageCode  TEXT NOT NULL DEFAULT '';
ALTER TABLE room_queue ADD COLUMN classify_code  TEXT NOT NULL DEFAULT '';
ALTER TABLE room_queue ADD COLUMN light_code     TEXT NOT NULL DEFAULT '';
ALTER TABLE room_queue ADD COLUMN songPath      TEXT NOT NULL DEFAULT '';
ALTER TABLE room_queue ADD COLUMN video_file_type TEXT NOT NULL DEFAULT '';
ALTER TABLE room_queue ADD COLUMN track          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_queue ADD COLUMN score_enabled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_queue ADD COLUMN singer_no      TEXT NOT NULL DEFAULT '';
