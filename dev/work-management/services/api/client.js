// Cliente HTTP fino para a API da plataforma RAP.
// - Sessão em localStorage (token NUNCA é logado).
// - Envia Authorization: Bearer + x-tenant-id (tenant configurável, default 'system').
// - 401 limpa a sessão e notifica o handler registrado (a UI volta para o login).

const TOKEN_KEY = 'wm_auth_token';
const TENANT_KEY = 'wm_auth_tenant';
const USER_KEY = 'wm_auth_user';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || null;
  }
}

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY) || null;
}

export function getTenant() {
  return window.localStorage.getItem(TENANT_KEY) || 'system';
}

export function getUsername() {
  return window.localStorage.getItem(USER_KEY) || '';
}

export function saveSession({ token, tenant, username }) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(TENANT_KEY, tenant || 'system');
  window.localStorage.setItem(USER_KEY, username || '');
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TENANT_KEY);
  window.localStorage.removeItem(USER_KEY);
}

let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

async function request(path, { method = 'GET', body = undefined, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-tenant-id'] = getTenant();
    }
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkError) {
    throw new ApiError(0, 'network_error', networkError?.message || 'Falha de rede ao falar com a API.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    clearSession();
    if (unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(401, payload?.error || 'unauthorized', payload?.message || 'Sessão expirada. Faça login novamente.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error || 'request_failed', payload?.message || `Erro HTTP ${response.status}.`);
  }

  return payload;
}

export function apiGet(path) {
  return request(path);
}

// Login real da plataforma: POST /auth/login?tenantId=<tenant> -> { token, ... }
export async function login({ tenant, username, password }) {
  const safeTenant = String(tenant || 'system').trim() || 'system';
  const payload = await request(`/auth/login?tenantId=${encodeURIComponent(safeTenant)}`, {
    method: 'POST',
    body: { username, password },
    auth: false,
  });
  if (!payload?.token) {
    throw new ApiError(401, 'invalid_credentials', 'Credenciais inválidas.');
  }
  return { token: payload.token, tenant: safeTenant, username };
}
