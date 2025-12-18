/**
 * Client HTTP mínimo para o frontend.
 *
 * Responsabilidades:
 * - Centralizar baseURL (VITE_API_BASE_URL)
 * - Encapsular fetch + parse de JSON
 * - Aplicar tratamento de erro simples e consistente
 */

import logger from '../utils/logger';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Constrói a URL absoluta a partir da base e do path relativo.
 *
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  const base = import.meta.env.VITE_API_BASE_URL || '';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${normalizedBase}${normalizedPath}`;
  
  // Avisa se a base URL não estiver configurada (em desenvolvimento)
  if (!base && import.meta.env.DEV) {
    logger.warn('VITE_API_BASE_URL não configurado - requisições podem falhar', { 
      url,
      hint: 'Crie um arquivo .env.local na pasta frontend com: VITE_API_BASE_URL=http://localhost:3000',
      currentUrl: url,
      expectedUrl: `http://localhost:3000${normalizedPath}`
    });
  }
  
  return url;
}

/**
 * Executa um fetch com timeout.
 *
 * @param {RequestInfo} input
 * @param {RequestInit & { timeoutMs?: number }} [init]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(input, init) {
  const timeoutMs = (init && init.timeoutMs) || DEFAULT_TIMEOUT_MS;
  if (typeof AbortController === 'undefined') {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Chamada HTTP padrão que já retorna JSON (ou lança em caso de erro).
 *
 * @template T
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} [init]
 * @returns {Promise<T>}
 */
export async function fetchJson(path, init) {
  const url = buildUrl(path);
  
  logger.debug('HTTP Request', { method: init?.method || 'GET', url, path });

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(init && init.headers),
      },
      ...init,
    });

    const contentType = response.headers.get('Content-Type') || '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      let errorBody = null;
      if (isJson) {
        try {
          errorBody = await response.json();
        } catch {
          // ignora parse error
        }
      } else {
        try {
          errorBody = await response.text();
        } catch {
          // ignora
        }
      }

      logger.error(`HTTP Error ${response.status}`, { url, status: response.status, errorBody });

      const error = new Error(
        `Erro HTTP ${response.status} ao chamar ${url}${
          errorBody ? ` - ${JSON.stringify(errorBody)}` : ''
        }`,
      );
      // @ts-ignore
      error.status = response.status;
      // @ts-ignore
      error.body = errorBody;
      throw error;
    }

    let result;
    if (!isJson) {
      // @ts-ignore
      result = /** @type {any} */ (await response.text());
    } else {
      result = /** @type {T} */ (await response.json());
    }

    logger.debug('HTTP Response', { method: init?.method || 'GET', url, status: response.status });
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('Request timeout', { url, timeout: DEFAULT_TIMEOUT_MS });
    } else if (err instanceof Error) {
      // "Failed to fetch" geralmente significa que a API não está acessível
      if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
        logger.error('API não acessível - verifique se o servidor está rodando', { 
          url,
          hint: 'Certifique-se de que a API está rodando em http://localhost:3000',
          checkCommand: 'curl http://localhost:3000/health'
        });
      } else {
        logger.error('Request failed', { url, error: err.message });
      }
    }
    throw err;
  }
}

export const httpClient = {
  fetchJson,
};


