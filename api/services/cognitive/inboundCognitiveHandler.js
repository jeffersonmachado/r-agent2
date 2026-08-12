'use strict';

/**
 * Inbound Cognitive Handler — integração gradual do Cognitive Core ao fluxo
 * operacional real (messageProcessor).
 *
 * O Cognitive Core decide/coordena; o canal envia APENAS outcome de negócio
 * ("Agendamento realizado"), nunca internals ("MCP tool executada").
 *
 * O principal é um service principal declarado e restrito — sem wildcard.
 * As permissões do canal são lidas de configuração segura
 * (cognitive.channelPermissions), com default fail-closed.
 */

const logger = require('../../utils/logger');
const { buildServicePrincipal } = require('../../../src/core/cognitive/principal');

/** Frases de outcome de negócio por intent — nunca termos de infraestrutura. */
const BUSINESS_OUTCOME_MESSAGES = Object.freeze({
  criar_lead: 'Cadastro realizado com sucesso.',
  qualificar_lead: 'Cadastro atualizado com sucesso.',
  agendar: 'Agendamento realizado.',
  remarcar_agendamento: 'Agendamento remarcado.',
  cancelar_agendamento: 'Agendamento cancelado.',
  abrir_ticket: 'Atendimento iniciado. Nossa equipe já está cuidando do seu caso.',
  enviar_proposta: 'Proposta enviada.',
  iniciar_campanha: 'Campanha iniciada.',
});

const CONFIRMATION_MESSAGE = 'Antes de confirmar, preciso da sua autorização. Podemos prosseguir?';
const HANDOFF_MESSAGE = 'Vou transferir você para um atendente humano. Um momento, por favor.';
const FAILURE_MESSAGE = 'Não consegui concluir sua solicitação agora. Nossa equipe foi acionada.';

/**
 * Permissões do service principal do canal — declaradas em configuração
 * (auditável), nunca wildcard. Default restritivo: somente leituras e
 * transferência; side effects exigem declaração explícita.
 */
function resolveChannelPermissions(configGet) {
  const configured = configGet ? configGet('cognitive.channelPermissions') : null;
  if (Array.isArray(configured) && configured.length > 0) {
    if (configured.includes('*')) {
      throw new Error('configuration_missing: cognitive.channelPermissions não pode conter wildcard');
    }
    return configured;
  }
  return ['crm.read', 'agenda.read', 'knowledge.read', 'conversation.transfer'];
}

/** Mapeia o resultado cognitivo para a mensagem de negócio do canal. */
function toBusinessMessage(result) {
  if (!result) return FAILURE_MESSAGE;

  // P0: Handoff humano — sempre prioritário.
  if (result.humanHandoff) return HANDOFF_MESSAGE;

  // P0: Confirmação pendente.
  if (result.requiresConfirmation) return CONFIRMATION_MESSAGE;

  // P0: Falha explícita, cannot_complete, authorization_required, etc.
  if (result.status === 'failed' || result.status === 'cannot_complete' || result.status === 'halted_awaiting_confirmation') {
    return FAILURE_MESSAGE;
  }

  // P0: Outcome validation — a mensagem de sucesso exige businessOutcome válido.
  // NUNCA declarar "Agendamento realizado" se businessOutcome é outcome_not_achieved.
  if (result.status === 'completed' || result.status === 'completed_with_validation_warnings') {
    if (result.businessOutcome && result.businessOutcome !== 'outcome_not_achieved') {
      return BUSINESS_OUTCOME_MESSAGES[result.intent] || 'Solicitação concluída.';
    }
    // P0: outcome_not_achieved mesmo com status completed → failure.
    if (result.businessOutcome === 'outcome_not_achieved') {
      return FAILURE_MESSAGE;
    }
    // Sem businessOutcome (intents sem outcome contract): aceita completed.
    return BUSINESS_OUTCOME_MESSAGES[result.intent] || 'Solicitação concluída.';
  }

  return FAILURE_MESSAGE;
}

/**
 * Processa mensagem inbound via Cognitive Core.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.channel
 * @param {string} args.message
 * @param {string} [args.conversationId]
 * @param {string} [args.correlationId]  ex.: messageId do canal
 * @param {object} [args.payload]
 * @param {function} args.sendText      (text) => Promise — envio no canal
 * @param {function} [args.configGet]   leitura de configuração do tenant
 * @param {object} [args.orchestrator]  injetável em testes
 * @returns {Promise<{path: string, result: object}>}
 */
async function handleInboundWithCognitiveCore({
  tenantId,
  channel,
  message,
  conversationId = null,
  correlationId = null,
  payload = {},
  sendText,
  configGet = null,
  orchestrator = null,
}) {
  const orch = orchestrator || require('../../../src/core/cognitive').getCognitiveOrchestrator();

  const principal = buildServicePrincipal({
    serviceId: `cognitive-entry:${channel}`,
    tenantId,
    permissions: resolveChannelPermissions(configGet),
    channel,
    sessionId: conversationId,
    correlationId,
  });

  const result = await orch.process({
    tenantId,
    channel,
    message,
    payload: { ...payload, conversationId, correlationId },
    actor: principal,
    correlationId,
  });

  const text = toBusinessMessage(result);
  if (typeof sendText === 'function' && text) {
    await sendText(text);
  }

  logger.info('[InboundCognitive] Processed via Cognitive Core', {
    tenantId,
    channel,
    executionId: result.executionId,
    intent: result.intent,
    status: result.status,
    correlationId,
  });

  return { path: payload.durable ? 'DURABLE_PROCESS' : 'COGNITIVE', result };
}

module.exports = {
  handleInboundWithCognitiveCore,
  toBusinessMessage,
  resolveChannelPermissions,
  BUSINESS_OUTCOME_MESSAGES,
};
