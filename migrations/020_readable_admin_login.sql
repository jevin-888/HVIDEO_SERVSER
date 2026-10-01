UPDATE api_clients
SET clientKey = 'admin',
    clientName = CASE WHEN clientName IS NULL OR clientName = '' OR clientName LIKE 'hv_%' THEN '系统管理员' ELSE clientName END,
    updatedAt = datetime('now','localtime')
WHERE clientKey LIKE 'hv_%'
  AND NOT EXISTS (SELECT 1 FROM api_clients WHERE clientKey = 'admin')
  AND (permissions LIKE '%admin%' OR permissions LIKE '%write%');
