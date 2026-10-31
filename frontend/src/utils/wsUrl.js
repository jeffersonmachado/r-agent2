/**
 * Helpers para construção de URL de WebSocket no frontend.
 *
 * Regras (ordem de precedência):
 * 1. VITE_API_BASE_URL definido → URL absoluta com ws/wss.
 * 2. Prefixo de deployment = `BASE_URL` do build (Vite `base`, alimentado por VITE_BASE_PATH).
 *    É a ÚNICA fonte de verdade: o primeiro segmento do pathname é ROTA, não prefixo.
 * 3. VITE_API_DEV_PORT definido → fala direto com a API nesse host/porta (sem proxy).
 * 4. Caso contrário → mesmo host, `/ws` (em dev o Vite proxia o upgrade; em produção o Apache).
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

function normalizarBaseDeBuild(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  const comBarras = texto.startsWith('/') ? texto : `/${texto}`;
  return comBarras.endsWith('/') ? comBarras : `${comBarras}/`;
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

  // `BASE_URL` vem do build (Vite `base`). Servido na raiz ele é '/', e então o caminho do WS é
  // `/ws` — nunca `<rota>/ws` (era o defeito: `/dev/qa-waves` → `ws://host/dev/ws`).
  const baseDeBuild = normalizarBaseDeBuild(runtimeEnv.BASE_URL);

  if (baseDeBuild) {
    if (!runtimeLocation) return baseDeBuild === '/' ? '/ws' : `${baseDeBuild}ws`;
    const protocolo = runtimeLocation.protocol === 'https:' ? 'wss:' : 'ws:';
    const caminho = baseDeBuild === '/' ? '/ws' : `${baseDeBuild}ws`;
    return `${protocolo}//${runtimeLocation.host}${caminho}`;
  }

  if (runtimeEnv.VITE_API_DEV_PORT) {
    const devPort = Number(runtimeEnv.VITE_API_DEV_PORT);
    return `ws://localhost:${devPort}/ws`;
  }

  if (!runtimeLocation) {
    return '/ws';
  }

  // Sem BASE_URL no env (runtime antigo/teste): mantém a heurística histórica de prefixo.
  const basePath = detectBasePathFromLocation(runtimeLocation);
  const protocol = runtimeLocation.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsPath = `${basePath}/ws`.replace('//', '/');
  return `${protocol}//${runtimeLocation.host}${wsPath}`;
}
