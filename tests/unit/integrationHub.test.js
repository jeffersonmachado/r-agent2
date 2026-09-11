'use strict';

/**
 * Integration Hub — garantias estruturais da camada provider-neutral.
 *
 * Cobre: registry/contrato de provider, redaction/segredos, idempotência do
 * mapeamento de external id, isolamento multi-tenant, cursor/watermark e
 * dedup de eventos de entrada.
 */

const { redactDeep, sanitizeError, IntegrationError, INTEGRATION_ERROR_CODES } = require('../../api/services/integration/integrationRedaction');
const { checkProviderContract, assertProviderContract, RESOURCE_TYPES, assertNormalizedPage } = require('../../api/services/integration/providerContract');

jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));

const mockConnectionModel = { create: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), count: jest.fn() };
const mockLinkModel = { create: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), count: jest.fn() };
const mockSyncModel = { create: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), update: jest.fn() };
const mockEventModel = { create: jest.fn(), findOne: jest.fn(), findAll: jest.fn() };

jest.mock('../../api/db/models', () => ({
  IntegrationConnection: jest.fn(() => mockConnectionModel),
  IntegrationObjectLink: jest.fn(() => mockLinkModel),
  IntegrationSyncState: jest.fn(() => mockSyncModel),
  IntegrationInboundEvent: jest.fn(() => mockEventModel),
}));

