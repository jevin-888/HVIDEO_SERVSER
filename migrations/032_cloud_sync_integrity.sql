-- 同一云端文件只允许存在一个待处理或执行中的下载任务，防止按钮连点造成重复下载。
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY taskType, targetType, targetId, cloud_url
               ORDER BY datetime(createdAt) DESC, id DESC
           ) AS row_no
    FROM sync_tasks
    WHERE status IN (0, 1)
)
UPDATE sync_tasks
SET status = 3,
    errorMessage = '重复任务已自动停止，可按需重新导入',
    updatedAt = datetime('now','localtime')
WHERE id IN (SELECT id FROM ranked WHERE row_no > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_tasks_active_target
ON sync_tasks(taskType, targetType, targetId, cloud_url)
WHERE status IN (0, 1);
