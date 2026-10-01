-- 服务铃呼叫记录增加备注字段（用于携带数量等附加信息）
ALTER TABLE service_calls ADD COLUMN callNote TEXT NOT NULL DEFAULT '';
