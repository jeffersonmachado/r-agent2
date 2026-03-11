'use strict';

async function validateWhatsAppConnectionBotPayload({ tenantId, body = {}, flows }) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 422, error: 'invalid_payload', message: 'Payload inválido' };
  }

  if (typeof body.botEnabled !== 'boolean') {
    return { ok: false, status: 422, error: 'invalid_payload', message: 'Campo botEnabled é obrigatório e deve ser boolean' };
  }

  if (body.botEnabled !== true) {
    return { ok: true, normalized: { ...body, botEnabled: false, botFlowId: null } };
  }

  const { checkFeature } = require('../../services/planLimitsService');
  const featureCheck = await checkFeature(tenantId, 'whatsapp_bot');
  if (!featureCheck.allowed) {
    return {
      ok: false,
      status: 403,
      error: 'feature_not_allowed',
      message: 'Seu plano não suporta bot no WhatsApp',
    };
  }

  const botFlowId = body.botFlowId != null ? String(body.botFlowId).trim() : '';
  if (!botFlowId) {
    return { ok: false, status: 422, error: 'invalid_flow', message: 'Flow inválido para esta conexão' };
  }

  const flow = flows.get(botFlowId);
  if (!flow || String(flow?.tenantId || '') !== String(tenantId)) {
    return { ok: false, status: 422, error: 'invalid_flow', message: 'Flow inválido para esta conexão' };
  }

  return { ok: true, normalized: { ...body, botEnabled: true, botFlowId } };
}

async function emitWhatsappIvrUpdated(tenantId, out) {
  try {
    const WebSocketService = require('../../services/websocketService');
    WebSocketService.emitEvent('whatsapp.ivr.updated', out, { tenantId });
  } catch (_) {}
}

module.exports = {
  validateWhatsAppConnectionBotPayload,
  emitWhatsappIvrUpdated,
};