jest.mock('../../api/utils/crypto', () => ({
  encrypt: jest.fn((value) => `enc(${value})`),
  decrypt: jest.fn((value) => String(value).replace(/^enc\(/, '').replace(/\)$/, '')),
  generateEncryptionKey: jest.fn(() => 'k'),
  getEncryptionKey: jest.fn(() => 'k'),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { registerProvider, getProvider, listProviderIds, resetRegistry, hasProvider } = require('../../api/services/integration/integrationRegistry');
const connectionService = require('../../api/services/integration/integrationConnectionService');
const linkService = require('../../api/services/integration/integrationObjectLinkService');
const syncStateService = require('../../api/services/integration/integrationSyncStateService');
const inboundService = require('../../api/services/integration/integrationInboundEventService');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CONNECTION_A = 'conn-a';

function makeUniqueError() {
  const error = new Error('Validation error');
  error.name = 'SequelizeUniqueConstraintError';
  error.original = { code: '23505' };
  return error;
}

/** Provider mínimo que satisfaz o contrato (usado só para exercitar o registry). */
function makeStubProvider(id = 'stub') {
  return {
    providerId: () => id,
    capabilities: () => ({ provider: id, readOnly: true, supportsWebhooks: true, supportsIncremental: true, resources: [...RESOURCE_TYPES] }),
    validateConnection: async () => ({ ok: true }),
    fetchPage: async ({ limit = 10 } = {}) => ({ items: [], nextCursor: null, hasMore: false, watermark: null, limit }),
    fetchOne: async () => null,
    verifyWebhookSignature: () => ({ ok: true }),
    normalizeWebhook: () => ({ eventType: 'unknown', idempotencyKey: 'k', payload: {} }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRegistry();

  // `jest.config.cjs` usa resetMocks:true — as implementações passadas a
  // `jest.fn(impl)` no escopo do módulo são apagadas antes de cada teste.
  // Elas precisam ser restabelecidas aqui (mesmo padrão dos outros testes unit).
  const { getSequelize } = require('../../api/db/sequelize');
  getSequelize.mockReturnValue({});
  const crypto = require('../../api/utils/crypto');
  crypto.encrypt.mockImplementation((value) => `enc(${value})`);
  crypto.decrypt.mockImplementation((value) => String(value).replace(/^enc\(/, '').replace(/\)$/, ''));
  const models = require('../../api/db/models');
  models.IntegrationConnection.mockImplementation(() => mockConnectionModel);
  models.IntegrationObjectLink.mockImplementation(() => mockLinkModel);
  models.IntegrationSyncState.mockImplementation(() => mockSyncModel);
  models.IntegrationInboundEvent.mockImplementation(() => mockEventModel);
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe('integrationRedaction', () => {
  it('remove segredos conhecidos por chave', () => {
    const out = redactDeep({
      username: 'token-abc',
      secretKey: 'super-secret',
      Authorization: 'Basic dXNlcjpwYXNz',
      nested: { apiKey: 'xyz', password: 'p', token: 't' },
    });
    expect(out.username).toBe('token-abc');
    expect(out.secretKey).toBe('[REDACTED]');
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out.nested).toEqual({ apiKey: '[REDACTED]', password: '[REDACTED]', token: '[REDACTED]' });
  });

  it('remove PAN e credencial embutida em string', () => {
    const out = redactDeep({
      note: 'pagar com 4111 1111 1111 1111 hoje',
      url: 'https://user:pass@api.example.com/v1',
      header: 'Bearer abcdef123456',
    });
    expect(out.note).not.toMatch(/4111/);
    expect(out.note).toContain('[REDACTED_PAN]');
    expect(out.url).not.toContain('pass');
    expect(out.header).not.toContain('abcdef123456');
  });

  it('descarta chaves biométricas e de cartão', () => {
    const out = redactDeep({ name: 'Ana', faceTemplate: 'BLOB', cvv: '123', cardNumber: '4111111111111111' });
    expect(out).toEqual({ name: 'Ana' });
  });

  it('sobrevive a estrutura circular e profundidade excessiva', () => {
    const node = { name: 'x' };
    node.self = node;
    expect(redactDeep(node).self).toBe('[CIRCULAR]');
    let deep = { value: 1 };
    for (let i = 0; i < 20; i += 1) deep = { next: deep };
    expect(JSON.stringify(redactDeep(deep))).toContain('TRUNCATED_DEPTH');
  });

  it('sanitiza erro sem vazar segredo contido na mensagem', () => {
    const error = new Error('falha com Bearer abcdef123456 e secretKey=abc');
    const sanitized = sanitizeError(error);
    expect(sanitized.message).not.toContain('abcdef123456');
    expect(JSON.stringify(sanitized)).not.toContain('secretKey=abc');
  });

  it('IntegrationError sanitiza details', () => {
    const err = new IntegrationError('x', 'falhou', { secretKey: 'abc', nested: { Authorization: 'Bearer zzz' } });
    expect(err.details.secretKey).toBe('[REDACTED]');
    expect(err.details.nested.Authorization).toBe('[REDACTED]');
  });
});

// ── Registry + contrato ─────────────────────────────────────────────────────

describe('integrationRegistry / providerContract', () => {
  it('aceita provider que cumpre o contrato', () => {
    registerProvider(makeStubProvider('evo'));
    expect(listProviderIds()).toEqual(['evo']);
    expect(getProvider('EVO').providerId()).toBe('evo');
  });

  it('rejeita provider incompleto com código estável', () => {
    expect(() => registerProvider({ providerId: () => 'broken' })).toThrow(expect.objectContaining({
      code: INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION,
    }));
    expect(checkProviderContract({ providerId: () => 'broken' }).missing.length).toBeGreaterThan(0);
  });

  it('falha ao resolver provider desconhecido listando os disponíveis', () => {
    registerProvider(makeStubProvider('evo'));
    try {
      getProvider('inexistente');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error.code).toBe(INTEGRATION_ERROR_CODES.PROVIDER_UNKNOWN);
      expect(error.details.available).toEqual(['evo']);
    }
  });

  it('assertNormalizedPage rejeita página malformada', () => {
    expect(() => assertNormalizedPage({}, {})).toThrow(expect.objectContaining({ code: INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE }));
    expect(() => assertNormalizedPage({ items: [], hasMore: true }, {}))
      .toThrow(expect.objectContaining({ code: INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE }));
    expect(assertNormalizedPage({ items: [], hasMore: false }).items).toEqual([]);
  });

  it('assertProviderContract devolve true para provider válido', () => {
    expect(assertProviderContract(makeStubProvider())).toBe(true);
    expect(hasProvider('stub')).toBe(false); // registry não é populado por assert
  });
});

// ── Conexão ─────────────────────────────────────────────────────────────────

describe('integrationConnectionService', () => {
  it('cifra credencial e nunca devolve o campo cifrado na projeção pública', async () => {
    registerProvider(makeStubProvider('evo'));
    mockConnectionModel.create.mockImplementation(async (payload) => ({ ...payload, toJSON: () => payload }));

    const created = await connectionService.createConnection({
      tenantId: TENANT_A,
      provider: 'evo',
      config: { baseUrl: 'https://x', overlapSeconds: 600, ignored: 'nope' },
      credentials: { token: 't', secretKey: 's' },
    });

    const stored = mockConnectionModel.create.mock.calls[0][0];
    expect(stored.credentials_encrypted).toMatch(/^enc\(/);
    expect(stored.config).toEqual({ baseUrl: 'https://x', overlapSeconds: 600 });
    expect(created.credentials_encrypted).toBeUndefined();
    expect(created.hasCredentials).toBe(true);
    expect(JSON.stringify(created)).not.toContain('secretKey');
  });

  it('rejeita credenciais inválidas antes de persistir', async () => {
    registerProvider({
      ...makeStubProvider('evo'),
      validateConnection: async () => ({ ok: false, detail: 'auth rejected' }),
    });
    await expect(connectionService.createConnection({
      tenantId: TENANT_A, provider: 'evo', credentials: { token: 'bad' },
    })).rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.CREDENTIALS_INVALID });
    expect(mockConnectionModel.create).not.toHaveBeenCalled();
  });

  it('rejeita provider desconhecido', async () => {
    await expect(connectionService.createConnection({ tenantId: TENANT_A, provider: 'nao-existe' }))
      .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.PROVIDER_UNKNOWN });
  });

  it('exige tenant explícito', async () => {
    await expect(connectionService.listConnections({})).rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.TENANT_REQUIRED });
  });

  it('resume corrida de unicidade devolvendo a conexão existente', async () => {
    registerProvider(makeStubProvider('evo'));
    mockConnectionModel.create.mockRejectedValueOnce(makeUniqueError());
    mockConnectionModel.findOne.mockResolvedValueOnce({ id: 'conn-existente', provider: 'evo', status: 'connected', toJSON: () => ({ id: 'conn-existente', provider: 'evo', status: 'connected' }) });

    const created = await connectionService.createConnection({ tenantId: TENANT_A, provider: 'evo' });
    expect(created.id).toBe('conn-existente');
  });

  it('resolve conexão por opaque key (roteamento seguro de webhook)', async () => {
    mockConnectionModel.findOne.mockResolvedValueOnce({ id: CONNECTION_A, tenant_key: TENANT_A, opaque_key: 'op-1' });
    const row = await connectionService.getConnectionByOpaqueKey('op-1');
    expect(mockConnectionModel.findOne).toHaveBeenCalledWith({ where: { opaque_key: 'op-1' } });
    expect(row.tenant_key).toBe(TENANT_A);

    await expect(connectionService.getConnectionByOpaqueKey('')).rejects.toMatchObject({
      code: INTEGRATION_ERROR_CODES.OPAQUE_KEY_REQUIRED,
    });
  });

  it('não expõe credencial decifrada por rota: apenas uso interno', async () => {
    mockConnectionModel.findOne.mockResolvedValueOnce({
      provider: 'evo',
      toJSON: () => ({ id: CONNECTION_A, provider: 'evo', credentials_encrypted: 'enc({"token":"t"})' }),
      update: jest.fn(),
    });
    const credentials = await connectionService.getDecryptedCredentials({ tenantId: TENANT_A, connectionId: CONNECTION_A });
    expect(credentials).toEqual({ token: 't' });
  });

  it('marca conexão com erro usando mensagem sanitizada', async () => {
    const update = jest.fn();
    mockConnectionModel.findOne.mockResolvedValueOnce({ toJSON: () => ({ id: CONNECTION_A }), update });
    await connectionService.markFailed({
      tenantId: TENANT_A,
      connectionId: CONNECTION_A,
      error: new Error('auth falhou com Bearer abcdef123456'),
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(update.mock.calls[0][0].last_error).not.toContain('abcdef123456');
  });
});

// ── Object link ─────────────────────────────────────────────────────────────

describe('integrationObjectLinkService', () => {
  const base = {
    tenantId: TENANT_A,
    provider: 'evo',
    connectionId: CONNECTION_A,
    resourceType: 'members',
    externalId: '100',
    internalType: 'MarketingLead',
    internalId: 'lead-1',
  };

  it('cria vínculo external → interno', async () => {
    mockLinkModel.findOne.mockResolvedValueOnce(null);
    mockLinkModel.create.mockImplementation(async (payload) => ({ ...payload, toJSON: () => payload }));
    const { link, created } = await linkService.linkExternal(base);
    expect(created).toBe(true);
    expect(link.internal_id).toBe('lead-1');
    expect(link.external_id).toBe('100');
  });

  it('é idempotente: reimportar o mesmo objeto devolve a mesma linha', async () => {
    const existing = {
      id: 'l1', ...base, tenant_key: TENANT_A, connection_id: CONNECTION_A, resource_type: 'members',
      internal_type: 'MarketingLead', internal_id: 'lead-1', sync_version: 1,
      update: jest.fn(async (patch) => Object.assign(existing, patch)),
      toJSON() { return { ...this, update: undefined }; },
    };
    mockLinkModel.findOne.mockResolvedValue(existing);
    const first = await linkService.linkExternal(base);
    const second = await linkService.linkExternal(base);
    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(mockLinkModel.create).not.toHaveBeenCalled();
    expect(existing.update).toHaveBeenCalledTimes(2);
  });

  it('incrementa sync_version quando o alvo interno muda', async () => {
    const existing = {
      sync_version: 3, internal_type: 'MarketingLead', internal_id: 'lead-antigo',
      update: jest.fn(async (patch) => Object.assign(existing, patch)),
      toJSON() { return { ...this, update: undefined }; },
    };
    mockLinkModel.findOne.mockResolvedValue(existing);
    await linkService.linkExternal(base);
    expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ sync_version: 4, internal_id: 'lead-1' }));
  });

  it('resolve corrida de unicidade relendo o registro', async () => {
    mockLinkModel.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'l-raced', toJSON: () => ({ id: 'l-raced' }) });
    mockLinkModel.create.mockRejectedValueOnce(makeUniqueError());
    const { link, created } = await linkService.linkExternal(base);
    expect(created).toBe(false);
    expect(link.id).toBe('l-raced');
  });

  it('isola tenants: mesmo external id em tenants diferentes', async () => {
    mockLinkModel.findOne.mockResolvedValue(null);
    mockLinkModel.create.mockImplementation(async (payload) => ({ ...payload, toJSON: () => payload }));
    await linkService.linkExternal({ ...base, tenantId: TENANT_A });
    await linkService.linkExternal({ ...base, tenantId: TENANT_B, internalId: 'lead-2' });
    const tenants = mockLinkModel.create.mock.calls.map((c) => c[0].tenant_key);
    expect(tenants).toEqual([TENANT_A, TENANT_B]);
  });

  it('exige escopo completo', async () => {
    await expect(linkService.linkExternal({ ...base, externalId: null }))
      .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION });
  });

  it('nunca aceita id externo como id interno implícito', async () => {
    await expect(linkService.linkExternal({ ...base, internalId: null }))
      .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION });
  });
});

