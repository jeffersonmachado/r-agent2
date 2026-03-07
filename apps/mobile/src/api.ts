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
  code?: string;
  traceId?: string;
  retryable?: boolean;
  details?: unknown;
};

export type NormalizedApiRequestError = {
  code: string;
  message: string;
  details: unknown;
  httpStatus?: number;
  traceId?: string;
  retryable?: boolean;
};

function resolveApiErrorMessage(data: unknown, status: number): string {
  const body = (data || {}) as {
    error?: string | { message?: string };
    message?: string;
  };
  const envelopeError = body?.error;
  if (envelopeError && typeof envelopeError === 'object' && envelopeError.message) {
    return String(envelopeError.message);
  }
  if (typeof envelopeError === 'string' && envelopeError.trim()) {
    return envelopeError.trim();
  }
  if (body?.message && String(body.message).trim()) {
    return String(body.message).trim();
  }
  return `HTTP ${status}`;
}

export function normalizeApiRequestError(err: unknown): NormalizedApiRequestError {
  const typed = (err || {}) as ApiRequestError & {
    body?: {
      error?: string | {
        code?: string;
        message?: string;
        details?: unknown;
        traceId?: string;
        retryable?: boolean;
        httpStatus?: number;
      };
      message?: string;
      details?: unknown;
      traceId?: string;
      retryable?: boolean;
      code?: string;
    };
    code?: string;
    details?: unknown;
    traceId?: string;
    retryable?: boolean;
  };

  const envelopeError = typed?.body?.error;
  const envelopeObj = envelopeError && typeof envelopeError === 'object'
    ? envelopeError
    : null;
  const code = String(
    typed.code
    || typed?.body?.code
    || envelopeObj?.code
    || (typeof envelopeError === 'string' ? envelopeError : 'UNKNOWN_ERROR')
  );
  const message = String(
    typed.message
    || envelopeObj?.message
    || typed?.body?.message
    || `HTTP ${typed.status || 0}`
  );
  const details = typed.details ?? envelopeObj?.details ?? typed?.body?.details ?? null;
  const httpStatus = typed.status ?? envelopeObj?.httpStatus;
  const traceId = String(typed.traceId || envelopeObj?.traceId || typed?.body?.traceId || '').trim() || undefined;
  const retryableValue = typed.retryable ?? envelopeObj?.retryable ?? typed?.body?.retryable;
  const retryable = typeof retryableValue === 'boolean' ? retryableValue : undefined;

  return { code, message, details, httpStatus, traceId, retryable };
}

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
    const message = resolveApiErrorMessage(data, response.status);
    const envelope = (data && typeof data === 'object' ? (data as { error?: unknown }) : {});
    const envelopeError = envelope.error && typeof envelope.error === 'object'
      ? (envelope.error as { code?: string; traceId?: string; retryable?: boolean; details?: unknown })
      : null;
    const error = new Error(String(message)) as ApiRequestError;
    error.status = response.status;
    error.body = data;
    error.url = url;
    error.requestId = requestId;
    error.code = String((envelopeError?.code) || ((data as { code?: string })?.code || 'UNKNOWN_ERROR'));
    error.traceId = String(envelopeError?.traceId || (data as { traceId?: string })?.traceId || '').trim() || undefined;
    error.retryable = typeof envelopeError?.retryable === 'boolean'
      ? envelopeError.retryable
      : (typeof (data as { retryable?: unknown })?.retryable === 'boolean'
        ? Boolean((data as { retryable?: unknown }).retryable)
        : undefined);
    error.details = envelopeError?.details ?? (data as { details?: unknown })?.details ?? null;
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
    const message = resolveApiErrorMessage(data, response.status);
    const envelope = (data && typeof data === 'object' ? (data as { error?: unknown }) : {});
    const envelopeError = envelope.error && typeof envelope.error === 'object'
      ? (envelope.error as { code?: string; traceId?: string; retryable?: boolean; details?: unknown })
      : null;
    const error = new Error(String(message)) as ApiRequestError;
    error.status = response.status;
    error.body = data;
    error.url = url;
    error.requestId = requestId;
    error.code = String((envelopeError?.code) || ((data as { code?: string })?.code || 'UNKNOWN_ERROR'));
    error.traceId = String(envelopeError?.traceId || (data as { traceId?: string })?.traceId || '').trim() || undefined;
    error.retryable = typeof envelopeError?.retryable === 'boolean'
      ? envelopeError.retryable
      : (typeof (data as { retryable?: unknown })?.retryable === 'boolean'
        ? Boolean((data as { retryable?: unknown }).retryable)
        : undefined);
    error.details = envelopeError?.details ?? (data as { details?: unknown })?.details ?? null;
    throw error;
  }

  return data as T;
}

export async function postFormData<T = unknown>(args: RequestArgs & {
  body: FormData;
}): Promise<T> {
  const url = `${args.baseUrl}${args.path}`;
  const { headers, requestId } = buildHeaders(args);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[api] POST multipart', url, {
      requestId,
      client: headers['X-Client'],
      hasToken: Boolean(args.token),
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: args.body,
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
    const message = resolveApiErrorMessage(data, response.status);
    const envelope = (data && typeof data === 'object' ? (data as { error?: unknown }) : {});
    const envelopeError = envelope.error && typeof envelope.error === 'object'
      ? (envelope.error as { code?: string; traceId?: string; retryable?: boolean; details?: unknown })
      : null;
    const error = new Error(String(message)) as ApiRequestError;
    error.status = response.status;
    error.body = data;
    error.url = url;
    error.requestId = requestId;
    error.code = String((envelopeError?.code) || ((data as { code?: string })?.code || 'UNKNOWN_ERROR'));
    error.traceId = String(envelopeError?.traceId || (data as { traceId?: string })?.traceId || '').trim() || undefined;
    error.retryable = typeof envelopeError?.retryable === 'boolean'
      ? envelopeError.retryable
      : (typeof (data as { retryable?: unknown })?.retryable === 'boolean'
        ? Boolean((data as { retryable?: unknown }).retryable)
        : undefined);
    error.details = envelopeError?.details ?? (data as { details?: unknown })?.details ?? null;
    throw error;
  }

  return data as T;
}
