import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLroStream } from './useLroStream';

/** Stream de teste: entrega os blocos e, opcionalmente, encerra (done) imediatamente depois. */
function streamDe(blocos, { encerra = true } = {}) {
  const codificador = new TextEncoder();
  let indice = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (indice < blocos.length) {
          const pedaco = codificador.encode(blocos[indice]);
          indice += 1;
          return { value: pedaco, done: false };
        }
        if (encerra) return { value: undefined, done: true };
        return new Promise(() => {});
      },
    }),
  };
}

const bloco = (seq, tipo, extra = {}) => `id: ${seq}\nevent: ${tipo}\ndata: ${JSON.stringify({ seq, type: tipo, ...extra })}\n\n`;

describe('useLroStream (LRO — UI DEVELOPMENT)', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });
  afterEach(() => { global.fetch = fetchOriginal; });

  // DEFEITO MEDIDO 2026-10-31 no browser real (/dev/qa-waves, stack viva): o detalhe da operação
  // abria com "conexão: reconectando" e a requisição SSE voltava 400 `tenant_required`. A rota
  // resolve o tenant por `X-Tenant-Id`; o painel montava o hook sem `tenantId`, então o header não
  // ia. O hook passa a herdar os cabeçalhos da sessão (`getAuthHeaders`) — nenhum chamador pode
  // esquecer o tenant e derrubar o stream.
  it('sem opções explícitas, usa os cabeçalhos da sessão (token + X-Tenant-Id)', async () => {
    window.localStorage.setItem('auth_token', 'tk-sessao');
    window.localStorage.setItem('auth_effective_tenant_id', 'system');

    const chamadas = [];
    global.fetch = vi.fn(async (url, init) => {
      chamadas.push({ url, init });
      return { ok: true, status: 200, body: streamDe([]) };
    });

    renderHook(() => useLroStream({ operationId: 'op-sessao' }));

    await waitFor(() => expect(chamadas.length).toBeGreaterThan(0));
    const headers = chamadas[0].init.headers;
    expect(headers.Authorization).toBe('Bearer tk-sessao');
    expect(headers['X-Tenant-Id']).toBe('system');
  });

  it('entrega eventos PROGRESSIVAMENTE e expõe o último seq', async () => {
    const chamadas = [];
    global.fetch = vi.fn(async (url, init) => {
      chamadas.push({ url, init });
      return { ok: true, status: 200, body: streamDe([bloco(1, 'CREATED'), bloco(2, 'PROGRESS', { payload: { current: 2 } })]) };
    });

    const recebidos = [];
    const { result } = renderHook(() => useLroStream({
      operationId: 'op-1', token: 'tk', tenantId: 'system', onEvent: (e) => recebidos.push(e.type),
    }));

    await waitFor(() => expect(recebidos).toContain('PROGRESS'));
    expect(recebidos[0]).toBe('CREATED');
    expect(result.current.lastSeq).toBe(2);
    expect(chamadas[0].url).toContain('/api/lro/op-1/events');
    expect(chamadas[0].init.headers.Authorization).toBe('Bearer tk');
    expect(chamadas[0].init.headers['X-Tenant-Id']).toBe('system');
  });

  it('na reconexão envia Last-Event-ID com o último seq (sem lacuna nem repetição)', async () => {
    const cabecalhos = [];
    let chamada = 0;
    global.fetch = vi.fn(async (_url, init) => {
      chamada += 1;
      cabecalhos.push({ ...init.headers });
      if (chamada === 1) {
        // Primeira conexão entrega 1 e 2 e morre (stream encerrado)
        return { ok: true, status: 200, body: streamDe([bloco(1, 'CREATED'), bloco(2, 'RUNNING')]) };
      }
      // Segunda conexão: só o que faltou
      return { ok: true, status: 200, body: streamDe([bloco(3, 'COMPLETED', { payload: { outcome: 'NO_GO' } })]) };
    });

    const tipos = [];
    renderHook(() => useLroStream({
      operationId: 'op-2', token: 'tk', onEvent: (e) => tipos.push(e.type),
    }));

    await waitFor(() => expect(tipos).toContain('COMPLETED'), { timeout: 5000 });
    expect(cabecalhos.length).toBeGreaterThanOrEqual(2);
    expect(cabecalhos[1]['Last-Event-ID']).toBe('2');
    // Sem duplicação: 1, 2, 3 — cada seq uma vez
    expect(tipos).toEqual(['CREATED', 'RUNNING', 'COMPLETED']);
  });

  it('não conecta quando desabilitado', async () => {
    global.fetch = vi.fn();
    renderHook(() => useLroStream({ operationId: 'op-3', enabled: false }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('erro HTTP não vira "conectado"', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, body: null }));
    const { result } = renderHook(() => useLroStream({ operationId: 'op-4', token: 'tk', maxReconexoes: 0 }));
    await waitFor(() => expect(result.current.state).toBe('closed'));
  });

  // P1-F (prompt duro 2026-10-31): o hook não reiniciava cursor/histórico por identidade. Ao trocar
  // de operação, `cursorRef` continuava no seq da anterior — eventos novos com seq menor eram
  // DESCARTADOS como "replay" — e `events` mantinha a lista antiga na tela (contaminação de outra
  // operação/tenant). Além disso o timer de reconexão não era cancelado, então um reconnect
  // agendado reabria o stream da operação ANTIGA.
  it('trocar de operação reinicia cursor e histórico (sem descartar eventos novos)', async () => {
    const chamadas = [];
    global.fetch = vi.fn(async (url) => {
      chamadas.push(url);
      const id = String(url).split('/api/lro/')[1].split('/events')[0];
      return { ok: true, status: 200, body: streamDe([bloco(5, 'CREATED', { operationId: id })]) };
    });

    const { result, rerender } = renderHook(
      ({ opId }) => useLroStream({ operationId: opId, token: 'tk', tenantId: 'system' }),
      { initialProps: { opId: 'op-A' } },
    );
    await waitFor(() => expect(result.current.lastSeq).toBe(5));

    rerender({ opId: 'op-B' });

    // Novo stream começa em seq 5 (mesmo número da anterior): NÃO pode ser descartado.
    await waitFor(() => expect(result.current.events.length).toBeGreaterThan(0));
    await waitFor(() => {
      const doB = chamadas.filter((u) => String(u).includes('op-B'));
      expect(doB.length).toBeGreaterThan(0);
    });
    // Histórico não mistura operações: todos os eventos visíveis são do stream atual.
    expect(result.current.events.every((e) => e.payload && e.payload.operationId === 'op-B')).toBe(true);
  });
});
