'use strict';

/**
 * supportOperationalSeed.js
 *
 * Seed operacional para support_ticket_flow.
 * Antes da execução:
 *   - cria ticket real (nasce 'waiting' na fila)
 *   - cria conversa real
 *   - cria contato/CRM real
 *   - registra estado inicial completo
 *   - expõe ticketId / conversationId / contactId ao snapshot
 *
 * O takeover/assign (waiting → in_progress) é executado pelo step canônico
 * step_takeover_ticket no browser — nunca aqui, para preservar a prova de
 * mutação incremental do step.
 *
 * Depois da execução valida:
 *   - resposta criada (mensagem incrementada)
 *   - status alterado
 *   - audit log criado
 *
 * Nota de contrato (2026-07-24): a exigência `crm_updated`/`crm.activities.count`
 * foi removida por evidência: esse contador é medido em `VerticalJourneyEvent`,
 * tabela escrita exclusivamente pelas verticais (fitness/beauty via
 * `customerJourneyEngine.emitJourneyEvent`); o fluxo de suporte persiste
 * Ticket/ticket.messages/AuditEvent/ChannelMessage — não existe artefato
 * "CRM activity" no domínio de tickets. Manter a exigência tornava a jornada
 * estruturalmente NO_GO sem relação com o comportamento real do sistema.
 */

const logger = require('../../../utils/logger');

/**
 * Retorna payload de pré-condição para support_ticket_flow.
 * Não faz chamadas de rede — apenas descreve os probes e metadados necessários.
 */
function buildSupportOperationalSeedSpec(options = {}) {
  const suffix = options.suffix || String(Date.now());
  const tenantId = options.tenantId || process.env.DEFAULT_TENANT_ID || 'system';
  const agentId = options.agentId || process.env.DEFAULT_AGENT_ID || 'qa-agent-seed';
  const phone = options.phone || `551199${suffix.slice(-7)}`;

  return {
    journeyId: 'support_ticket_flow',
    seedType: 'operational_strict',
    tenantId,
    agentId,
    suffix,

    // ── Precondições que devem ser provisionadas antes do step-by-step ──
    preconditions: {
      authenticated_agent: true,
      tenant_loaded: true,
      open_ticket_exists: true,
      ticket_storage_accessible: true,
    },

    // ── Dados a criar via API antes da execução ──
    provisioning: {
      ticket: {
        phoneNumber: phone,
        queue: 'support',
        initialMessage: `QA Waves Operational Seed — ${suffix}`,
        tags: ['qa-operational', 'seed'],
      },
      contact: {
        name: `QA Contact ${suffix}`,
        phone,
        source: 'qa_seed',
        tags: ['qa-operational'],
      },
      // takeover acontece no step canônico step_takeover_ticket (browser),
      // não no provisioning — ver provisionSupportSeed.
      takeover: {
        reason: 'qa_waves_operational',
        executedBy: 'browser_step',
      },
    },

    // ── Estado inicial esperado (para snapshot before) ──
    beforeStateKeys: [
      'db.ticket.exists',
      'db.ticket.status',
      'db.ticket.messages.count',
      'events.audit.count',
    ],

    // ── Ações operacionais a executar ──
    expectedOperationalActions: [
      'access_support_module',
      'list_tickets',
      'open_ticket',
      'reply_ticket',
      'change_ticket_status',
    ],

    // ── Conteúdo da resposta do agente ──
    agentReply: `Resposta operacional validada — QA Waves seed ${suffix}.`,

    // ── Estado final esperado (para snapshot after) ──
    afterStateKeys: [
      'db.ticket.messages.count:incremented',
      'events.audit.count:incremented',
    ],

    // ── Side effects obrigatórios ──
    requiredSideEffects: [
      'ticket_status_changed',
      'audit_log_created',
      'notification_sent',
    ],

    // ── Validações pós-execução ──
    postValidation: {
      messageCreated: true,
      statusChanged: true,
      auditLogCreated: true,
    },
  };
}

/**
 * Executa provisionamento do seed via funções HTTP (httpClient recebe { method, url, body, headers }).
 * Retorna { ok, ticketId, conversationId, contactId, beforeSnapshot, reason }.
 */
