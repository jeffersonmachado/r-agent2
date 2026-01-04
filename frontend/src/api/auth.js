import { fetchJson } from './client';

const TOKEN_KEY = 'auth_token';

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
}

/**
 * Retorna os headers de autenticação para requisições HTTP
 */
export function getAuthHeaders() {
  const token = getToken();
  if (!token) {
    return {};
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Faz login e salva o token
 */
export async function login(username, password) {
  const result = await fetchJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  
  // Salva o token se retornado pela API
  if (result.token) {
    setToken(result.token);
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
  return fetchJson('/auth/me');
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
