/**
 * Client HTTP mínimo para o frontend.
 *
 * Responsabilidades:
 * - Centralizar baseURL (VITE_API_BASE_URL)
 * - Encapsular fetch + parse de JSON
 * - Aplicar tratamento de erro simples e consistente
 */

import logger from '../utils/logger';
import { getAuthHeaders, removeToken } from './auth';
import { redirectToLogin } from '../utils/index';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Constrói a URL a partir da base e do path relativo.
 * Retorna URL absoluta quando VITE_API_BASE_URL estiver definido;
 * caso contrário, usa URL relativa para o proxy do Vite (dev) ou para o mesmo host/prefixo (prod).
 * 
 * Prioridade de configuração:
 * 1. VITE_API_BASE_URL injetado pelo Vite (env ou config.json -> frontend.apiBaseUrl)
 * 2. Em desenvolvimento, URL relativa usando o proxy do Vite
 * 3. Em produção, URL relativa no mesmo host com prefixo/base path
 * 
 * NOTA: O frontend não acessa diretamente api/data/config.json.
 * O valor é resolvido pelo Vite no build/dev-server e exposto via import.meta.env.
 *
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  const base = import.meta.env.VITE_API_BASE_URL;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let basePath = '';

  // Quando rodando atrás de um prefixo (ex: /r-agent2), garante que as
  // chamadas vão para /r-agent2/config, /r-agent2/health, etc.
  if (typeof window !== 'undefined') {
    try {
      // Usa href completo para escapar de qualquer getter customizado de pathname
      const url = new URL(window.location.href);
      const rawPath = url.pathname || window.location.pathname || '/';
      const match = rawPath.match(/^\/([^/]+)(\/|$)/);
      if (match && match[1]) {
        basePath = `/${match[1]}`;
      }
    } catch {
      const fallbackMatch = window.location.pathname && window.location.pathname.match(/^\/([^/]+)(\/|$)/);
      if (fallbackMatch && fallbackMatch[1]) {
        basePath = `/${fallbackMatch[1]}`;
      }
    }
  }
  
  // Se VITE_API_BASE_URL estiver definido, usa URL absoluta
  if (base && base.trim()) {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${normalizedBase}${normalizedPath}`;
  }
  
  // Se estiver vazio, detecta ambiente em runtime (não em build time)
  // Verifica se está rodando no Vite (porta 5173) ou localhost
  if (typeof window !== 'undefined') {
    const isViteDev = window.location.port === '5173' || 
                      (window.location.hostname === 'localhost' && window.location.port !== '80' && window.location.port !== '443' && !window.location.port.includes('8086'));
    
    if (isViteDev) {
      // Desenvolvimento: usa URL relativa para que o proxy do Vite funcione
      // O proxy do Vite redireciona para a porta da API injetada via Vite/config.json.
      // IMPORTANTE: Não adiciona basePath aqui em desenvolvimento, pois o proxy precisa da URL relativa
      console.log('[buildUrl] Desenvolvimento Vite detectado, usando URL relativa:', {
        path,
        normalizedPath,
        port: window.location.port,
        hostname: window.location.hostname,
      });
      return normalizedPath;
    }
  }
  
  // Produção ou quando servido via nginx/Apache: usa URL relativa
  // ajustada com o prefixo (ex: /r-agent2) quando existir.
  if (basePath && !normalizedPath.startsWith(basePath + '/')) {
    return `${basePath}${normalizedPath}`;
  }

  return normalizedPath;
}

/**
 * Exporta a resolução de URL usada internamente pelo client.
 * Útil para downloads (blob) que não passam por fetchJson.
 *
 * @param {string} path
 * @returns {string}
 */
export function buildApiUrl(path) {
  return buildUrl(path);
}

function summarizeHttpErrorBody(status, errorBody) {
  if (Number(status) === 413) {
    return 'Arquivo excede o limite de upload do proxy/gateway (HTTP 413).';
  }

  if (typeof errorBody === 'string') {
    const compact = errorBody.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    if (compact.startsWith('<')) {
      return 'Resposta HTML retornada pelo proxy/gateway.';
    }
    return compact.slice(0, 300);
  }

  if (errorBody && typeof errorBody === 'object') {
    const msg = errorBody.message || errorBody.error?.message || errorBody.error || null;
    if (msg) return String(msg);
  }

  return '';
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
  // Dá um "motivo" explícito para o abort, para evitar mensagens crípticas como
  // "signal is aborted without reason" e para manter compatibilidade com o
  // tratamento existente (err.name === 'AbortError').
  const timeoutReason = (() => {
    const message = `Request timed out after ${timeoutMs}ms`;
    try {
      // DOMException existe no browser; em alguns ambientes de teste pode não existir.
      // Usamos name "AbortError" para continuar batendo no tratamento atual.
      // eslint-disable-next-line no-undef
      return new DOMException(message, 'AbortError');
    } catch {
      const e = new Error(message);
      // @ts-ignore
      e.name = 'AbortError';
      return e;
    }
  })();
  const id = setTimeout(() => controller.abort(timeoutReason), timeoutMs);

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
 * @param {RequestInit & { timeoutMs?: number, silent?: boolean }} [init]
 * @returns {Promise<T>}
 */
export async function fetchJson(path, init) {
  const silent = init?.silent === true;
  const isPipelineStatusRequest = false;

  // Log IMEDIATO no início para garantir que a função está sendo chamada
  if (!silent) {
    console.log('[HTTP Client] 🚀 fetchJson chamado', {
      path,
      timestamp: new Date().toISOString(),
      stack: new Error().stack?.split('\n').slice(0, 5).join('\n'),
    });
  }
  
  const url = buildUrl(path);
  const method = init?.method || 'GET';
  
  if (!silent) {
    console.log('[HTTP Client] 📍 URL construída:', {
      path,
      url,
      method,
      baseUrl: import.meta.env.VITE_API_BASE_URL || 'não definido',
      windowLocation: typeof window !== 'undefined' ? window.location.href : 'N/A',
      windowPort: typeof window !== 'undefined' ? window.location.port : 'N/A',
    });
  }
  
  // Log estruturado com URL final resolvida
  if (!silent) {
    logger.debug('HTTP Request', { 
      method, 
      url, 
      path,
      baseUrl: import.meta.env.VITE_API_BASE_URL || '[relative/proxy]',
      windowLocation: typeof window !== 'undefined' ? window.location.href : 'N/A',
      windowPort: typeof window !== 'undefined' ? window.location.port : 'N/A',
    });
  }
  
  // Log adicional para debug de proxy
  if (!silent && typeof window !== 'undefined' && window.location.port === '5173') {
    const devPort = Number(import.meta.env.VITE_API_DEV_PORT || 3000);
    console.log('[HTTP Client] 🔄 Requisição em desenvolvimento:', {
      path,
      url,
      method,
      expectedProxy: `http://localhost:${devPort}${path}`,
      currentLocation: window.location.href,
    });
  }

  try {
    // Inclui headers de autenticação se disponível
    const authHeaders = getAuthHeaders();
    
    // Prepara os headers.
    // Regra: só força Content-Type=application/json quando o body NÃO é FormData.
    const hasBody = init && (init.body !== undefined && init.body !== null);
    const isFormDataBody = (() => {
      try {
        // FormData só existe no browser/test env; em ambientes sem FormData, cai no catch.
        return hasBody && typeof FormData !== 'undefined' && init.body instanceof FormData;
      } catch {
        return false;
      }
    })();
    
    // Merge dos headers:
    // - Começa com authHeaders (inclui X-Tenant-Id do contexto atual)
    // - Permite que headers customizados do caller sobrescrevam (ex.: X-Tenant-Id por requisição)
    // - Força Accept e Content-Type quando aplicável
    const mergedHeaders = {
      ...authHeaders,
      ...(init && init.headers),
      // Sempre envia Accept: application/json para garantir que a API retorne JSON
      'Accept': 'application/json',
      // Garante que Content-Type seja application/json se houver body e NÃO for FormData
      ...(hasBody && !isFormDataBody && { 'Content-Type': 'application/json' }),
    };

    // Importante: algumas rotas NÃO devem ser influenciadas por tenant-context via header.
    // - Rotas de super-admin operam globalmente e falham/filtram quando X-Tenant-Id é enviado
    // Nota: /auth/me e outras rotas /auth/* PRECISAM do X-Tenant-Id para validação de tenant
    const normalizedPath = path && typeof path === 'string'
      ? (path.startsWith('/') ? path : `/${path}`)
      : '';
    const shouldStripTenantHeader =
      normalizedPath.startsWith('/super-admin/') ||
      normalizedPath === '/super-admin';
    if (shouldStripTenantHeader && mergedHeaders['X-Tenant-Id']) {
      delete mergedHeaders['X-Tenant-Id'];
    }
    
    // Remove headers do init para evitar sobrescrita, mas mantém timeoutMs
    const { headers: _, timeoutMs, ...restInitRaw } = init || {};

    // -------------------------------------------------------------------
    // Pipeline unificado: executionId obrigatório em rotas críticas.
    // - Se o caller não forneceu, geramos automaticamente para evitar chamadas inválidas.
    // - NÃO altera bodies FormData.
    // -------------------------------------------------------------------
    const PIPELINE_EXECUTION_ID_PATHS = new Set([
      '/api/ai/generate',
      '/system/pipeline/validate-prereqs',
      '/system/suggest-description',
      '/tenants/generate-by-ai',
      '/system/generate-initial-flow',
      '/system/generate-faq',
      '/web-scraping/scrape-batch',
      '/rag/ephemeral/context',
    ]);
    const shouldEnsureExecutionId =
      method !== 'GET' &&
      normalizedPath &&
      PIPELINE_EXECUTION_ID_PATHS.has(normalizedPath);

    const makeExecutionId = () => `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    let restInit = { ...restInitRaw };
    if (shouldEnsureExecutionId && hasBody && !isFormDataBody) {
      try {
        const raw = restInit.body;
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          const parsed = JSON.parse(raw);
          if (!parsed.executionId) {
            parsed.executionId = makeExecutionId();
            restInit.body = JSON.stringify(parsed);
          }
        } else if (raw == null) {
          restInit.body = JSON.stringify({ executionId: makeExecutionId() });
        }
      } catch {
        // Se não conseguir parsear, não bloqueia.
      }
    }
    
    if (!silent) {
      console.log('[HTTP Client] 📤 Fazendo requisição fetch:', {
        url,
        method,
        headers: Object.keys(mergedHeaders),
        hasAuth: !!mergedHeaders.Authorization,
      });
    }
    
    const response = await fetchWithTimeout(url, {
      ...restInit,
      headers: mergedHeaders,
      timeoutMs, // Passa timeoutMs explicitamente
    });

    // Alguns testes mockam `headers` como objeto simples (sem entries()).
    let responseHeadersObj = {};
    try {
      if (response?.headers && typeof response.headers.entries === 'function') {
        responseHeadersObj = Object.fromEntries(response.headers.entries());
      } else if (response?.headers && typeof response.headers.forEach === 'function') {
        const tmp = {};
        response.headers.forEach((v, k) => { tmp[k] = v; });
        responseHeadersObj = tmp;
      }
    } catch {
      responseHeadersObj = {};
    }

    if (!silent) {
      console.log('[HTTP Client] 📥 Resposta recebida:', {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: responseHeadersObj,
      });
    }

    const contentType = (response?.headers && typeof response.headers.get === 'function'
      ? response.headers.get('Content-Type')
      : '') || '';
    const isJson = contentType.includes('application/json');

	    // HTTP 207 (Multi-Status) é considerado sucesso pelo fetch (ok=true),
	    // e deve ser tratado como resposta válida pelo frontend.
	    if (!response.ok) {
	      const expectedErrorCodes = Array.isArray(init?.expectedErrorCodes) ? init.expectedErrorCodes : [];
	      const expectedStatuses = Array.isArray(init?.expectedStatuses) ? init.expectedStatuses : [];
	      const suppressErrorLog = init?.suppressErrorLog === true;
	      const suppressNonOkConsoleLog = suppressErrorLog || expectedStatuses.includes(response.status) || expectedErrorCodes.length > 0;

	      const isPipelineStatusNotFound = false;
	      if (!isPipelineStatusNotFound) {
	        if (!suppressNonOkConsoleLog) {
	          console.log('[HTTP Client] ❌ Resposta não OK:', {
	            status: response.status,
	            statusText: response.statusText,
	            url: response.url,
	          });
	        }
	      }
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
      
      // Não loga erros 404 para endpoints opcionais de desenvolvimento
      const isOptionalDevEndpoint = response.status === 404 && 
        (path.includes('/system/websocket/connections') || 
         path.includes('/analytics/metrics'));

	      // Não há polling de pipeline (progresso via WebSocket).
	      const isPipelineStatusNotFoundForLogs = false;
	
	      // Permite que chamadas conhecidas/esperadas não poluam o console.
	      // Uso: fetchJson('/path', { expectedErrorCodes: ['some_code'] }) ou { suppressErrorLog: true }.
	      const envelopeCode = (errorBody &&
	        typeof errorBody === 'object' &&
	        errorBody.error &&
	        typeof errorBody.error === 'object' &&
	        typeof errorBody.error.code === 'string')
	        ? errorBody.error.code
	        : null;
	      const isExpectedError = suppressErrorLog ||
	        expectedStatuses.includes(response.status) ||
	        (envelopeCode && expectedErrorCodes.includes(envelopeCode));
	      
	      if (!isTicketNotFound && !isOptionalDevEndpoint && !isPipelineStatusNotFoundForLogs && !isExpectedError) {
	        // 401 de sessão expirada/ausente é esperado em fluxo de autenticação.
	        const logMethod = response.status === 401 ? logger.warn : logger.error;
	        // Log estruturado com URL final resolvida
	        logMethod(`HTTP Error ${response.status}`, { 
	          method: init?.method || 'GET',
	          url, 
          path,
          status: response.status, 
          errorBody 
        });
      }

	      // Tratamento especial para erro 401 (Unauthorized)
	      // Redireciona para login, exceto se já estiver em rotas de autenticação
	      if (!suppressNonOkConsoleLog) {
	        console.log('[HTTP Client] 🔍 Verificando status da resposta:', {
	          status: response.status,
	          is401: response.status === 401,
	        });
	      }
	      
	      if (response.status === 401) {
        console.warn('[HTTP Client] ⚠️ 401 detectado. Iniciando tratamento...');
        
        const isAuthRoute = path.includes('/auth/') || path.includes('/login');
        const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
        const isOnLoginPage = currentPath.includes('/login');
        
        // Log detalhado do erro 401
        const logData = {
          method: init?.method || 'GET',
          url,
          path,
          status: response.status,
          statusText: response.statusText,
          isAuthRoute,
          currentPath,
          isOnLoginPage,
          errorBody,
          responseUrl: response.url,
          headers: responseHeadersObj,
        };
        
        console.warn('[HTTP Client] ⚠️ 401 (Unauthorized) detectado', logData);
        console.warn('[HTTP Client] Detalhes completos:', JSON.stringify(logData, null, 2));
        
        // 401 é condição esperada de sessão inválida/expirada: log como warning.
        logger.warn('Erro 401 (Unauthorized) detectado', logData);
        
        if (!isAuthRoute && typeof window !== 'undefined' && !isOnLoginPage) {
          // Remove o token inválido
          console.warn('[HTTP Client] 🗑️ Removendo token inválido...');
          removeToken();
          
          logger.warn('Token removido e redirecionando para login', {
            path,
            currentPath,
            redirectTo: '/login',
          });
          console.warn('[HTTP Client] 🔄 Redirecionando para /login devido a erro 401');
          console.warn('[HTTP Client] Path atual:', currentPath);
          console.warn('[HTTP Client] Vai redirecionar para:', '/login');
          
          // Redireciona para login IMEDIATAMENTE
          try {
            redirectToLogin();
            console.log('[HTTP Client] ✅ redirectToLogin() chamado com sucesso');
            
            // IMPORTANTE: Não lança o erro para evitar que o componente tente tratá-lo
            // Retorna uma Promise que nunca resolve, mas o redirecionamento já foi feito
            // Isso evita que o erro seja exibido na UI
            return new Promise(() => {
              // Promise que nunca resolve - o redirecionamento já foi feito
            });
          } catch (err) {
            console.warn('[HTTP Client] ⚠️ Erro ao chamar redirectToLogin():', err);
            // Fallback: tenta redirecionar manualmente
            const basePath = typeof window !== 'undefined' && window.location.pathname.match(/^\/([^/]+)/) 
              ? window.location.pathname.match(/^\/([^/]+)/)[0] 
              : '';
            window.location.href = `${window.location.origin}${basePath}/login`;
            
            // Retorna Promise que nunca resolve
            return new Promise(() => {});
          }
        } else {
          // Log quando não redireciona (já está em rota de auth ou login)
          const reason = isAuthRoute ? 'rota de autenticação' : isOnLoginPage ? 'já está na página de login' : 'outro motivo';
          logger.debug(`Erro 401 - não redirecionando (${reason})`, logData);
          console.debug(`[HTTP Client] Erro 401 - não redirecionando (${reason})`, logData);
        }
      }

      // Se a API retornou um Error Envelope padronizado, normaliza e propaga
      // um erro tratável por `code` no restante do frontend.
      if (
        isJson &&
        errorBody &&
        typeof errorBody === 'object' &&
        errorBody.success === false &&
        errorBody.error &&
        typeof errorBody.error === 'object' &&
        typeof errorBody.error.code === 'string'
      ) {
        const apiErr = errorBody.error;
        const error = new Error(apiErr.message || `Erro HTTP ${response.status}`);
        // @ts-ignore
        error.code = apiErr.code;
        // @ts-ignore
        error.details = apiErr.details;
        // @ts-ignore
        error.httpStatus = apiErr.httpStatus || response.status;
        // @ts-ignore
        error.retryable = !!apiErr.retryable;
        // @ts-ignore
        error.traceId = apiErr.traceId;
        // @ts-ignore
        error.timestamp = apiErr.timestamp;
        // @ts-ignore
        error.status = apiErr.httpStatus || response.status;
        // @ts-ignore
        error.body = errorBody;
        // @ts-ignore
        error.url = url;
        throw error;
      }

      const summary = summarizeHttpErrorBody(response.status, errorBody);
      const error = new Error(
        `Erro HTTP ${response.status} ao chamar ${url}${summary ? ` - ${summary}` : ''}`,
      );
      // @ts-ignore
      error.status = response.status;
      // @ts-ignore
      error.body = errorBody;
      // @ts-ignore
      error.url = url; // Inclui URL final no erro para rastreabilidade
      // @ts-ignore
      error.isSuperAdmin = response.headers.get('X-RateLimit-SuperAdmin') === 'true'; // Indica se é super-admin
      throw error;
    }

    let result;
    if (!isJson) {
      // @ts-ignore
      const textResult = /** @type {any} */ (await response.text());
      
      // Se recebeu HTML ao invés de JSON, provavelmente é um erro de roteamento
      // ou a API não está configurada corretamente
      if (typeof textResult === 'string' && textResult.trim().startsWith('<!')) {
        logger.error('API retornou HTML ao invés de JSON', { 
          method: init?.method || 'GET',
          url, 
          path,
          status: response.status,
          contentType,
          sample: textResult.substring(0, 200)
        });
        
        const error = new Error(
          `API retornou HTML ao invés de JSON ao chamar ${url}. Verifique se a rota está configurada corretamente.`
        );
        // @ts-ignore
        error.status = response.status;
        // @ts-ignore
        error.body = textResult;
        // @ts-ignore
        error.url = url;
        // @ts-ignore
        error.isHtmlResponse = true;
        throw error;
      }
      
      result = textResult;
    } else {
      result = /** @type {T} */ (await response.json());
    }

    // Anexa status HTTP sem quebrar compatibilidade (não-enumerável)
    if (result && typeof result === 'object') {
      try {
        Object.defineProperty(result, '__httpStatus', {
          value: response.status,
          enumerable: false,
          configurable: true,
        });
      } catch {
        // ignora (ex.: objeto congelado)
      }
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
    // Some endpoints are optional or environment-dependent. Callers can pass
    // `expectedErrorCodes` / `expectedStatuses` / `suppressErrorLog` to avoid noisy logs.
    const expectedErrorCodes = Array.isArray(init?.expectedErrorCodes) ? init.expectedErrorCodes : [];
    const expectedStatuses = Array.isArray(init?.expectedStatuses) ? init.expectedStatuses : [];
    const suppressErrorLog = init?.suppressErrorLog === true;

    const errStatus = err?.status ?? err?.httpStatus;
    const errCode =
      (typeof err?.code === 'string' ? err.code : null) ||
      (err?.body &&
      typeof err.body === 'object' &&
      err.body.error &&
      typeof err.body.error === 'object' &&
      typeof err.body.error.code === 'string'
        ? err.body.error.code
        : null);
    const isExpectedError =
      suppressErrorLog ||
      (Number.isFinite(errStatus) && expectedStatuses.includes(errStatus)) ||
      (errCode && expectedErrorCodes.includes(errCode)) ||
      (typeof err?.message === 'string' && expectedErrorCodes.includes(err.message));

    // Para polling do pipeline, evitamos spam de console no catch (timeouts/abort podem ocorrer sob carga).
    if (!silent && !isPipelineStatusRequest && !isExpectedError) {
      if (errStatus === 401) {
        console.warn('[HTTP Client] ⚠️ Erro 401 capturado no catch:', {
          name: err?.name,
          message: err?.message,
          status: err?.status,
          path,
          url,
          stack: err?.stack?.split('\n').slice(0, 10).join('\n'),
        });
      } else {
        console.error('[HTTP Client] 💥 Erro capturado no catch:', {
          name: err?.name,
          message: err?.message,
          status: err?.status,
          path,
          url,
          stack: err?.stack?.split('\n').slice(0, 10).join('\n'),
        });
      }
    }
    
    // Verifica se é erro 401 no catch também
    if (err?.status === 401) {
      console.warn('[HTTP Client] ⚠️ 401 no catch', {
        path,
        url,
        errMessage: err.message,
        errStatus: err.status,
      });
      
      const isAuthRoute = path.includes('/auth/') || path.includes('/login');
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const isOnLoginPage = currentPath.includes('/login');
      
      if (!isAuthRoute && typeof window !== 'undefined' && !isOnLoginPage) {
        console.warn('[HTTP Client] 🗑️ Removendo token e redirecionando (do catch)...');
        removeToken();
        redirectToLogin();
        
        // Retorna Promise que nunca resolve para evitar que o erro seja propagado
        return new Promise(() => {});
      }
    }
    
    if (err instanceof Error && err.name === 'AbortError') {
      if (!silent && !isPipelineStatusRequest) {
        logger.error('Request timeout', { 
          method: init?.method || 'GET',
          url, 
          path,
          timeout: init?.timeoutMs || DEFAULT_TIMEOUT_MS,
        });
      }
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

      // Não há polling de pipeline (progresso via WebSocket).
      const isPipelineStatusNotFound = false;

      if (isPipelineStatusNotFound) {
        // Não loga, apenas relança o erro silenciosamente
        throw err;
      }
      
      // "Failed to fetch" geralmente significa que a API não está acessível
      // Mas pode ser apenas o servidor iniciando, então não logamos como erro crítico
      const isConnectionError = err.message === 'Failed to fetch' || 
                                err.message.includes('fetch') ||
                                err.message.includes('ERR_CONNECTION_REFUSED') ||
                                err.message.includes('NetworkError');
      
      if (isConnectionError) {
        // Para rotas de autenticação/health na inicialização, usa debug em vez de error
        const isInitializationRoute = path === '/auth/me' || path === '/health';
        
        if (isInitializationRoute) {
          logger.debug('API não acessível (inicialização)', { 
            method: init?.method || 'GET',
            url,
            path,
            hint: 'Servidor pode estar iniciando. Tentando novamente...',
          });
        } else {
          if (!isExpectedError) logger.error('API não acessível - verifique se o servidor está rodando', { 
            method: init?.method || 'GET',
            url,
            path,
            hint: 'Verifique se a API está acessível no caminho configurado',
          });
        }
        
        // Adiciona flag para indicar erro de conexão
        err.connectionRefused = true;
        err.status = 0;
      } else {
        if (!isExpectedError) {
          const requestFailedLogMethod = err.status === 401 ? logger.warn : logger.error;
          requestFailedLogMethod('Request failed', { 
            method: init?.method || 'GET',
            url, 
            path,
            error: err.message 
          });
        }
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
    baseUrl: import.meta.env.VITE_API_BASE_URL || '[relative/proxy]'
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

      const summary = summarizeHttpErrorBody(response.status, errorBody);
      const error = new Error(
        `Erro HTTP ${response.status} ao chamar ${url}${summary ? ` - ${summary}` : ''}`,
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
        timeout: init?.timeoutMs || DEFAULT_TIMEOUT_MS,
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
