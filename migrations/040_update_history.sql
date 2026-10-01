-- Immutable attempt identity and durable outbox; no foreign key to deletable tasks/packages.
CREATE TABLE update_history (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, package_id TEXT NOT NULL,
 package_name TEXT NOT NULL, package_type TEXT NOT NULL, version_code INTEGER NOT NULL,
 package_revision TEXT NOT NULL, endpoint TEXT NOT NULL,
 video_count INTEGER, imported_count INTEGER, file_size INTEGER NOT NULL DEFAULT 0,
 downloaded_size INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL,
 local_path TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
 sequence INTEGER NOT NULL DEFAULT 1, ack_sequence INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX update_history_date ON update_history(started_at DESC);
CREATE INDEX update_history_task ON update_history(task_id);
INSERT INTO update_history(id,task_id,package_id,package_name,package_type,version_code,package_revision,endpoint,imported_count,file_size,downloaded_size,status,local_path,message,started_at,updated_at,finished_at)
 SELECT id,id,targetId,
 CASE WHEN errorMessage LIKE '更新完成：%'
 THEN substr(errorMessage,6,CASE WHEN instr(errorMessage,'，已入库视频')>0 THEN instr(errorMessage,'，已入库视频')-6 ELSE length(errorMessage) END)
 WHEN errorMessage LIKE '等待更新：%' THEN substr(errorMessage,6) ELSE targetId END,
 'legacy',0,CASE WHEN instr(cloud_url,'#')>0 THEN substr(cloud_url,instr(cloud_url,'#')+1) ELSE '' END,
 CASE WHEN instr(cloud_url,'#')>0 THEN substr(cloud_url,1,instr(cloud_url,'#')-1) ELSE cloud_url END,
 CASE WHEN status=2 AND instr(errorMessage,'，已入库视频 ')>0 THEN CAST(substr(errorMessage,instr(errorMessage,'，已入库视频 ')+7) AS INTEGER) ELSE NULL END,
 fileSize,downloaded_size,status,localPath,errorMessage,createdAt,updatedAt,CASE WHEN status IN(2,3) THEN updatedAt END
 FROM sync_tasks WHERE targetType='vodPackage';
CREATE TRIGGER update_history_progress AFTER UPDATE ON sync_tasks
 WHEN NEW.targetType='vodPackage'
 BEGIN
 UPDATE update_history SET status=NEW.status,local_path=NEW.localPath,
 file_size=NEW.fileSize,downloaded_size=NEW.downloaded_size,message=substr(NEW.errorMessage,1,4000),
 imported_count=CASE WHEN NEW.status=2 THEN video_count ELSE imported_count END,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 finished_at=CASE WHEN NEW.status IN(2,3) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
 sequence=sequence+1 WHERE task_id=NEW.id AND status IN(0,1);
 END;
