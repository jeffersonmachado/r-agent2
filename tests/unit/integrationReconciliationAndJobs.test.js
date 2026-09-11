'use strict';

/**
 * RESILIÊNCIA / JOBS — reconciliação, detecção de lacuna e handler de jobs.
 *
 * Prova:
 * - reconciliação periódica existe e usa watermark/overlap (missão §16);
 * - lacuna é detectada e força releitura completa em vez de confiar na janela;
 * - falha em um recurso não esconde os demais (status partial_failure);
 * - jobs da integração são tratados pelo handler canônico (fila existente);
 * - kind desconhecido NÃO é engolido como tratado.
 */

const { detectGap, reconcileConnection, DEFAULT_MAX_LAG_SECONDS } = require('../../api/services/integration/integrationReconciliationService');
const { handleIntegrationJob, isIntegrationJobKind, JOB_KINDS } = require('../../api/services/integration/integrationJobHandler');

describe('detectGap', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');

  it('lacuna quando nunca houve sucesso', () => {
    expect(detectGap({ lastSuccessAt: null, now, maxLagSeconds: 3600 })).toEqual({ gap: true, reason: 'never_succeeded' });
  });

  it('lacuna quando o atraso excede o intervalo esperado', () => {
    const result = detectGap({ lastSuccessAt: '2026-09-10T05:00:00.000Z', now, maxLagSeconds: 3600 });
    expect(result.gap).toBe(true);
    expect(result.reason).toBe('lag_exceeded');
    expect(result.lagSeconds).toBe(7 * 3600);
  });

  it('sem lacuna quando o último sucesso é recente', () => {
    const result = detectGap({ lastSuccessAt: '2026-09-10T11:30:00.000Z', now, maxLagSeconds: 3600 });
    expect(result.gap).toBe(false);
    expect(result.lagSeconds).toBe(1800);
  });

  it('lacuna quando a data é inválida', () => {
    expect(detectGap({ lastSuccessAt: 'nao-e-data', now, maxLagSeconds: 3600 }).reason).toBe('invalid_last_success');
  });

  it('intervalo padrão conservador de 6h', () => {
    expect(DEFAULT_MAX_LAG_SECONDS).toBe(6 * 60 * 60);
  });
});

describe('reconcileConnection', () => {
  function makeDeps({ states = {}, syncImpl = null } = {}) {
    const syncCalls = [];
    return {
      syncCalls,
      deps: {
        syncStateService: { getState: jest.fn(async ({ resourceType }) => states[resourceType] || { last_success_at: null }) },
        syncResource: jest.fn(async (params) => {
          syncCalls.push(params);
          if (syncImpl) return syncImpl(params);
          return { stats: { fetched: 1, created: 0 }, pagesProcessed: 1 };
        }),
        connectionService: {},
        logger: { warn: jest.fn() },
      },
    };
  }

  it('refaz leitura completa quando há lacuna e incremental quando não há', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const { deps, syncCalls } = makeDeps({
      states: {
        receivables: { last_success_at: '2026-09-10T11:55:00.000Z' },
        entries: { last_success_at: null },
      },
    });

    const result = await reconcileConnection({
      tenantId: 't1', connectionId: 'c1', resources: ['entries', 'receivables'], now, deps,
    });

    const byResource = Object.fromEntries(syncCalls.map((c) => [c.resource, c.mode]));
    expect(byResource.entries).toBe('initial'); // nunca sincronizou ⇒ leitura completa
    expect(byResource.receivables).toBe('incremental'); // sucesso recente ⇒ janela + overlap
    expect(result.gapsDetected).toBe(1); // apenas o recurso nunca sincronizado
    expect(result.status).toBe('completed');
  });

  it('não esconde falha parcial de um recurso', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const { deps } = makeDeps({
      syncImpl: async ({ resource }) => {
        if (resource === 'sales') {
          throw Object.assign(new Error('provider 503'), { code: 'integration_provider_unavailable' });
        }
        return { stats: {}, pagesProcessed: 1 };
      },
    });

    const result = await reconcileConnection({
      tenantId: 't1', connectionId: 'c1', resources: ['entries', 'sales'], now, deps,
    });

    expect(result.status).toBe('partial_failure');
    expect(result.failed).toBe(1);
    const sales = result.resources.find((r) => r.resource === 'sales');
    expect(sales.status).toBe('failed');
    expect(sales.error.code).toBe('integration_provider_unavailable');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('reconcilia os recursos financeiros e de presença por padrão', async () => {
    const { deps, syncCalls } = makeDeps({});
    await reconcileConnection({ tenantId: 't1', connectionId: 'c1', deps });
    expect(syncCalls.map((c) => c.resource).sort()).toEqual(['entries', 'memberships', 'receivables', 'sales']);
  });
});

