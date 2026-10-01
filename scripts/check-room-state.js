#!/usr/bin/env node

/**
 * 检查房间状态脚本
 * 直接查询数据库中的房间状态
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'hvideo.db');

console.log('正在查询数据库:', dbPath);
console.log('');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('无法打开数据库:', err.message);
    process.exit(1);
  }
});

const query = `
  SELECT 
    roomName,
    playState,
    volume,
    musicVolume,
    micVolume,
    muteStatus,
    micStatus,
    currentSongId,
    updated_at
  FROM rooms 
  WHERE roomName = 'A02'
`;

db.get(query, [], (err, row) => {
  if (err) {
    console.error('查询失败:', err.message);
    db.close();
    process.exit(1);
  }

  if (!row) {
    console.log('未找到房间 A02');
    db.close();
    process.exit(0);
  }

  console.log('房间 A02 的当前状态：');
  console.log('=====================================');
  console.log('房间名称:', row.roomName);
  console.log('播放状态:', row.playState, row.playState === 1 ? '(播放中)' : row.playState === 2 ? '(暂停)' : '(停止)');
  console.log('音量:', row.volume);
  console.log('音乐音量:', row.musicVolume);
  console.log('麦克风音量:', row.micVolume);
  console.log('静音状态:', row.muteStatus, row.muteStatus === 1 ? '(静音)' : '(未静音)');
  console.log('麦克风状态:', row.micStatus);
  console.log('当前歌曲ID:', row.currentSongId || '(无)');
  console.log('最后更新时间:', row.updated_at);
  console.log('=====================================');

  db.close();
});
