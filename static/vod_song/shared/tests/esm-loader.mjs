export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:///D:/HVIDEO/Hvideo_server/static/vod_song/') && url.endsWith('.js')) {
    return { ...result, format: 'module' };
  }
  return result;
}
