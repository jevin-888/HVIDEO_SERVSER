/** API v1 response parsers. Each endpoint shape has one explicit parser. */

function requireSuccessEnvelope(response, resourceName) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError(`${resourceName} API response must be a JSON object`);
  }
  if (response.code !== 0) {
    const message = typeof response.message === 'string' && response.message.trim()
      ? response.message.trim()
      : `${resourceName} API request failed`;
    throw new Error(message);
  }
  return response.data;
}

export function parsePagedListResponse(response, resourceName = 'Paged list') {
  const data = requireSuccessEnvelope(response, resourceName);
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.items) || typeof data.total !== 'number' ||
      typeof data.page !== 'number' || typeof data.pageSize !== 'number') {
    throw new TypeError(
      `${resourceName} API response must match {code, message, data: {items, total, page, pageSize}}`
    );
  }
  return {
    list: data.items,
    totalSize: data.total,
    page: data.page,
    pageSize: data.pageSize
  };
}

export function parseSongListResponse(response) {
  return parsePagedListResponse(response, 'Song catalog');
}

export function parseSingerListResponse(response) {
  return parsePagedListResponse(response, 'Singer catalog');
}

/** Parse APIs whose documented data payload is directly an array (queue/dicts/materials/products). */
export function parseApiArrayResponse(response, resourceName = 'List') {
  const data = requireSuccessEnvelope(response, resourceName);
  if (!Array.isArray(data)) {
    throw new TypeError(`${resourceName} API data must be an array`);
  }
  return data;
}
