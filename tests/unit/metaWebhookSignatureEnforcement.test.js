'use strict';

/**
 * Regressão de segurança (auditoria 2026-08-03): POST /webhooks/instagram e
 * POST /webhooks/messenger processavam o payload SEM verificar a assinatura
 * X-Hub-Signature-256 da Meta. Qualquer chamador que conhecesse um page_id
 * válido podia injetar mensagens falsas, criar tickets e disparar fluxos.
 *
 * Comportamento correto:
 * - appSecret configurado: assinatura ausente/inválida → 401 invalid_signature
 *   e NENHUM processamento (ingestIncoming/processWhatsAppMessage não chamados);
 * - appSecret configurado + assinatura válida → 200 e processamento normal;
 * - appSecret ausente + nodeEnv production → 503 webhook_misconfigured (fail-closed);
 * - appSecret ausente + fora de produção → fail-open com warn (não quebrar dev local).
 */

const crypto = require('crypto');

jest.mock('../../api/utils/config');

const config = require('../../api/utils/config');
const { handleInstagramWebhookRoutes } = require('../../api/modules/channel-webhook/handleInstagramWebhookRoutes');
const { handleMessengerWebhookRoutes } = require('../../api/modules/channel-webhook/handleMessengerWebhookRoutes');

const IG_SECRET = 'ig-app-secret';
const MS_SECRET = 'ms-app-secret';

// jest.config.cjs usa resetMocks:true — a implementação do mock de config.get
// é definida em beforeEach, nunca na factory do jest.mock.
let configValues;

beforeEach(() => {
  configValues = { nodeEnv: 'development' };
  config.get.mockImplementation((key, defaultValue) => (
    Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : defaultValue
  ));
});

function sign(raw, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
}

function makeRes() {
  return { statusCode: null, body: null };
}

function buildDeps(overrides = {}) {
  return {
    requireAuth: () => ({ valid: true }),
    sendJson: (res, status, payload) => { res.statusCode = status; res.body = payload; },
    badRequest: (res, message) => { res.statusCode = 400; res.body = { error: 'bad_request', message }; },
    hasJsonContentType: () => true,
    parseJsonBody: async () => ({}),
    parseJsonBodyWithRaw: async () => ({ body: {}, raw: '' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    verifyInstagramWebhook: () => false,
    verifyMessengerWebhook: () => false,
    sendInstagramMessage: async () => ({ success: true }),
    sendInstagramMedia: async () => ({ success: true }),
    sendMessengerMessage: async () => ({ success: true }),
    sendMessengerButtons: async () => ({ success: true }),
    processWhatsAppMessage: jest.fn(async () => {}),
    channelNormalizationService: { normalizeInstagramIncoming: () => [{}] },
    channelGatewayService: { ingestIncoming: jest.fn(async () => ({ tenantId: 'tenant-1', persist: {} })) },
    resolveOrCreateTicketFromIncomingMessage: jest.fn(async () => ({ ticket: null })),
    appendTicketMessage: jest.fn(),
    autoAssignTicket: jest.fn(async () => {}),
    emitEvent: jest.fn(),
    flows: {},
    sessionEvents: {},
    sessionTenants: {},
    saveSessionEventsToFile: jest.fn(),
    ...overrides,
  };
}

function ctxFor({ pathname, body, raw, headers = {}, depOverrides = {} }) {
  const deps = buildDeps(depOverrides);
  deps.parseJsonBodyWithRaw = async () => ({ body, raw });
  return {
    req: { headers, url: pathname },
    res: makeRes(),
    method: 'POST',
    pathname,
    deps,
  };
}

const IG_BODY = {
  object: 'instagram',
  entry: [{
    id: 'page-1',
    messaging: [{ sender: { id: 'user-1' }, message: { mid: 'mid-1', text: 'ola' }, timestamp: 1700000000000 }],
  }],
};

const MS_BODY = {
  object: 'page',
  entry: [{
    id: 'page-1',
    messaging: [{ sender: { id: 'user-1' }, message: { mid: 'mid-1', text: 'ola' }, timestamp: 1700000000000 }],
  }],
};

const CHANNELS = [
  {
    name: 'instagram',
    pathname: '/webhooks/instagram',
    handler: handleInstagramWebhookRoutes,
    secretKey: 'instagram.appSecret',
    secret: IG_SECRET,
    body: IG_BODY,
  },
  {
    name: 'messenger',
    pathname: '/webhooks/messenger',
    handler: handleMessengerWebhookRoutes,
    secretKey: 'messenger.appSecret',
    secret: MS_SECRET,
    body: MS_BODY,
  },
];

describe.each(CHANNELS)('POST $pathname — enforcement de X-Hub-Signature-256', (channel) => {
  const raw = JSON.stringify(channel.body);

  test('secret configurado + header ausente → 401 e NENHUM processamento', async () => {
    configValues[channel.secretKey] = channel.secret;
    const ctx = ctxFor({ pathname: channel.pathname, body: channel.body, raw });

    const handled = await channel.handler(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body.error).toBe('invalid_signature');
    expect(ctx.deps.channelGatewayService.ingestIncoming).not.toHaveBeenCalled();
    expect(ctx.deps.processWhatsAppMessage).not.toHaveBeenCalled();
  });

  test('secret configurado + assinatura errada → 401 e NENHUM processamento', async () => {
    configValues[channel.secretKey] = channel.secret;
    const ctx = ctxFor({
      pathname: channel.pathname,
      body: channel.body,
      raw,
      headers: { 'x-hub-signature-256': sign(raw, 'secret-errado') },
    });

    const handled = await channel.handler(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body.error).toBe('invalid_signature');
    expect(ctx.deps.channelGatewayService.ingestIncoming).not.toHaveBeenCalled();
    expect(ctx.deps.processWhatsAppMessage).not.toHaveBeenCalled();
  });

  test('secret configurado + assinatura correta → 200 e processamento ocorre', async () => {
    configValues[channel.secretKey] = channel.secret;
    const ctx = ctxFor({
      pathname: channel.pathname,
      body: channel.body,
      raw,
      headers: { 'x-hub-signature-256': sign(raw, channel.secret) },
    });

    const handled = await channel.handler(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(200);
    expect(ctx.res.body).toEqual({ success: true });
    expect(ctx.deps.channelGatewayService.ingestIncoming).toHaveBeenCalledTimes(1);
    expect(ctx.deps.processWhatsAppMessage).toHaveBeenCalledTimes(1);
  });

  test('secret ausente + nodeEnv production → 503 webhook_misconfigured (fail-closed)', async () => {
    configValues.nodeEnv = 'production';
    const ctx = ctxFor({
      pathname: channel.pathname,
      body: channel.body,
      raw,
      headers: { 'x-hub-signature-256': sign(raw, channel.secret) },
    });

    const handled = await channel.handler(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(503);
    expect(ctx.res.body.error).toBe('webhook_misconfigured');
    expect(ctx.deps.channelGatewayService.ingestIncoming).not.toHaveBeenCalled();
    expect(ctx.deps.processWhatsAppMessage).not.toHaveBeenCalled();
  });

  test('secret ausente + fora de produção → fail-open, processamento ocorre', async () => {
    configValues.nodeEnv = 'development';
    const ctx = ctxFor({ pathname: channel.pathname, body: channel.body, raw });

    const handled = await channel.handler(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(200);
    expect(ctx.deps.processWhatsAppMessage).toHaveBeenCalledTimes(1);
  });
});
