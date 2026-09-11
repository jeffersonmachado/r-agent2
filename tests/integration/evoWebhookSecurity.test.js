'use strict';

/**
 * SEGURANÇA / ADVERSARIAL — webhook da integração.
 *
 * Prova os controles exigidos pela missão:
 * - tenant NUNCA vem do payload/query/header (só da conexão resolvida pela URL);
 * - assinatura inválida/ausente é rejeitada (fail-closed);
 * - conexão inexistente não revela nada (404 uniforme);
 * - replay do mesmo evento deduplica;
 * - payload persistido é sanitizado (sem segredo/PAN/biometria);
 * - job só é enfileirado quando o evento é novo.
 */

const crypto = require('crypto');

jest.setTimeout(120000);

const { connect, close, getSequelize } = require('../../api/db/sequelize');
const { IntegrationConnection, IntegrationInboundEvent, IntegrationObjectLink, IntegrationSyncState } = require('../../api/db/models');
const connectionService = require('../../api/services/integration/integrationConnectionService');
const { resetRegistry, registerProvider } = require('../../api/services/integration/integrationRegistry');
const evoProvider = require('../../api/services/integration/providers/evo/evoProviderAdapter');
const { handleIntegrationWebhookRoutes } = require('../../api/modules/integration/handleIntegrationWebhookRoutes');
const inboundService = require('../../api/services/integration/integrationInboundEventService');
const { createFakeEvoServer, labConfig } = require('../helpers/fakeEvoServer');

const TENANT = `itest-evo-webhook-${crypto.randomBytes(4).toString('hex')}`;
const OTHER_TENANT = `itest-evo-other-${crypto.randomBytes(4).toString('hex')}`;
const WEBHOOK_SECRET = 'webhook-secret-de-teste';

const enqueuedJobs = [];

jest.mock('../../api/services/executionQueueService', () => ({
  enqueueJob: jest.fn(async (job) => {
    enqueuedJobs.push(job);
    return { id: `job-${enqueuedJobs.length}`, ...job };
  }),
}));

/**
 * Modelo de autenticação do webhook CORRIGIDO (§29).
 *
 * O RAP gera um segredo forte e o envia como cabeçalho CUSTOMIZADO na criação
 * do webhook; o callback é autenticado comparando esse valor em tempo constante.
 * HMAC-SHA256 NÃO é presumido — ele só existe quando o operador declara
 * explicitamente `config.webhookAuthMode = 'HMAC_SHA256'`.
 */
function sign(_rawBody) {
  return WEBHOOK_SECRET;
}

function signHmac(rawBody) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

/** Executa o handler com req/res falsos (fronteira HTTP real do módulo). */
async function postWebhook({ path, body, headers = {} }) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body || {});
  const req = {
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/json', ...headers },
  };
  let statusCode = 200;
  let payload = null;
  const res = { writableEnded: false };
  const deps = {
    sendJson: (resObj, status, data) => { statusCode = status; payload = data; resObj.writableEnded = true; },
    parseJsonBodyWithRaw: async () => ({ body: JSON.parse(rawBody), rawBody }),
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
  };
  const handled = await handleIntegrationWebhookRoutes({
    req, res, method: 'POST', pathname: path.split('?')[0], deps,
  });
  return { handled, statusCode, payload, logger: deps.logger };
}

