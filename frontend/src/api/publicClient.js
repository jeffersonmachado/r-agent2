import { buildApiUrl } from './client';

/**
 * Cliente HTTP público (sem Authorization/X-Tenant-Id).
 * - Usado por telas públicas (storefront, kiosk, panel).
 * - Não faz redirect automático em 401.
 */
export async function fetchPublicJson(path, init = {}) {
  const url = buildApiUrl(path);
  const method = init.method || 'GET';

  const hasBody = init.body !== undefined && init.body !== null;
  const headers = {
    ...(init.headers || {}),
    'Accept': 'application/json',
    ...(hasBody && { 'Content-Type': 'application/json' }),
  };

  const res = await fetch(url, {
    ...init,
    method,
    headers,
  });

  const contentType = res.headers.get('Content-Type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    // @ts-ignore
    err.status = res.status;
    // @ts-ignore
    err.body = body;
    throw err;
  }

  return body;
}

