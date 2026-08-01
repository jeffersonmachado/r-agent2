import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regressão — 404 de estado vazio não pode poluir o console.
 *
 * Falha observada (2026-08-01, page-surface wave no CI, ambiente efêmero):
 * as páginas /qa-mesh, /pbx/extensions e /pbx/governance falharam a
 * assertiva pageLoads ("não houve console.error") porque o client loga
 * logger.error em qualquer resposta não-2xx — inclusive nos 404 que são
 * ESTADO VAZIO legítimo por contrato da API:
 *   - GET /qa-mesh/latest → 404 "Nenhuma execução disponível" (sem execução
 *     de mesh ainda);
 *   - GET /api/pbx/provisioning-token → 404 "Tenant PBX não encontrado"
 *     (tenant sem token provisionado).
 * O client já oferece o mecanismo `expectedStatuses` para suprimir o log de
 * erro em status esperados; estes dois callers não o usavam.
 *
 * Comportamento correto esperado: os dois callers declaram
 * expectedStatuses: [404] — a página continua tratando o 404 como estado
 * vazio, mas sem console.error (a assertiva pageLoads da wave volta a
 * medir quebra real da página, não ruído de ambiente vazio).
 */

describe('api/qaMesh + api/pbx — 404 de estado vazio como expectedStatuses', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('getQaMeshLatest declara 404 esperado (empty state sem execução)', async () => {
    vi.doMock('./client', () => ({ fetchJson: vi.fn().mockResolvedValue({}) }));
    const { getQaMeshLatest } = await import('./qaMesh');
    const client = await import('./client');

    await getQaMeshLatest();

    expect(vi.mocked(client.fetchJson)).toHaveBeenCalledWith(
      '/qa-mesh/latest',
      expect.objectContaining({ expectedStatuses: [404] }),
    );
  });

  it('getProvisioningToken declara 404 esperado (tenant sem token)', async () => {
    vi.doMock('./client', () => ({ fetchJson: vi.fn().mockResolvedValue({}) }));
    const { getProvisioningToken } = await import('./pbx');
    const client = await import('./client');

    await getProvisioningToken();

    expect(vi.mocked(client.fetchJson)).toHaveBeenCalledWith(
      '/api/pbx/provisioning-token',
      expect.objectContaining({ method: 'GET', expectedStatuses: [404] }),
    );
  });
});

/**
 * Regressão — 404 de provisioning-token não pode derrubar o load da página.
 *
 * Falha observada (2026-08-01, page-surface wave no CI, run 30707403770):
 * mesmo com expectedStatuses suprimindo o log do client, as páginas
 * /pbx/extensions e /pbx/governance falharam pageLoads porque o 404
 * REJEITA o Promise.all do loadData e o catch da página loga
 * logger.error('[Pbx*Page] load failed') + toast de erro — ou seja, um
 * tenant sem PBX provisionado (estado vazio legítimo) era tratado como
 * falha de carregamento.
 *
 * Comportamento correto esperado: getProvisioningTokenOrNull devolve null
 * no 404 (a página renderiza o empty state "sem token"), e continua
 * relançando qualquer outro erro (falhas reais seguem visíveis).
 */
describe('api/pbx — getProvisioningTokenOrNull (empty state no nível da página)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('devolve null quando a API responde 404 (tenant sem PBX provisionado)', async () => {
    const err = new Error('Erro HTTP 404 ao chamar /api/pbx/provisioning-token - Tenant PBX não encontrado');
    // @ts-ignore — shape real do erro lançado pelo fetchJson (client.js)
    err.status = 404;
    vi.doMock('./client', () => ({ fetchJson: vi.fn().mockRejectedValue(err) }));
    const { getProvisioningTokenOrNull } = await import('./pbx');

    await expect(getProvisioningTokenOrNull()).resolves.toBeNull();
  });

  it('relança erros que não são 404 (falha real continua visível)', async () => {
    const err = new Error('Erro HTTP 500 ao chamar /api/pbx/provisioning-token');
    // @ts-ignore
    err.status = 500;
    vi.doMock('./client', () => ({ fetchJson: vi.fn().mockRejectedValue(err) }));
    const { getProvisioningTokenOrNull } = await import('./pbx');

    await expect(getProvisioningTokenOrNull()).rejects.toBe(err);
  });

  it('devolve o payload quando o token existe', async () => {
    vi.doMock('./client', () => ({ fetchJson: vi.fn().mockResolvedValue({ ok: true, token: 'abc' }) }));
    const { getProvisioningTokenOrNull } = await import('./pbx');

    await expect(getProvisioningTokenOrNull()).resolves.toEqual({ ok: true, token: 'abc' });
  });
});