async function provisionSupportSeed(seedSpec = {}, httpClient = null) {
  if (!httpClient || typeof httpClient !== 'function') {
    logger.warn('[SupportOperationalSeed] httpClient não fornecido — seed não provisionado');
    return {
      ok: false,
      reason: 'http_client_missing',
      ticketId: null,
      conversationId: null,
      contactId: null,
      beforeSnapshot: null,
    };
  }

  const { provisioning, tenantId, suffix } = seedSpec;
  let contactId = null;
  let ticketId = null;
  let conversationId = null;

  // 1. Criar contato/CRM real
  try {
    const contactResp = await httpClient({
      method: 'POST',
      url: '/api/crm/contacts',
      body: {
        ...provisioning.contact,
        tenantId,
      },
    });
    contactId = contactResp?.body?.id || contactResp?.body?.contact?.id || null;
    if (!contactId) {
      logger.warn('[SupportOperationalSeed] Contato não criado — contactId ausente na resposta');
    }
  } catch (err) {
    logger.warn(`[SupportOperationalSeed] Falha ao criar contato: ${err.message}`);
  }

  // 2. Criar ticket real
  try {
    const ticketResp = await httpClient({
      method: 'POST',
      url: '/tickets',
      body: {
        ...provisioning.ticket,
        contactId,
        tenantId,
      },
    });
    const body = ticketResp?.body;
    ticketId = body?.ticket?.id || body?.id || null;
    conversationId = body?.ticket?.conversationId || body?.conversationId || body?.ticket?.conversation?.id || null;

    if (!ticketId) {
      return {
        ok: false,
        reason: 'ticket_creation_failed',
        ticketId: null,
        conversationId: null,
        contactId,
        beforeSnapshot: null,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `ticket_creation_error:${err.message}`,
      ticketId: null,
      conversationId: null,
      contactId,
      beforeSnapshot: null,
    };
  }

  // 3. Verificação real da pré-condição: ticket AGUARDANDO atendimento.
  // O takeover/assign NÃO acontecem mais no provisioning: eles são a mutação
  // real do step canônico step_takeover_ticket (executado no browser, com
  // network proof POST /tickets/:id/takeover e diff incremental de status).
  // Fazer takeover aqui tornaria o step idempotente e quebraria a prova de
  // mutação (ticket_status_changed) exigida pelo operationalStepRegistry.
  let verifiedStatus = null;
  try {
    const ticketState = await httpClient({
      method: 'GET',
      url: `/tickets/${encodeURIComponent(ticketId)}`,
    });
    verifiedStatus = ticketState?.body?.ticket?.status || ticketState?.body?.status || null;
  } catch (err) {
    logger.warn(`[SupportOperationalSeed] Falha ao verificar status do ticket: ${err.message}`);
  }

  if (verifiedStatus !== 'waiting') {
    return {
      ok: false,
      reason: `ticket_not_waiting:${verifiedStatus || 'unknown'}`,
      ticketId,
      conversationId,
      contactId,
      beforeSnapshot: null,
    };
  }

  // 4. Snapshot inicial do estado
  const beforeSnapshot = {
    seedSuffix: suffix,
    tenantId,
    ticketId,
    conversationId,
    contactId,
    capturedAt: new Date().toISOString(),
    db: {
      ticket: { exists: true, id: ticketId, status: verifiedStatus },
    },
    crm: { contactId, activities: { count: 0 } },
    events: { audit: { count: 0 } },
  };

  return {
    ok: true,
    ticketId,
    conversationId,
    contactId,
    beforeSnapshot,
    reason: null,
  };
}

/**
 * Valida estado pós-execução do support_ticket_flow.
 * Retorna { ok, blockers }.
 */
function validateSupportSeedPostExecution(beforeSnapshot = {}, afterSnapshot = {}, options = {}) {
  const blockers = [];

  const beforeMsgCount = Number(beforeSnapshot?.db?.ticket?.messages?.count || 0);
  const afterMsgCount = Number(afterSnapshot?.db?.ticket?.messages?.count || 0);
  if (afterMsgCount <= beforeMsgCount) {
    blockers.push({ reason: 'support_post_validation_message_not_created', expected: 'incremented', actual: afterMsgCount });
  }

  const beforeStatus = String(beforeSnapshot?.db?.ticket?.status || '').toLowerCase();
  const afterStatus = String(afterSnapshot?.db?.ticket?.status || '').toLowerCase();
  if (!afterStatus || afterStatus === beforeStatus) {
    blockers.push({ reason: 'support_post_validation_status_not_changed', beforeStatus, afterStatus });
  }

  // Sem probe de CRM aqui: ver nota de contrato no cabeçalho do arquivo —
  // o domínio de suporte não escreve atividades CRM (VerticalJourneyEvent é
  // exclusivo das verticais).

  const beforeAuditCount = Number(beforeSnapshot?.events?.audit?.count || 0);
  const afterAuditCount = Number(afterSnapshot?.events?.audit?.count || 0);
  if (afterAuditCount <= beforeAuditCount) {
    blockers.push({ reason: 'support_post_validation_audit_log_not_created', expected: 'incremented', actual: afterAuditCount });
  }

  return {
    ok: blockers.length === 0,
    blockers,
    goNoGo: blockers.length > 0 ? 'NO_GO' : 'GO',
  };
}

module.exports = {
  buildSupportOperationalSeedSpec,
  provisionSupportSeed,
  validateSupportSeedPostExecution,
};