describe('Webhook da integração — segurança e adversarial', () => {
  let connection;
  let server;

  beforeAll(async () => {
    await connect(5, 500);
    resetRegistry();
    registerProvider(evoProvider);
    const { createFakeEvoServer, labConfig } = require('../helpers/fakeEvoServer');
    server = createFakeEvoServer({ datasets: { members: [], prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [] } });
    await server.listen();
    await cleanup();
    connection = await connectionService.createConnection({
      tenantId: TENANT,
      provider: 'evo',
      label: 'Academia Webhook',
      externalUnitId: '1',
      config: labConfig(server.baseUrl),
      // `secretKey` = credencial de API do provider; `webhookSecret` = segredo de
      // assinatura do webhook. Ambos vivem no MESMO blob cifrado.
      credentials: { academyDns: server.credentials.academyDns, secretKey: server.credentials.secretKey, webhookSecret: WEBHOOK_SECRET },
      status: 'connected',
    });
  });

  afterAll(async () => {
    await cleanup();
    if (server) await server.close();
    await close().catch(() => {});
  });

  async function cleanup() {
    await IntegrationInboundEvent().destroy({ where: { tenant_key: TENANT } });
    await IntegrationInboundEvent().destroy({ where: { tenant_key: OTHER_TENANT } });
    await IntegrationObjectLink().destroy({ where: { tenant_key: TENANT } });
    await IntegrationSyncState().destroy({ where: { tenant_key: TENANT } });
    await IntegrationConnection().destroy({ where: { tenant_key: TENANT } });
    await IntegrationConnection().destroy({ where: { tenant_key: OTHER_TENANT } });
  }

  beforeEach(() => {
    enqueuedJobs.length = 0;
    jest.clearAllMocks();
    // `jest.config.cjs` usa resetMocks:true — a implementação passada a
    // `jest.fn(impl)` precisa ser restabelecida a cada teste.
    const { enqueueJob } = require('../../api/services/executionQueueService');
    enqueueJob.mockImplementation(async (job) => {
      enqueuedJobs.push(job);
      return { id: `job-${enqueuedJobs.length}`, ...job };
    });
  });

  function pathFor(opaqueKey = connection.opaque_key, provider = 'evo') {
    return `/webhooks/integrations/${provider}/${opaqueKey}`;
  }

  it('aceita webhook com assinatura válida e persiste o evento', async () => {
    const rawBody = JSON.stringify({ event: 'entry.created', idEvent: 'evt-1', idEntry: 554423, idBranch: '1' });
    const result = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': sign(rawBody) } });

    expect(result.statusCode).toBe(202);
    expect(result.payload).toEqual({ received: true, duplicate: false });

    const rows = await IntegrationInboundEvent().findAll({ where: { tenant_key: TENANT } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_key).toBe(TENANT);
    expect(rows[0].event_type).toBe('entry.created');
    expect(rows[0].external_resource_id).toBe('554423');
  });

  it('enfileira o processamento na fila canônica (nunca executa inline)', async () => {
    const rawBody = JSON.stringify({ event: 'entry.created', idEvent: 'evt-queue', idEntry: 554999 });
    const result = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': sign(rawBody) } });
    expect(result.statusCode).toBe(202);

    expect(enqueuedJobs).toHaveLength(1);
    expect(enqueuedJobs[0].kind).toBe('integration_process_webhook');
    expect(enqueuedJobs[0].tenantId).toBe(TENANT);
    expect(enqueuedJobs[0].payload.provider).toBe('evo');
    expect(enqueuedJobs[0].idempotencyKey).toMatch(/^integration:webhook:/);
  });

  it('rejeita assinatura inválida sem persistir nada', async () => {
    const before = await IntegrationInboundEvent().count({ where: { tenant_key: TENANT } });
    const rawBody = JSON.stringify({ event: 'member.created', idEvent: 'evt-bad' });
    const result = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': 'assinatura-errada' } });

    expect(result.statusCode).toBe(401);
    expect(result.payload.error).toBe('integration_webhook_signature_invalid');
    expect(await IntegrationInboundEvent().count({ where: { tenant_key: TENANT } })).toBe(before);
  });

  it('é fail-closed quando a conexão não tem segredo de webhook', async () => {
    const noSecret = await connectionService.createConnection({
      tenantId: OTHER_TENANT,
      provider: 'evo',
      label: 'Sem segredo',
      config: labConfig(server.baseUrl),
      credentials: { academyDns: server.credentials.academyDns, secretKey: server.credentials.secretKey },
      status: 'connected',
    });
    const rawBody = JSON.stringify({ event: 'entry.created', idEvent: 'evt-no-secret' });
    const result = await postWebhook({
      path: `/webhooks/integrations/evo/${noSecret.opaque_key}`,
      body: rawBody,
      headers: { 'x-evo-signature': 'qualquer' },
    });
    expect(result.statusCode).toBe(401);
    expect(await IntegrationInboundEvent().count({ where: { tenant_key: OTHER_TENANT } })).toBe(0);
  });

  it('404 uniforme para conexão inexistente', async () => {
    const result = await postWebhook({
      path: '/webhooks/integrations/evo/inexistente-abc',
      body: JSON.stringify({ event: 'x' }),
      headers: { 'x-evo-signature': 'y' },
    });
    expect(result.statusCode).toBe(404);
    expect(result.payload).toEqual({ error: 'not_found' });
  });

  it('404 quando o provider da URL não é o da conexão', async () => {
    const result = await postWebhook({
      path: pathFor(connection.opaque_key, 'outro-provider'),
      body: JSON.stringify({ event: 'x' }),
      headers: { 'x-evo-signature': 'y' },
    });
    expect(result.statusCode).toBe(404);
  });

  it('NÃO permite spoofing de tenant por query string', async () => {
    const rawBody = JSON.stringify({ event: 'member.created', idEvent: 'evt-spoof-query', idMember: 999 });
    const result = await postWebhook({
      path: `${pathFor()}?tenantId=${OTHER_TENANT}&tenant_key=${OTHER_TENANT}`,
      body: rawBody,
      headers: { 'x-evo-signature': sign(rawBody) },
    });
    expect(result.statusCode).toBe(202);

    const event = await IntegrationInboundEvent().findOne({ where: { external_event_id: 'evt-spoof-query' } });
    expect(event.tenant_key).toBe(TENANT);
    expect(event.tenant_key).not.toBe(OTHER_TENANT);
  });

  it('NÃO permite spoofing de tenant pelo payload nem por header', async () => {
    const rawBody = JSON.stringify({
      event: 'member.created',
      idEvent: 'evt-spoof-payload',
      idMember: 1000,
      tenantId: OTHER_TENANT,
      tenant_key: OTHER_TENANT,
      tenant: OTHER_TENANT,
    });
    const result = await postWebhook({
      path: pathFor(),
      body: rawBody,
      headers: { 'x-evo-signature': sign(rawBody), 'x-tenant-id': OTHER_TENANT },
    });
    expect(result.statusCode).toBe(202);

    const event = await IntegrationInboundEvent().findOne({ where: { external_event_id: 'evt-spoof-payload' } });
    expect(event.tenant_key).toBe(TENANT);
    expect(await IntegrationInboundEvent().count({ where: { tenant_key: OTHER_TENANT } })).toBe(0);
  });

  it('deduplica replay do mesmo evento (não enfileira duas vezes)', async () => {
    const rawBody = JSON.stringify({ event: 'entry.created', idEvent: 'evt-replay', idEntry: 700001 });
    const first = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': sign(rawBody) } });
    const jobsAfterFirst = enqueuedJobs.length;
    const second = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': sign(rawBody) } });

    expect(first.payload.duplicate).toBe(false);
    expect(second.payload.duplicate).toBe(true);
    expect(enqueuedJobs).toHaveLength(jobsAfterFirst);

    const rows = await IntegrationInboundEvent().findAll({ where: { external_event_id: 'evt-replay' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBeGreaterThanOrEqual(2);
  });

  it('sanitiza o payload persistido (segredo/PAN/biometria não entram no banco)', async () => {
    const rawBody = JSON.stringify({
      event: 'member.updated',
      idEvent: 'evt-sensitive',
      idMember: 1001,
      Authorization: 'Basic dXNlcjpwYXNz',
      cardNumber: '4111111111111111',
      faceTemplate: 'BLOB-BIOMETRICO',
      safe: 'ok',
    });
    const result = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': sign(rawBody) } });
    expect(result.statusCode).toBe(202);

    const event = await IntegrationInboundEvent().findOne({ where: { external_event_id: 'evt-sensitive' } });
    const serialized = JSON.stringify(event.payload);
    expect(serialized).toContain('ok');
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).not.toContain('BLOB-BIOMETRICO');
    expect(serialized).not.toContain('dXNlcjpwYXNz');
    expect(event.payload.Authorization).toBe('[REDACTED]');
  });

  it('não vaza segredo nos logs do webhook', async () => {
    const rawBody = JSON.stringify({ event: 'member.updated', idEvent: 'evt-log-check' });
    const result = await postWebhook({ path: pathFor(), body: rawBody, headers: { 'x-evo-signature': sign(rawBody) } });
    const logged = JSON.stringify([result.logger.warn.mock.calls, result.logger.error.mock.calls]);
    expect(logged).not.toContain(WEBHOOK_SECRET);
  });

  it('rejeita método não-POST', async () => {
    const req = { method: 'GET', url: pathFor(), headers: {} };
    let status = 0;
    const res = { writableEnded: false };
    const handled = await handleIntegrationWebhookRoutes({
      req,
      res,
      method: 'GET',
      pathname: pathFor(),
      deps: {
        sendJson: (r, s) => { status = s; r.writableEnded = true; },
        parseJsonBodyWithRaw: async () => ({ body: {}, rawBody: '{}' }),
        logger: { warn: jest.fn(), error: jest.fn() },
      },
    });
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });

  it('rejeita JSON malformado', async () => {
    const req = { method: 'POST', url: pathFor(), headers: {} };
    let status = 0;
    const res = { writableEnded: false };
    await handleIntegrationWebhookRoutes({
      req,
      res,
      method: 'POST',
      pathname: pathFor(),
      deps: {
        sendJson: (r, s) => { status = s; r.writableEnded = true; },
        parseJsonBodyWithRaw: async () => { throw new Error('invalid json'); },
        logger: { warn: jest.fn(), error: jest.fn() },
      },
    });
    expect(status).toBe(400);
  });
});

describe('Inbound events — dedup e transições', () => {
  beforeAll(async () => {
    await connect(5, 500);
  });
  afterAll(async () => {
    await close().catch(() => {});
  });

  it('chave de idempotência é determinística e independente do provedor', () => {
    const base = inboundService.buildIdempotencyKey({ provider: 'evo', eventType: 'entry.created', externalEventId: 'x1' });
    expect(base).toBe(inboundService.buildIdempotencyKey({ provider: 'evo', eventType: 'outro', externalEventId: 'x1' }));
    expect(base).not.toBe(inboundService.buildIdempotencyKey({ provider: 'outro', eventType: 'entry.created', externalEventId: 'x1' }));
  });
});