// ── Sync state ──────────────────────────────────────────────────────────────

describe('integrationSyncStateService', () => {
  const scope = { tenantId: TENANT_A, connectionId: CONNECTION_A, resourceType: 'entries' };

  it('janela inicial é aberta', () => {
    const { since, isInitial } = syncStateService.computeWindow({ state: { watermark_at: null } });
    expect(since).toBeNull();
    expect(isInitial).toBe(true);
  });

  it('janela incremental aplica overlap sobre o watermark', () => {
    const watermark = new Date('2026-09-01T10:00:00.000Z');
    const now = new Date('2026-09-02T10:00:00.000Z');
    const { since, until, isInitial } = syncStateService.computeWindow({
      state: { watermark_at: watermark, overlap_seconds: 3600 }, now,
    });
    expect(isInitial).toBe(false);
    expect(since.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(until.toISOString()).toBe(now.toISOString());
  });

  it('cria estado idempotentemente e devolve o existente', async () => {
    mockSyncModel.findOne.mockResolvedValueOnce({ id: 's1', toJSON: () => ({ id: 's1' }) });
    const state = await syncStateService.ensureState({ ...scope, provider: 'evo' });
    expect(state.id).toBe('s1');
    expect(mockSyncModel.create).not.toHaveBeenCalled();
  });

  it('não avança o watermark em falha', async () => {
    mockSyncModel.update.mockResolvedValue([1]);
    const sanitized = await syncStateService.recordFailure({ ...scope, error: new Error('timeout') });
    expect(sanitized.code).toBeDefined();
    const payload = mockSyncModel.update.mock.calls[0][0];
    expect(payload.watermark_at).toBeUndefined();
    expect(payload.status).toBe('failed');
  });

  it('avança o watermark no sucesso e conclui initial sync', async () => {
    mockSyncModel.update.mockResolvedValue([1]);
    const watermark = new Date('2026-09-02T00:00:00.000Z');
    await syncStateService.recordSuccess({ ...scope, watermarkAt: watermark, initialSyncCompleted: true });
    const payload = mockSyncModel.update.mock.calls[0][0];
    expect(payload.watermark_at).toEqual(watermark);
    expect(payload.initial_sync_completed_at).toBeInstanceOf(Date);
  });
});

// ── Inbound events ──────────────────────────────────────────────────────────

describe('integrationInboundEventService', () => {
  const event = {
    tenantId: TENANT_A,
    connectionId: CONNECTION_A,
    provider: 'evo',
    eventType: 'entry.created',
    externalEventId: 'evt-1',
    resourceType: 'entries',
    externalResourceId: '554423',
  };

  it('deduplica reentrega do mesmo evento', async () => {
    mockEventModel.findOne.mockResolvedValueOnce({ attempts: 1, toJSON: () => ({ id: 'e1', attempts: 1 }), update: jest.fn() });
    const { duplicate } = await inboundService.recordEvent(event);
    expect(duplicate).toBe(true);
    expect(mockEventModel.create).not.toHaveBeenCalled();
  });

  it('persiste payload sanitizado (sem segredo)', async () => {
    mockEventModel.findOne.mockResolvedValueOnce(null);
    mockEventModel.create.mockImplementation(async (payload) => ({ ...payload, toJSON: () => payload }));
    await inboundService.recordEvent({
      ...event,
      payload: { idEntries: 1, Authorization: 'Basic xyz', cardNumber: '4111111111111111', safe: 'ok' },
    });
    const stored = mockEventModel.create.mock.calls[0][0];
    expect(stored.payload.safe).toBe('ok');
    expect(JSON.stringify(stored.payload)).not.toContain('4111111111111111');
    expect(stored.payload.Authorization).toBe('[REDACTED]');
  });

  it('chave de idempotência é determinística', () => {
    const a = inboundService.buildIdempotencyKey({ provider: 'evo', eventType: 'e', externalEventId: '1' });
    const b = inboundService.buildIdempotencyKey({ provider: 'evo', eventType: 'outro', externalEventId: '1' });
    expect(a).toBe(b);
    const c = inboundService.buildIdempotencyKey({ provider: 'evo', eventType: 'e', externalEventId: '2' });
    expect(c).not.toBe(a);
  });

  it('exige escopo mínimo do evento', async () => {
    await expect(inboundService.recordEvent({ ...event, provider: null }))
      .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION });
  });
});
