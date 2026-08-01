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