describe('integrationJobHandler', () => {
  it('reconhece apenas kinds da integração', () => {
    expect(JOB_KINDS).toEqual([
      'integration_initial_sync',
      'integration_sync_resource',
      'integration_process_webhook',
      'integration_reconcile',
    ]);
    expect(isIntegrationJobKind('integration_sync_resource')).toBe(true);
    expect(isIntegrationJobKind('vertical_fitness_cycle')).toBe(false);
    expect(isIntegrationJobKind(undefined)).toBe(false);
  });

  it('devolve false para kind não pertencente (não engole job alheio)', async () => {
    expect(await handleIntegrationJob({ kind: 'outro_kind', payload: {} })).toBe(false);
  });

  it('trata integration_sync_resource delegando ao sync service', async () => {
    const syncResource = jest.fn(async () => ({ status: 'completed' }));
    const handled = await handleIntegrationJob(
      { kind: 'integration_sync_resource', tenant_key: 't1', payload: { connectionId: 'c1', resource: 'entries', mode: 'incremental' } },
      { syncResource },
    );
    expect(handled).toBe(true);
    expect(syncResource).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', connectionId: 'c1', resource: 'entries', mode: 'incremental',
    }));
  });

  it('trata integration_initial_sync', async () => {
    const runInitialSync = jest.fn(async () => ({ status: 'completed' }));
    const handled = await handleIntegrationJob(
      { kind: 'integration_initial_sync', tenant_key: 't1', payload: { connectionId: 'c1' } },
      { runInitialSync },
    );
    expect(handled).toBe(true);
    expect(runInitialSync).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', connectionId: 'c1' }));
  });

  it('trata integration_reconcile', async () => {
    const reconcileConnection = jest.fn(async () => ({ status: 'completed' }));
    const handled = await handleIntegrationJob(
      { kind: 'integration_reconcile', tenant_key: 't1', payload: { connectionId: 'c1' } },
      { reconcileConnection },
    );
    expect(handled).toBe(true);
    expect(reconcileConnection).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', connectionId: 'c1' }));
  });

  it('processa webhook marcando processed no sucesso', async () => {
    const markProcessed = jest.fn();
    const markFailed = jest.fn();
    const handled = await handleIntegrationJob(
      { kind: 'integration_process_webhook', tenant_key: 't1', payload: { eventId: 'e1' } },
      {
        processInboundDeps: {
          inboundService: {
            getEvent: jest.fn(async () => ({ id: 'e1', tenant_key: 't1', connection_id: 'c1', resource_type: 'entries' })),
            markProcessed,
            markFailed,
          },
          syncResource: jest.fn(async () => ({ status: 'completed' })),
        },
      },
    );
    expect(handled).toBe(true);
    expect(markProcessed).toHaveBeenCalledWith({ eventId: 'e1', tenantId: 't1' });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('marca failed e propaga erro quando o processamento do webhook falha', async () => {
    const markFailed = jest.fn();
    await expect(handleIntegrationJob(
      { kind: 'integration_process_webhook', tenant_key: 't1', payload: { eventId: 'e2' } },
      {
        processInboundDeps: {
          inboundService: {
            getEvent: jest.fn(async () => ({ id: 'e2', tenant_key: 't1', connection_id: 'c1', resource_type: 'entries' })),
            markProcessed: jest.fn(),
            markFailed,
          },
          syncResource: jest.fn(async () => { throw new Error('provider offline'); }),
        },
      },
    )).rejects.toThrow('provider offline');
    expect(markFailed).toHaveBeenCalled();
  });
});
