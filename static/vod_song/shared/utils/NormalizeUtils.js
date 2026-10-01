/**
 * List item normalizers. API envelope parsing stays in ResponseParser.
 */
import { parseApiArrayResponse } from './ResponseParser.js';

export function isSafeArray(value) {
  return Array.isArray(value);
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

export function isEmptyArray(value) {
  return !Array.isArray(value) || value.length === 0;
}

function toKey(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function requireItems(items, resourceName) {
  if (!Array.isArray(items)) {
    throw new TypeError(`${resourceName} items must be an array`);
  }
  return items;
}

function normalizeSongEntry(item) {
  if (!item || typeof item !== 'object') return null;

  const songNo = toKey(item.songNo);
  if (!songNo) return null;

  const primarySingerNo = toKey(item.primarySingerNo);
  const singerNames = firstNonBlank(item.singerNames, item.primarySingerName);
  const initialKey = item.initialKey ?? item.songNameFirstChar ?? '';

  return {
    ...item,
    songNo,
    songName: item.songName == null || item.songName === '' ? 'Unknown song' : String(item.songName),
    singerNames,
    singerName: singerNames,
    initialKey: toKey(initialKey),
    songNameFirstChar: toKey(initialKey),
    primarySingerNo,
    singerNo: primarySingerNo
  };
}

function normalizeSingerEntry(item) {
  if (!item || typeof item !== 'object') return null;

  const singerNo = toKey(item.singerNo ?? item.singerId);
  if (!singerNo) return null;

  const initialKey = item.initialKey ?? item.singerNameFirstChar ?? '';
  const regionCode = item.regionCode ?? item.region ?? '';
  const sexCode = item.sexCode ?? item.sex ?? '';

  return {
    ...item,
    singerNo,
    singerName: item.singerName == null ? '' : String(item.singerName),
    initialKey: toKey(initialKey),
    singerNameFirstChar: toKey(initialKey),
    regionCode: toKey(regionCode),
    region: toKey(regionCode),
    sexCode: toKey(sexCode),
    sex: toKey(sexCode)
  };
}

/** Normalize already-parsed song items. */
export function normalizeSongsList(items) {
  return requireItems(items, 'Song')
    .map(normalizeSongEntry)
    .filter(Boolean);
}

/** Normalize already-parsed singer items. */
export function normalizeSingersList(items) {
  return requireItems(items, 'Singer')
    .map(normalizeSingerEntry)
    .filter(Boolean);
}

export function normalizePlayListItems(items) {
  return requireItems(items, 'Room queue')
    .filter(item => item && item.songNo != null && item.songNo !== '')
    .map(item => {
      const normalized = normalizeSongEntry(item);
      return {
        ...normalized,
        track: item.track ?? 0,
        scoreEnabled: item.scoreEnabled ?? 0
      };
    });
}

/** Parse the documented queue envelope, then normalize its items. */
export function normalizePlayList(response) {
  return normalizePlayListItems(parseApiArrayResponse(response, 'Room queue'));
}
