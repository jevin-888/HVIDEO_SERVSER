-- 全局画面模式预设
-- presetType: 'display'
-- settings JSON:
--   buttonNameAlias: 发送给终端的按钮别名
--   viewMode:        WebSocket/syncState 中的当前画面模式值
--   icon:            PAD/Web 可选展示图标语义

INSERT OR IGNORE INTO peripheral_presets (id, presetType, name, settings, sortOrder) VALUES
    ('preset-display-fullscreen', 'display', '全屏',   '{"buttonNameAlias":"fullScreenMode","viewMode":0,"icon":"fullscreen"}', 1),
    ('preset-display-pip',        'display', '画中画', '{"buttonNameAlias":"pipMode","viewMode":1,"icon":"pip"}',        2),
    ('preset-display-wall',       'display', '壁画',   '{"buttonNameAlias":"wallPictureMode","viewMode":2,"icon":"mural"}', 3);
