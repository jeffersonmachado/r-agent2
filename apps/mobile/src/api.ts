type RequestArgs = {
  baseUrl: string;
  path: string;
  token?: string;
  tenantId?: string;
  requestId?: string;
};

export type ApiRequestError = Error & {
  status?: number;
  body?: unknown;
  url?: string;
  requestId?: string;
};

function buildHeaders(args: RequestArgs): { headers: Record<string, string>; requestId: string } {
  const requestId = args.requestId || `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': requestId,
    'X-Client': 'r-agent2-mobile',
  };

  if (args.token) {
    headers.Authorization = `Bearer ${args.token}`;
  }
  if (args.tenantId && String(args.tenantId).trim()) {
    headers['X-Tenant-Id'] = String(args.tenantId).trim();
  }

  return { headers, requestId };
}

export async function postJson<T = unknown>(args: RequestArgs & {
  body: Record<string, unknown>;
}): Promise<T> {
  const url = `${args.baseUrl}${args.path}`;
  const built = buildHeaders(args);
  const headers: Record<string, string> = { ...built.headers, 'Content-Type': 'application/json' };
  const requestId = built.requestId;

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[api] POST', url, {
      requestId,
      client: headers['X-Client'],
      hasToken: Boolean(args.token),
      bodyKeys: Object.keys(args.body || {}),
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.body),
  });

  const data = await response.json().catch(() => ({}));

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[api] RESPONSE', url, {
      requestId,
      status: response.status,
      ok: response.ok,
      message: (data && (data.message || data.error)) || null,
    });
  }

  if (!response.ok) {
    const message = (data && (data.message || data.error)) || `HTTP ${response.status}`;
    const error = new Error(String(message)) as ApiRequestError;
    error.status = response.status;
    error.body = data;
    error.url = url;
    error.requestId = requestId;
    throw error;
  }

  return data as T;
}

export async function getJson<T = unknown>(args: RequestArgs): Promise<T> {
  const url = `${args.baseUrl}${args.path}`;
  const { headers, requestId } = buildHeaders(args);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[api] GET', url, {
      requestId,
      client: headers['X-Client'],
      hasToken: Boolean(args.token),
    });
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[api] RESPONSE', url, {
      requestId,
      status: response.status,
      ok: response.ok,
      message: (data && (data.message || data.error)) || null,
    });
  }

  if (!response.ok) {
    const message = (data && (data.message || data.error)) || `HTTP ${response.status}`;
    const error = new Error(String(message)) as ApiRequestError;
    error.status = response.status;
    error.body = data;
    error.url = url;
    error.requestId = requestId;
    throw error;
  }

  return data as T;
}
