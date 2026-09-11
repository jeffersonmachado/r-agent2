'use strict';

/**
 * ADVERSARIAL — normalização de DTO, reconciliação e job handler.
 *
 * Casos hostis exigidos pela missão §23: datas malformadas, valor negativo,
 * moeda inválida, external id gigante, timestamp futuro, objeto externo
 * duplicado, ordem de evento invertida, lacuna de reconciliação.
 */

const {
  toIsoDate, toAmount, toCurrency, toExternalId, toStatus, toBoolean, normalizeResourceRecord,
} = require('../../api/services/integration/providers/evo/evoMappers');
const { INTEGRATION_ERROR_CODES } = require('../../api/services/integration/integrationRedaction');
const { detectGap, reconcileConnection } = require('../../api/services/integration/integrationReconciliationService');
const { isIntegrationJobKind, handleIntegrationJob, enqueueIntegrationJob } = require('../../api/services/integration/integrationJobHandler');
const evo = require('../../api/services/integration/providers/evo/evoProviderAdapter');

const contract = evo.loadContract();

describe('Adversarial — normalização de valores', () => {
  it('datas: ISO, BR, epoch, inválidas e futuras', () => {
    expect(toIsoDate('2026-09-10T12:00:00.000Z')).toBe('2026-09-10T12:00:00.000Z');
    expect(toIsoDate('10/09/2026')).toBe('2026-09-10T00:00:00.000Z');
    expect(toIsoDate('10/09/2026 08:30')).toBe('2026-09-10T08:30:00.000Z');
    expect(toIsoDate(1757500000000)).toBe(new Date(1757500000000).toISOString());
    // Datas inválidas NUNCA viram "hoje" silenciosamente: viram null.
    expect(toIsoDate('nao-e-data')).toBeNull();
    expect(toIsoDate('99/99/9999')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    // Timestamp futuro é aceito (o domínio decide depois), mas não é truncado.
    expect(toIsoDate('2099-01-01T00:00:00.000Z')).toBe('2099-01-01T00:00:00.000Z');
  });

  it('valores monetários em pt-BR, en-US, negativos e inválidos', () => {
    expect(toAmount('1.234,56')).toBeCloseTo(1234.56, 2);
    expect(toAmount('1234.56')).toBeCloseTo(1234.56, 2);
    expect(toAmount('R$ 199,90')).toBeCloseTo(199.9, 2);
    expect(toAmount(-50)).toBe(-50);
    expect(toAmount('abc')).toBeNull();
    expect(toAmount(null)).toBeNull();
    expect(toAmount(Number.NaN)).toBeNull();
  });

  it('moeda inválida cai no default declarado, nunca em texto arbitrário', () => {
    expect(toCurrency('BRL')).toBe('BRL');
    expect(toCurrency('brl')).toBe('BRL');
    expect(toCurrency('XYZ')).toBe('BRL');
    expect(toCurrency('')).toBe('BRL');
    expect(toCurrency(undefined)).toBe('BRL');
  });

  it('external id gigante é rejeitado explicitamente (não trunca em silêncio)', () => {
    expect(() => toExternalId('9'.repeat(500))).toThrow(expect.objectContaining({
      code: INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT,
    }));
    expect(toExternalId('  42  ')).toBe('42');
  });

  it('status desconhecido e booleanos tolerantes', () => {
    expect(toStatus('DELINQUENT', contract.statusMap.membershipBilling, 'active')).toBe('delinquent');
    expect(toStatus('status-novo', contract.statusMap.membershipBilling, 'active')).toBe('active');
    expect(toStatus(null, contract.statusMap.membershipBilling, 'active')).toBe('active');
    expect(toBoolean('sim')).toBe(true);
    expect(toBoolean('0')).toBe(false);
    expect(toBoolean('talvez', null)).toBeNull();
  });

  it('registro sem campo obrigatório lança schema drift', () => {
    expect(() => normalizeResourceRecord('members', { name: 'Sem id' }, contract))
      .toThrow(expect.objectContaining({ code: INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT }));
    expect(() => normalizeResourceRecord('entries', { idEntry: 1, idMember: 2 }, contract))
      .toThrow(expect.objectContaining({ code: INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT }));
  });

  it('recurso desconhecido é rejeitado', () => {
    expect(() => normalizeResourceRecord('biometria', {}, contract))
      .toThrow(expect.objectContaining({ code: INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED }));
  });

  it('campo opcional ausente/nulo não quebra o DTO', () => {
    const member = normalizeResourceRecord('members', { idMember: 7, name: null, email: null }, contract);
    expect(member.externalId).toBe('7');
    expect(member.email).toBeNull();
    expect(member.status).toBe('active');
  });

  it('resposta vazia/null não gera item fantasma', () => {
    const { extractItems } = require('../../api/services/integration/providers/evo/evoApiClient');
    expect(extractItems(null, {})).toEqual([]);
    expect(extractItems([], {})).toEqual([]);
    expect(extractItems({ data: null }, {})).toEqual([]);
  });
});

describe('Adversarial — reconciliação e detecção de lacuna', () => {
  it('detecta lacuna quando nunca houve sucesso', () => {
    expect(detectGap({ lastSuccessAt: null, now: new Date(), maxLagSeconds: 3600 })).toEqual({ gap: true, reason: 'never_succeeded' });
  });

  it('detecta lacuna por atraso e considera data inválida como lacuna', () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    expect(detectGap({ lastSuccessAt: new Date('2026-09-10T10:00:00.000Z'), now, maxLagSeconds: 3600 }).gap).toBe(true);
    expect(detectGap({ lastSuccessAt: new Date('2026-09-10T11:30:00.000Z'), now, maxLagSeconds: 3600 }).gap).toBe(false);
    expect(detectGap({ lastSuccessAt: 'data-invalida', now, maxLagSeconds: 3600 }).reason).toBe('invalid_last_success');
  });

  it('refaz leitura COMPLETA quando há lacuna e incremental quando não há', async () => {
    const modes = [];
    const deps = {
      syncStateService: {
        getState: jest.fn(async () => ({ last_success_at: new Date(Date.now() - 10 * 3600 * 1000) })),
      },
      syncResource: jest.fn(async ({ mode }) => { modes.push(mode); return { stats: {} }; }),
      logger: { warn: jest.fn() },
    };
    const result = await reconcileConnection({
      tenantId: 't1', connectionId: 'c1', resources: ['entries', 'sales'], deps, now: new Date(),
    });
    expect(modes).toEqual(['initial', 'initial']);
    expect(result.gapsDetected).toBe(2);
    expect(result.status).toBe('completed');
  });

  it('reporta falha parcial sem esconder recurso quebrado', async () => {
    const deps = {
      syncStateService: { getState: jest.fn(async () => ({ last_success_at: new Date() })) },
      syncResource: jest.fn(async ({ resource }) => {
        if (resource === 'sales') throw Object.assign(new Error('boom'), { code: 'integration_provider_unavailable' });
        return { stats: {} };
      }),
      logger: { warn: jest.fn() },
    };
    const result = await reconcileConnection({ tenantId: 't1', connectionId: 'c1', resources: ['entries', 'sales'], deps });
    expect(result.status).toBe('partial_failure');
    expect(result.failed).toBe(1);
    expect(result.resources.find((r) => r.resource === 'sales').error.code).toBe('integration_provider_unavailable');
  });
});

