import { normalizeApiRequestError, postFormData, postJson } from '../src/api';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

describe('api.postJson', () => {
  it('envia POST com JSON e header Authorization quando token é informado', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const response: MockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    };
    return response as unknown as Response;
  }) as typeof fetch;

  try {
    const result = await postJson<{ success: boolean }>({
      baseUrl: 'http://localhost:3000',
      path: '/push/register',
      token: 'jwt-token',
      body: { hello: 'world' },
    });

      expect(result).toEqual({ success: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('http://localhost:3000/push/register');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(
      (calls[0]?.init?.headers as Record<string, string>).Authorization,
      ).toBe('Bearer jwt-token');
      expect(
      (calls[0]?.init?.headers as Record<string, string>)['Content-Type'],
      ).toBe('application/json');
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ hello: 'world' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  });

  it('lança erro com message da API quando HTTP não é OK', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    const response: MockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ message: 'Token inválido' }),
    };
    return response as unknown as Response;
  }) as typeof fetch;

  try {
      await expect(
        postJson({
        baseUrl: 'http://localhost:3000',
        path: '/push/register',
        body: {},
        }),
      ).rejects.toThrow('Token inválido');
  } finally {
    globalThis.fetch = originalFetch;
  }
  });

  it('normaliza envelope de erro com code/traceId', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      const response: MockResponse = {
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Muitas requisições',
            traceId: 'trace-123',
            retryable: true,
          },
        }),
      };
      return response as unknown as Response;
    }) as typeof fetch;

    try {
      let thrown: unknown = null;
      try {
        await postJson({
          baseUrl: 'http://localhost:3000',
          path: '/push/register',
          body: {},
        });
      } catch (err) {
        thrown = err;
      }

      const info = normalizeApiRequestError(thrown);
      expect(info.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(info.message).toBe('Muitas requisições');
      expect(info.traceId).toBe('trace-123');
      expect(info.retryable).toBe(true);
      expect(info.httpStatus).toBe(429);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('usa fallback HTTP <status> quando resposta não possui JSON válido', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    const response: MockResponse = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('invalid json');
      },
    };
    return response as unknown as Response;
  }) as typeof fetch;

  try {
      await expect(
        postJson({
        baseUrl: 'http://localhost:3000',
        path: '/push/register',
        body: {},
        }),
      ).rejects.toThrow('HTTP 500');
  } finally {
    globalThis.fetch = originalFetch;
  }
  });
});

describe('api.postFormData', () => {
  it('envia multipart sem forcar content-type json', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const response: MockResponse = {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
      return response as unknown as Response;
    }) as typeof fetch;

    try {
      const formData = new FormData();
      formData.append('file', 'blob');
      const result = await postFormData<{ success: boolean }>({
        baseUrl: 'http://localhost:3000',
        path: '/tickets/media/upload',
        token: 'jwt-token',
        body: formData,
      });

      expect(result).toEqual({ success: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('http://localhost:3000/tickets/media/upload');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(
        (calls[0]?.init?.headers as Record<string, string>).Authorization,
      ).toBe('Bearer jwt-token');
      expect(
        (calls[0]?.init?.headers as Record<string, string>)['Content-Type'],
      ).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
