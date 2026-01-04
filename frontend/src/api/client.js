/**
 * Client HTTP mínimo para o frontend.
 *
 * Responsabilidades:
 * - Centralizar baseURL (VITE_API_BASE_URL)
 * - Encapsular fetch + parse de JSON
 * - Aplicar tratamento de erro simples e consistente
 */

import logger from '../utils/logger';
import { getAuthHeaders } from './auth';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Constrói a URL a partir da base e do path relativo.
 * SEMPRE retorna uma URL absoluta para evitar resolução implícita pelo browser.
 * 
 * Prioridade de configuração:
 * 1. VITE_API_BASE_URL (variável de ambiente)
 * 2. Configuração via API /config (se disponível)
 * 3. Fallback: http://localhost:3000 (porta padrão da API)
 * 
 * NOTA: O frontend não pode acessar diretamente api/data/config.json.
 * A configuração deve ser fornecida via variável de ambiente ou endpoint /config.
 *
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  // Fallback explícito documentado para evitar que requisições sejam resolvidas
  // implicitamente pelo browser para a origem do Vite (porta 5173)
  // Este valor deve corresponder a api.data.config.json > frontend.apiBaseUrl
  const DEFAULT_BASE_URL = 'http://localhost:3000';
  
  const base = import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Sempre constrói URL absoluta
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}${normalizedPath}`;
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
  const method = init?.method || 'GET';
  
  // Log estruturado com URL final resolvida
  logger.debug('HTTP Request', { 
    method, 
    url, 
    path,
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000 (fallback - deve corresponder a config.json > frontend.apiBaseUrl)'
  });

  try {
    // Inclui headers de autenticação se disponível
    const authHeaders = getAuthHeaders();
    
    // Prepara os headers, garantindo que Content-Type seja sempre application/json
    // quando há um body (para requisições POST, PUT, PATCH)
    const hasBody = init && (init.body !== undefined && init.body !== null);
    
    // Merge dos headers: primeiro os headers customizados, depois auth, depois Content-Type (para garantir que seja sempre definido)
    const mergedHeaders = {
      ...(init && init.headers),
      ...authHeaders,
      // Garante que Content-Type seja application/json se houver body
      ...(hasBody && { 'Content-Type': 'application/json' }),
    };
    
    // Remove headers do init para evitar sobrescrita, mas mantém timeoutMs
    const { headers: _, timeoutMs, ...restInit } = init || {};
    
    const response = await fetchWithTimeout(url, {
      ...restInit,
      headers: mergedHeaders,
      timeoutMs, // Passa timeoutMs explicitamente
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

      // Não loga erros 404 para tickets não encontrados (são esperados quando ticket foi removido)
      const isTicketNotFound = response.status === 404 && 
        errorBody && 
        (errorBody.error === 'ticket_not_found' || 
         (typeof errorBody === 'string' && errorBody.includes('ticket_not_found')));
      
      if (!isTicketNotFound) {
        // Log estruturado com URL final resolvida
        logger.error(`HTTP Error ${response.status}`, { 
          method: init?.method || 'GET',
          url, 
          path,
          status: response.status, 
          errorBody 
        });
      }

      const error = new Error(
        `Erro HTTP ${response.status} ao chamar ${url}${
          errorBody ? ` - ${JSON.stringify(errorBody)}` : ''
        }`,
      );
      // @ts-ignore
      error.status = response.status;
      // @ts-ignore
      error.body = errorBody;
      // @ts-ignore
      error.url = url; // Inclui URL final no erro para rastreabilidade
      throw error;
    }

    let result;
    if (!isJson) {
      // @ts-ignore
      result = /** @type {any} */ (await response.text());
    } else {
      result = /** @type {T} */ (await response.json());
    }

    // Log estruturado com URL final resolvida
    logger.debug('HTTP Response', { 
      method: init?.method || 'GET', 
      url, 
      path,
      status: response.status 
    });
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('Request timeout', { 
        method: init?.method || 'GET',
        url, 
        path,
        timeout: DEFAULT_TIMEOUT_MS 
      });
    } else if (err instanceof Error) {
      // Não loga erros 404 de ticket_not_found (são esperados quando ticket foi removido)
      const isTicketNotFound = err.status === 404 && 
        err.body && 
        (err.body.error === 'ticket_not_found' || 
         (typeof err.body === 'string' && err.body.includes('ticket_not_found')));
      
      if (isTicketNotFound) {
        // Não loga, apenas relança o erro silenciosamente
        throw err;
      }
      
      // "Failed to fetch" geralmente significa que a API não está acessível
      if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
        logger.error('API não acessível - verifique se o servidor está rodando', { 
          method: init?.method || 'GET',
          url,
          path,
          hint: 'Verifique se a API está acessível no caminho configurado',
        });
      } else {
        logger.error('Request failed', { 
          method: init?.method || 'GET',
          url, 
          path,
          error: err.message 
        });
      }
    }
    throw err;
  }
}

/**
 * Faz download de um arquivo (blob) da API.
 * 
 * @param {string} path - Caminho do endpoint
 * @param {RequestInit} [init] - Opções de requisição
 * @returns {Promise<Response>} Response com blob
 */
export async function fetchBlob(path, init) {
  const url = buildUrl(path);
  const method = init?.method || 'GET';
  
  logger.debug('HTTP Request (Blob)', { 
    method, 
    url, 
    path,
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000 (fallback - deve corresponder a config.json > frontend.apiBaseUrl)'
  });

  try {
    const authHeaders = getAuthHeaders();
    const mergedHeaders = {
      ...(init && init.headers),
      ...authHeaders,
    };
    
    const { headers: _, ...restInit } = init || {};
    
    const response = await fetchWithTimeout(url, {
      ...restInit,
      headers: mergedHeaders,
    });

    if (!response.ok) {
      let errorBody = null;
      const contentType = response.headers.get('Content-Type') || '';
      const isJson = contentType.includes('application/json');
      
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
          // ignora parse error
        }
      }

      logger.error(`HTTP Error ${response.status} (Blob)`, { 
        method,
        url, 
        path,
        status: response.status, 
        errorBody 
      });

      const error = new Error(
        `Erro HTTP ${response.status} ao chamar ${url}${
          errorBody ? ` - ${JSON.stringify(errorBody)}` : ''
        }`,
      );
      // @ts-ignore
      error.status = response.status;
      // @ts-ignore
      error.body = errorBody;
      // @ts-ignore
      error.url = url;
      throw error;
    }

    logger.debug('HTTP Response (Blob)', { 
      method, 
      url, 
      path,
      status: response.status 
    });
    
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('Request timeout (Blob)', { 
        method: init?.method || 'GET',
        url, 
        path,
        timeout: DEFAULT_TIMEOUT_MS 
      });
    } else if (err instanceof Error) {
      if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
        logger.error('API não acessível - verifique se o servidor está rodando (Blob)', { 
          method: init?.method || 'GET',
          url,
          path,
          hint: 'Verifique se a API está acessível no caminho configurado',
        });
      } else {
        logger.error('Request failed (Blob)', { 
          method: init?.method || 'GET',
          url, 
          path,
          error: err.message 
        });
      }
    }
    throw err;
  }
}

export const httpClient = {
  fetchJson,
  fetchBlob,
};


