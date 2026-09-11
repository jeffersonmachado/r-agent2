'use strict';

/**
 * Webhook de entrada da camada de integração (R-Bridge).
 *
 * ROTA PÚBLICA (sem auth) — o roteamento de tenant é resolvido SERVER-SIDE pela
 * identidade opaca da conexão presente na URL:
 *
 *   POST /webhooks/integrations/:provider/:opaqueConnectionKey
 *
 * Regras de segurança (missão §15):
 * - o tenant NUNCA é aceito do payload, da query string ou de header;
 * - conexão inexistente/inativa → 404 genérico (não revela existência);
 * - assinatura HMAC verificada; sem segredo configurado é FAIL-CLOSED (401);
 * - evento persistido e DEDUPLICADO antes de responder;
 * - webhook é tratado como SINAL: o processamento busca o estado canônico no
 *   provedor (nunca assume payload completo);
 * - payload sanitizado (sem Authorization/PAN/biometria).
 */

const crypto = require('crypto');
const connectionService = require('../../services/integration/integrationConnectionService');
const inboundService = require('../../services/integration/integrationInboundEventService');
const { getProvider } = require('../../services/integration/integrationRegistry');
const { sanitizeError, redactDeep } = require('../../services/integration/integrationRedaction');

const PATH_PATTERN = /^\/webhooks\/integrations\/([^/]+)\/([^/]+)$/;

/** 404 uniforme: nunca diferencia "não existe" de "existe mas inativo". */
function respondNotFound(sendJson, res) {
  sendJson(res, 404, { error: 'not_found' });
}

async function handleIntegrationWebhookRoutes({ req, res, method, pathname, deps }) {
  const { sendJson, parseJsonBodyWithRaw, logger } = deps;

  const match = PATH_PATTERN.exec(pathname);
  if (!match) return false;
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  }

  const providerId = decodeURIComponent(match[1]).toLowerCase();
  const opaqueKey = decodeURIComponent(match[2]);

  let connectionRow;
  try {
    connectionRow = await connectionService.getConnectionByOpaqueKey(opaqueKey);
  } catch (error) {
    respondNotFound(sendJson, res);
    return true;
  }
  if (!connectionRow || String(connectionRow.provider).toLowerCase() !== providerId) {
    respondNotFound(sendJson, res);
    return true;
  }
  if (String(connectionRow.status) === 'disconnected') {
    respondNotFound(sendJson, res);
    return true;
  }

  let adapter;
  try {
    adapter = getProvider(providerId);
  } catch (_) {
    respondNotFound(sendJson, res);
    return true;
  }

  let body;
  let rawBody;
  try {
    const parsed = await parseJsonBodyWithRaw(req);
    body = parsed && parsed.body !== undefined ? parsed.body : parsed;
    rawBody = parsed && parsed.rawBody !== undefined ? parsed.rawBody : (typeof body === 'string' ? body : JSON.stringify(body || {}));
  } catch (_) {
    sendJson(res, 400, { error: 'invalid_json' });
    return true;
  }

  // Credenciais (inclui o segredo de webhook) são lidas server-side e nunca
  // saem daqui.
  let credentials = {};
  try {
    credentials = await connectionService.getDecryptedCredentials({
      tenantId: connectionRow.tenant_key,
      connectionId: connectionRow.id,
    });
  } catch (_) {
    credentials = {};
  }

  let signature;
  try {
    signature = adapter.verifyWebhookSignature({
      connection: connectionRow,
      credentials,
      headers: req.headers || {},
      rawBody,
    });
  } catch (error) {
    logger.warn('[Integration] falha ao verificar assinatura do webhook', redactDeep(sanitizeError(error)));
    signature = { ok: false, reason: 'signature_verification_error' };
  }
  if (!signature || signature.ok !== true) {
    sendJson(res, 401, { error: 'integration_webhook_signature_invalid', reason: signature && signature.reason ? signature.reason : 'invalid' });
    return true;
  }

  let normalized;
  try {
    normalized = adapter.normalizeWebhook({ connection: connectionRow, headers: req.headers || {}, rawBody, parsedBody: body });
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_webhook_payload', detail: sanitizeError(error).code });
    return true;
  }

  let recorded;
  try {
    recorded = await inboundService.recordEvent({
      tenantId: connectionRow.tenant_key,
      connectionId: connectionRow.id,
      provider: providerId,
      eventType: normalized.eventType,
      externalEventId: normalized.externalEventId,
      resourceType: normalized.resourceType,
      externalResourceId: normalized.externalResourceId,
      payload: normalized.payload,
      receivedAt: new Date(),
      metadata: {
        opaqueKeyFingerprint: crypto.createHash('sha256').update(String(opaqueKey)).digest('hex').slice(0, 16),
        unitIdHint: normalized.unitIdHint || null,
      },
    });
  } catch (error) {
    logger.error('[Integration] falha ao persistir evento de webhook', redactDeep(sanitizeError(error)));
    sendJson(res, 500, { error: 'integration_event_persist_failed' });
    return true;
  }

  if (!recorded.duplicate) {
    try {
      const { enqueueJob } = require('../../services/executionQueueService');
      await enqueueJob({
        tenantId: connectionRow.tenant_key,
        kind: 'integration_process_webhook',
        payload: { eventId: recorded.event.id, connectionId: connectionRow.id, provider: providerId },
        idempotencyKey: `integration:webhook:${recorded.event.id}`,
      });
      await inboundService.markQueued({ eventId: recorded.event.id, tenantId: connectionRow.tenant_key });
    } catch (error) {
      logger.warn('[Integration] falha ao enfileirar processamento de webhook', redactDeep(sanitizeError(error)));
    }
  }

  // Resposta mínima: não confirma estado, apenas o recebimento.
  sendJson(res, 202, { received: true, duplicate: Boolean(recorded.duplicate) });
  return true;
}

module.exports = { handleIntegrationWebhookRoutes, PATH_PATTERN };
