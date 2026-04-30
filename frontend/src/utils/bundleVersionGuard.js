export function extractIndexBundlePathFromHtml(html) {
  const text = String(html || '');
  const match = text.match(/assets\/index-[^"']+\.js/);
  return match ? match[0] : null;
}

export function extractCurrentIndexBundlePath(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const current = list.find((source) => /\/assets\/index-[^/?#]+\.js(?:[?#].*)?$/i.test(String(source || '')));
  if (!current) return null;
  const normalized = String(current).split('?')[0].split('#')[0];
  const match = normalized.match(/assets\/index-[^"']+\.js/);
  return match ? match[0] : null;
}

export function shouldReloadForNewBundle(currentBundlePath, latestBundlePath) {
  return Boolean(currentBundlePath && latestBundlePath && currentBundlePath !== latestBundlePath);
}
