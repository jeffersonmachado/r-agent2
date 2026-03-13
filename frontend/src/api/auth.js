import { fetchJson } from './client';

const TOKEN_KEY = 'auth_token';
const EFFECTIVE_TENANT_KEY = 'auth_effective_tenant_id';
const AUTH_DEFAULT_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAuthError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const msg = String(error.message || '');
  return (
    error.connectionRefused === true ||
    error.status === 0 ||
    msg === 'Failed to fetch' ||
    msg.includes('ERR_CONNECTION_REFUSED') ||
    msg.includes('NetworkError') ||
    msg.includes('signal is aborted')
  );
}

async function fetchAuthWithRetry(path, init, { maxRetries = 4, baseDelayMs = 750 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutMs = init?.timeoutMs ?? AUTH_DEFAULT_TIMEOUT_MS;
      return await fetchJson(path, { ...init, timeoutMs });
    } catch (error) {
      lastError = error;
      const canRetry = isTransientAuthError(error) && attempt < maxRetries;
      if (!canRetry) throw error;
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }
  throw lastError;
}

/**
 * Obtém o token de autenticação do localStorage
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Salva o token de autenticação no localStorage
 */
export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Remove o token de autenticação do localStorage
 */
export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('auth_agent'); // Remove também as informações do agente
}

/**
 * Obtém o tenantId do agente autenticado (armazenado no localStorage)
 */
export function getTenantId() {
  try {
    // Prioridade: tenant efetivo selecionado explicitamente (super-admin)
    const effectiveTenantId = localStorage.getItem(EFFECTIVE_TENANT_KEY);
    if (effectiveTenantId && typeof effectiveTenantId === 'string' && effectiveTenantId.trim()) {
      return effectiveTenantId.trim();
    }

    const agentData = localStorage.getItem('auth_agent');
    if (agentData) {
      const agent = JSON.parse(agentData);
      return agent?.tenantId || null;
    }
  } catch {
    // Ignora erros de parse
  }
  return null;
}

/**
 * Retorna os headers de autenticação para requisições HTTP
 * Inclui automaticamente X-Tenant-Id quando disponível
 */
export function getAuthHeaders() {
  const token = getToken();
  if (!token) {
    return {};
  }
  
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  
  // Adiciona X-Tenant-Id se disponível
  const tenantId = getTenantId();
  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }
  
  return headers;
}

/**
 * Faz login e salva o token
 */
export async function login(username, password) {
  const result = await fetchAuthWithRetry('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    timeoutMs: AUTH_DEFAULT_TIMEOUT_MS,
  }, {
    maxRetries: 3,
    baseDelayMs: 750,
  });
  
  // Salva o token se retornado pela API
  if (result.token) {
    setToken(result.token);
  }
  
  // Salva informações do agente (incluindo tenantId) no localStorage
  if (result.agent) {
    try {
      localStorage.setItem('auth_agent', JSON.stringify(result.agent));
      console.log('[login] Agente salvo no localStorage:', result.agent);
    } catch (err) {
      console.warn('Erro ao salvar informações do agente:', err);
    }
  }
  
  return result;
}

/**
 * Faz logout e remove o token
 */
export async function logout() {
  try {
    await fetchJson('/auth/logout', {
      method: 'POST',
    });
  } catch (err) {
    // Continua mesmo se houver erro na API
    console.warn('Erro ao fazer logout na API:', err);
  } finally {
    removeToken();
  }
}

/**
 * Faz logout de todas as sessões do agente
 */
export async function logoutAll() {
  try {
    const result = await fetchJson('/auth/logout-all', {
      method: 'POST',
    });
    return result;
  } catch (err) {
    console.warn('Erro ao fazer logout de todas as sessões:', err);
    throw err;
  } finally {
    // Remove o token local mesmo se houver erro
    removeToken();
  }
}

/**
 * Obtém informações do agente autenticado
 */
export async function getCurrentAgent() {
  return fetchAuthWithRetry('/auth/me', {
    timeoutMs: AUTH_DEFAULT_TIMEOUT_MS,
  }, {
    maxRetries: 5,
    baseDelayMs: 500,
  });
}

export async function getMe(token) {
  return fetchJson('/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function listAgents() {
  return fetchJson('/auth/agents');
}

export async function getAgentNameById(id) {
  return fetchJson(`/auth/agents/${encodeURIComponent(id)}/name`);
}

export async function createAgent(data) {
  return fetchJson('/auth/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAgent(id, data) {
  return fetchJson(`/auth/agents/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(id) {
  return fetchJson(`/auth/agents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Convida um novo usuário
 */
export async function inviteUser(data) {
  return fetchJson('/auth/invite', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Aceita convite
 */
export async function acceptInvitation(invitationToken, password, username) {
  return fetchJson('/auth/accept-invitation', {
    method: 'POST',
    body: JSON.stringify({ invitationToken, password, username }),
  });
}

/**
 * Solicita reset de senha
 */
export async function requestPasswordReset(email) {
  return fetchJson('/auth/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/**
 * Reseta senha usando token
 */
export async function resetPassword(resetToken, newPassword) {
  return fetchJson('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ resetToken, newPassword }),
  });
}

/**
 * Consulta logs de auditoria
 */
export async function queryAuditLogs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.agentId) params.append('agentId', filters.agentId);
  if (filters.username) params.append('username', filters.username);
  if (filters.action) params.append('action', filters.action);
  if (filters.resource) params.append('resource', filters.resource);
  if (filters.resourceId) params.append('resourceId', filters.resourceId);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.limit) params.append('limit', filters.limit.toString());
  if (filters.offset) params.append('offset', filters.offset.toString());
  
  const query = params.toString();
  return fetchJson(`/audit/logs${query ? `?${query}` : ''}`);
}

/**
 * Obtém estatísticas de auditoria
 */
export async function getAuditStats() {
  return fetchJson('/audit/stats');
}

/**
 * Lista todas as conversas
 */
export async function listConversations() {
  return fetchJson('/conversations');
}

/**
 * Obtém detalhes de uma conversa específica
 */
export async function getConversation(sessionId) {
  return fetchJson(`/conversations/${encodeURIComponent(sessionId)}`);
}
