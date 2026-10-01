function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function copyStringParam(source, target, key) {
  const value = source?.[key];
  if (value === undefined || value === null) return;
  const normalized = String(value).trim();
  if (normalized) target[key] = normalized;
}

/**
 * Normalize the only supported GET /songdb/songs query contract.
 */
export function mapSongListParams(params = {}) {
  const mapped = {
    page: toPositiveInt(params.page, 1),
    pageSize: toPositiveInt(params.pageSize, 30),
    availableOnly: true
  };

  ['keyword', 'searchMode', 'initial', 'languageCode', 'primarySingerNo', 'categoryCode']
    .forEach((key) => copyStringParam(params, mapped, key));
  return mapped;
}

/** Normalize the only supported GET /songdb/singers query contract. */
export function mapSingerListParams(params = {}) {
  const mapped = {
    page: toPositiveInt(params.page, 1),
    pageSize: toPositiveInt(params.pageSize, 30)
  };

  ['keyword', 'initial', 'sexCode', 'regionCode']
    .forEach((key) => copyStringParam(params, mapped, key));
  return mapped;
}

