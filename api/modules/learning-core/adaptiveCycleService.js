'use strict';

/**
 * Learning Core — Adaptive Cycle Service (agendado).
 *
 * Orquestra o ciclo contínuo por tenant, disparado pelo scheduler da
 * plataforma (job kind `learning_adaptive_cycle`, schedule
 * `sch-learning-adaptive-cycle`, intervalo padrão 6h):
 *   1. roda o ciclo adaptativo (sinais + reavaliação/revogação de
 *      certificações com drift);
 *   2. recomputa as competências dos usuários com atividade recente
 *      (últimas 24h no event ledger, cap MAX_AGENTS).
 *
 * Falha de um usuário não derruba o ciclo — é logada explicitamente e o
 * resumo final reporta os erros.
 */

const { Op } = require('sequelize');

const { EventLedger } = require('../../db/models');
const competencyService = require('./competencyService');
const adaptiveService = require('./adaptiveService');
const logger = require('../../utils/logger');

const MAX_AGENTS = 50;
const ACTIVE_WINDOW_HOURS = 24;

async function listRecentlyActiveAgents({ tenantId, maxAgents = MAX_AGENTS }) {
  const since = new Date(Date.now() - ACTIVE_WINDOW_HOURS * 3600000);
  const rows = await EventLedger().findAll({
    where: {
      tenant_key: String(tenantId),
      source: 'learning-core',
      type: { [Op.like]: 'learning.interaction.%' },
      occurred_at: { [Op.gte]: since },
    },
    attributes: ['actor_id'],
    group: ['actor_id'],
    limit: Number(maxAgents) || MAX_AGENTS,
  });
  return rows.map((row) => String(row.actor_id)).filter(Boolean);
}

/**
 * Executa o ciclo completo para um tenant.
 *
 * @returns {Promise<{tenantId, adaptive, recomputed, errors}>}
 */
async function runScheduledCycle({ tenantId, maxAgents } = {}) {
  const adaptive = await adaptiveService.runAdaptiveCycle({ tenantId });

  const agents = await listRecentlyActiveAgents({ tenantId, maxAgents });
  const recomputed = [];
  const errors = [];

  for (const agentId of agents) {
    try {
      await competencyService.recomputeCompetencies({ tenantId, agentId });
      recomputed.push(agentId);
    } catch (error) {
      errors.push({ agentId, error: error.message });
      logger.warn('[learning-core] Ciclo agendado: recompute falhou para usuario', {
        tenantId,
        agentId,
        error: error.message,
      });
    }
  }

  logger.info('[learning-core] Ciclo adaptativo agendado concluido', {
    tenantId,
    ...adaptive.summary,
    agentsRecomputed: recomputed.length,
    agentErrors: errors.length,
  });

  return {
    tenantId: String(tenantId),
    adaptive: adaptive.summary,
    recomputed: recomputed.length,
    errors,
  };
}

module.exports = {
  runScheduledCycle,
  listRecentlyActiveAgents,
  MAX_AGENTS,
  ACTIVE_WINDOW_HOURS,
};