describe('Adversarial — job handler da integração', () => {
  it('reconhece apenas os kinds da integração', () => {
    expect(isIntegrationJobKind('integration_initial_sync')).toBe(true);
    expect(isIntegrationJobKind('integration_process_webhook')).toBe(true);
    expect(isIntegrationJobKind('vertical_notification_send')).toBe(false);
    expect(isIntegrationJobKind('scan_sla')).toBe(false);
    expect(handleIntegrationJob({ kind: 'scan_sla', payload: {} })).resolves.toBe(false);
  });

  it('rejeita enfileiramento de kind desconhecido', async () => {
    await expect(enqueueIntegrationJob({ tenantId: 't1', kind: 'integration_hack' }))
      .rejects.toMatchObject({ code: 'unsupported_integration_job_kind' });
  });

  it('processa evento de webhook marcando o estado final', async () => {
    const deps = {
      inboundService: {
        getEvent: jest.fn(async () => ({ id: 'e1', tenant_key: 't1', connection_id: 'c1', resource_type: 'entries' })),
        markProcessed: jest.fn(async () => ({})),
        markFailed: jest.fn(async () => ({})),
      },
      syncResource: jest.fn(async () => ({ stats: {} })),
    };
    const result = await handleIntegrationJob(
      { kind: 'integration_process_webhook', payload: { eventId: 'e1' }, tenant_key: 't1' },
      { processInboundDeps: deps },
    );
    expect(result).toBe(true);
    expect(deps.inboundService.markProcessed).toHaveBeenCalledWith({ eventId: 'e1', tenantId: 't1' });
    expect(deps.syncResource).toHaveBeenCalledWith(expect.objectContaining({ resource: 'entries', mode: 'incremental' }));
  });

  it('marca falha quando o processamento do webhook falha (sem engolir erro)', async () => {
    const deps = {
      inboundService: {
        getEvent: jest.fn(async () => ({ id: 'e2', tenant_key: 't1', connection_id: 'c1', resource_type: 'sales' })),
        markProcessed: jest.fn(async () => ({})),
        markFailed: jest.fn(async () => ({})),
      },
      syncResource: jest.fn(async () => { throw new Error('provider fora do ar'); }),
    };
    await expect(handleIntegrationJob(
      { kind: 'integration_process_webhook', payload: { eventId: 'e2' }, tenant_key: 't1' },
      { processInboundDeps: deps },
    )).rejects.toThrow('provider fora do ar');
    expect(deps.inboundService.markFailed).toHaveBeenCalled();
    expect(deps.inboundService.markProcessed).not.toHaveBeenCalled();
  });

  it('evento de webhook inexistente falha explicitamente', async () => {
    const deps = {
      inboundService: { getEvent: jest.fn(async () => null), markProcessed: jest.fn(), markFailed: jest.fn() },
      syncResource: jest.fn(),
    };
    await expect(handleIntegrationJob(
      { kind: 'integration_process_webhook', payload: { eventId: 'nao-existe' }, tenant_key: 't1' },
      { processInboundDeps: deps },
    )).rejects.toMatchObject({ code: 'integration_inbound_event_not_found' });
  });

  it('integração é read-only: nenhuma operação de escrita é exposta pelo adapter', () => {
    const writeLike = Object.keys(evo).filter((key) => /^(create|update|delete|put|post|insert|write|save)/i.test(key));
    expect(writeLike).toEqual([]);
    expect(evo.capabilities().readOnly).toBe(true);
  });
});
