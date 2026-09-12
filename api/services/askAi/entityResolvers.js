'use strict';

/**
 * Resolução de posse da entidade do contexto do copiloto ("Perguntar à IA").
 *
 * O contexto enviado pela tela é uma DICA, nunca autoridade: aqui revalidamos,
 * no backend, que a entidade pertence ao tenant de quem pergunta. Um id de
 * outro tenant é indistinguível de um inexistente — nenhum dado é consultado e
 * nenhuma existência é revelada.
 *
 * ── Gap corrigido (2026-09-12, achado exercitando o browser como usuário) ────
 * O verificador anterior recebia o `subjectId` que a ficha do aluno publica e
 * consultava `getMembershipDetail({ membershipId: subjectId })` — identificador
 * errado, então a entidade NUNCA era reconhecida e o copiloto negava todo
 * dado vivo. `CUSTOMER` caía no mesmo lookup de membership, agravando o erro.
 *
 * Contrato: cada tipo verificável declara explicitamente QUAL consulta
 * tenant-scoped prova posse. Tipos sem mecanismo de verificação permanecem
 * fail-closed (o contexto é descartado) — nunca aceitos por confiança.
 */

const logger = require('../../utils/logger');

const RESOLVER_REASONS = Object.freeze({
  VALIDATION_FAILED: 'entity_validation_failed',
  NOT_ACCESSIBLE: 'entity_not_accessible',
  NOT_VERIFIABLE: 'entity_ownership_not_verifiable',
});

/**
 * Tipos com prova de posse implementada. A ordem não importa; a lista é a
 * fonte única para relatório e teste.
 */
const VERIFIABLE_ENTITY_TYPES = Object.freeze([
  'FITNESS_STUDENT',
  'CUSTOMER',
  'CONVERSATION',
  'ORDER',
  'BOOKING',
]);

/**
 * Aluno de fitness: a posse é provada pela membership do tenant para aquele
 * `subject_id` (o mesmo identificador que a tela publica).
 */
async function resolveFitnessStudent({ tenantId, entityId }) {
  const membershipService = require('../vertical/fitnessMembershipService');
  const status = await membershipService.getMembershipAccessStatus({ tenantId, subjectId: entityId });
  return Boolean(status && status.membership);
}

/**
 * Entidade do Workspace/Clientes 360 (contato unificado do tenant).
 */
async function resolveCustomer({ tenantId, entityId }) {
  const WorkspaceEntityService = require('../workspace/WorkspaceEntityService');
  const service = new WorkspaceEntityService();
  const entity = await service.getEntity({ tenantId, entityId });
  return Boolean(entity);
}

/**
 * Conversa de canal (Inbox). A conversa é sempre do tenant que pergunta.
 */
async function resolveConversation({ tenantId, entityId }) {
  const channelConversationService = require('../channelConversationService');
  const conversation = await channelConversationService.getConversation({
    tenantId,
    conversationId: entityId,
  });
  return Boolean(conversation);
}

/**
 * Pedido (comércio/varejo/vertical food/market).
 */
async function resolveOrder({ tenantId, entityId }) {
  const orderService = require('../orderService');
  const order = await orderService.getOrderById({ tenantId, orderId: entityId });
  return Boolean(order);
}

/**
 * Agendamento (beleza/clínica/serviços).
 */
async function resolveBooking({ tenantId, entityId }) {
  const scheduleService = require('../scheduleService');
  const schedule = scheduleService.getSchedule({ tenantId, scheduleId: entityId });
  return Boolean(schedule);
}

const RESOLVERS = Object.freeze({
  FITNESS_STUDENT: resolveFitnessStudent,
  CUSTOMER: resolveCustomer,
  CONVERSATION: resolveConversation,
  ORDER: resolveOrder,
  BOOKING: resolveBooking,
});

/**
 * Prova de posse da entidade informada pela tela.
 *
 * @param {{entityType?: string|null, entityId?: string|null, tenantId: string}} params
 * @returns {Promise<{verifiable: boolean, owned: boolean, reason: string|null}>}
 */
async function resolveEntityOwnership({ entityType, entityId, tenantId } = {}) {
  if (!entityType || !entityId) {
    return { verifiable: false, owned: false, reason: RESOLVER_REASONS.NOT_VERIFIABLE };
  }
  if (!tenantId) {
    return { verifiable: false, owned: false, reason: RESOLVER_REASONS.NOT_VERIFIABLE };
  }

  const resolver = RESOLVERS[String(entityType)];
  if (!resolver) {
    // Sem mecanismo de verificação para este tipo: descarta o contexto em vez
    // de aceitá-lo por confiança (fail-closed).
    return { verifiable: false, owned: false, reason: RESOLVER_REASONS.NOT_VERIFIABLE };
  }

  try {
    const found = await resolver({ tenantId, entityId: String(entityId) });
    if (!found) {
      return { verifiable: true, owned: false, reason: RESOLVER_REASONS.NOT_ACCESSIBLE };
    }
    return { verifiable: true, owned: true, reason: null };
  } catch (error) {
    logger.warn('[ask-ai] Falha ao validar posse da entidade do contexto', {
      tenantId,
      entityType: String(entityType),
      error: error?.message,
    });
    return { verifiable: true, owned: false, reason: RESOLVER_REASONS.VALIDATION_FAILED };
  }
}

module.exports = {
  RESOLVER_REASONS,
  VERIFIABLE_ENTITY_TYPES,
  resolveEntityOwnership,
};
