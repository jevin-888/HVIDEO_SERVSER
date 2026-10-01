/**
 * 播放器命令执行结果转展示文案并弹 Toast。
 * 供 PC / 手机端共用，避免重复维护 action -> 文案 映射。
 */

const COMMAND_LABELS = {
  Play: '播放',
  Pause: '暂停',
  Replay: '重唱',
  SkipSong: '切歌',
  NextSong: '下一首',
  SwitchTrack: '切换原伴唱',
  SetVolume: '调节音量',
  SetMic: '麦克风切换',
  ClearQueue: '清空列表',
  SetAC: '空调控制',
  SetLight: '灯光控制',
  SetEffect: '音效控制',
  PlayAmbiance: '氛围音效',
  ServiceCall: '服务呼叫',
  PlayMaterial: '播放素材',
  PlayStream: '播放流媒体',
  PlayUrl: '播放链接',
  StopStream: '停止流媒体'
};

function getCommandLabel(action) {
  if (!action) return '操作';
  return COMMAND_LABELS[action] || action;
}

export function getCommandResultMessage(result) {
  if (!result || !result.action) return null;

  const label = getCommandLabel(result.action);
  const ok = Number(result.ok ?? 1);
  const message = String(result.message || '').trim();

  if (ok === 1) {
    return `${label}成功`;
  }

  return message ? `${label}失败：${message}` : `${label}失败`;
}

export function showCommandResultToast(result, toastService, duration) {
  if (!toastService || typeof toastService.showToast !== 'function') return null;
  const message = getCommandResultMessage(result);
  if (!message) return null;

  const ok = Number(result.ok ?? 1);
  toastService.showToast(message, ok === 1 ? 'success' : 'error', duration ?? (ok === 1 ? 1000 : 1800));
  return message;
}
