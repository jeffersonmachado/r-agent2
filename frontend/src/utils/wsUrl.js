/**
 * Helpers para construção de URL de WebSocket no frontend.
 *
 * Regras:
 * - Se VITE_API_BASE_URL estiver definido, usa URL absoluta com ws/wss.
 * - Em DEV com Vite, usa ws://localhost:<VITE_API_DEV_PORT>/ws.
 * - Em produção, usa mesmo host com prefixo detectado.
 */

function detectBasePathFromLocation(locationObj) {
  if (!locationObj) {
    return '';
  }

  try {
    const url = new URL(locationObj.href || String(locationObj));
    const rawPath = url.pathname || locationObj.pathname || '/';
    const match = rawPath.match(/^\/([^/]+)(\/|$)/);
    if (match && match[1]) {
      return `/${match[1]}`;
    }
  } catch {
    const fallbackPath = locationObj.pathname || '/';
    const fallbackMatch = fallbackPath.match(/^\/([^/]+)(\/|$)/);
    if (fallbackMatch && fallbackMatch[1]) {
      return `/${fallbackMatch[1]}`;
    }
  }

  return '';
}

function isViteDevRuntime(locationObj) {
  if (!locationObj) {
    return false;
  }

  const port = String(locationObj.port || '');
  const hostname = String(locationObj.hostname || '');

  return port === '5173'
    || (hostname === 'localhost'
      && port !== '80'
      && port !== '443'
      && !port.includes('8086'));
}

export function buildWebSocketUrl(options = {}) {
  const runtimeLocation =
    Object.prototype.hasOwnProperty.call(options, 'location')
      ? options.location
      : (typeof window !== 'undefined' ? window.location : null);
  const runtimeEnv = options.env || import.meta.env;
  const base = runtimeEnv.VITE_API_BASE_URL;

  if (base && String(base).trim()) {
    const normalizedBase = String(base).endsWith('/') ? String(base).slice(0, -1) : String(base);
    const wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsBase}/ws`;
  }

  if (isViteDevRuntime(runtimeLocation)) {
    const devPort = Number(runtimeEnv.VITE_API_DEV_PORT || 3000);
    return `ws://localhost:${devPort}/ws`;
  }

  if (!runtimeLocation) {
    return '/ws';
  }

  const basePath = detectBasePathFromLocation(runtimeLocation);
  const protocol = runtimeLocation.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsPath = `${basePath}/ws`.replace('//', '/');
  return `${protocol}//${runtimeLocation.host}${wsPath}`;
}
