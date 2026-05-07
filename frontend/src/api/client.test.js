import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson } from './client';

describe('api/client - fetchJson', () => {
  beforeEach(() => {
    // @ts-ignore
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('retorna JSON quando a resposta é ok e application/json', async () => {
    const body = { foo: 'bar' };
    // @ts-ignore
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: vi.fn().mockResolvedValue(body),
    });

    const result = await fetchJson('/test');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(body);
  });

  it('lança erro com status e body quando a resposta não é ok', async () => {
    const errorBody = { error: 'fail' };
    // @ts-ignore
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: vi.fn().mockResolvedValue(errorBody),
    });

    await expect(fetchJson('/error')).rejects.toMatchObject({
      status: 500,
      body: errorBody,
    });
  });

  it('falha quando /workspace/entities retorna HTML ao invés de JSON', async () => {
    // @ts-ignore
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: vi.fn().mockResolvedValue('<!doctype html><html><body>Fallback SPA</body></html>'),
    });

    await expect(fetchJson('/workspace/entities?limit=60')).rejects.toMatchObject({
      status: 200,
      isHtmlResponse: true,
    });
  });
});


