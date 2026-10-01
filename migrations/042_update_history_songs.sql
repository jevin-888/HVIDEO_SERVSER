CREATE TABLE update_history_songs (
 history_id TEXT NOT NULL, file_name TEXT NOT NULL, position INTEGER NOT NULL,
 song_no TEXT NOT NULL DEFAULT '', song_name TEXT NOT NULL DEFAULT '', singer TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'waiting', message TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(history_id,file_name)
);
CREATE TRIGGER update_history_songs_delete AFTER DELETE ON update_history
 BEGIN
 DELETE FROM update_history_songs WHERE history_id=OLD.id;
 END;
CREATE TRIGGER update_history_songs_failed AFTER UPDATE OF status ON update_history
 WHEN NEW.status=3
 BEGIN
 UPDATE update_history_songs SET status=CASE WHEN status IN ('downloading','installing','failed') THEN 'failed' ELSE 'unfinished' END,
 message=NEW.message WHERE history_id=NEW.id AND status!='completed';
 END;
