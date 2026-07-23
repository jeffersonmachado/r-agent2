'use strict';

/**
 * Learning Core — Mentor Service (evolução contínua).
 *
 * Agrega deterministicamente as janelas de 7/30/90 dias do usuário (eventos,
 * erros, taxa de erro, skills ativas, scores atuais) e gera um PLANO DE
 * EVOLUÇÃO via IA (generateAiResponse) sobre esses agregados — AI-first:
 * IA indisponível ou resposta inválida => erro explícito `ai_unavailable`,
 * nunca heurística. Todo plano é persistido (learning_mentor_plans) com os
 * agregados que o originaram (auditoria).
 */

const { generateAiResponse } = require('../../services/aiProviderService');
const getLearningMentorPlanModel = require('../../db/models/LearningMentorPlan');
const competencyService = require('./competencyService');
const assessmentEngine = require('../../../src/core/learning/assessment-engine');
const competencyEngine = require('../../../src/core/learning/competency-engine');
const logger = require('../../utils/logger');

const WINDOWS_DAYS = [7, 30, 90];

function windowAggregates(events, days, now) {
  const cutoff = now.getTime() - days * 86400000;
  const inWindow = events.filter((event) => {
    const time = new Date(event.occurredAt || event.occurred_at).getTime();
    return Number.isFinite(time) && time >= cutoff;
  });
  const errors = inWindow.filter((event) => competencyEngine.isErrorEvent({
    type: event.type,
    status: event.payload && event.payload.status,
    errorCode: event.payload && event.payload.errorCode,
    payload: event.payload,
  }));
  const routes = new Set(inWindow.map((e) => e.payload && e.payload.route).filter(Boolean));
  const flowsCompleted = inWindow.filter((e) => e.type === 'learning.interaction.flow_completed').length;
  const flowsAbandoned = inWindow.filter((e) => e.type === 'learning.interaction.flow_abandoned').length;

  return {
    days,
    events: inWindow.length,
    errors: errors.length,
    errorRate: inWindow.length > 0 ? Math.round((errors.length / inWindow.length) * 10000) / 10000 : null,
    activeRoutes: routes.size,
    flowsCompleted,
    flowsAbandoned,
  };
}

/**
 * Agregados determinísticos das janelas 7/30/90 dias + competências atuais.
 */
async function buildMentorAggregates({ tenantId, agentId }) {
  const now = new Date();
  const events = await competencyService.loadLedgerEvents({ tenantId, agentId });
  const { competencies, profile } = await competencyService.getCompetencies({ tenantId, agentId });

  return {
    generatedAt: now.toISOString(),
    windows: WINDOWS_DAYS.map((days) => windowAggregates(events, days, now)),
    competencies: competencies.map((c) => ({
      skillKey: c.skillKey,
      score: c.score,
      eventCount: c.eventCount,
    })),
    dominantSkills: (profile && profile.dominantSkills) || [],
    weakSkills: (profile && profile.weakSkills) || [],
  };
}

function extractJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Gera (e persiste) o plano de evolução do usuário via IA.
 * Lança erro com code 'AI_UNAVAILABLE' quando a IA não está disponível ou
 * não retorna JSON válido — sem fallback heurístico.
 */
async function generateMentorPlan({ tenantId, agentId }) {
  const aggregates = await buildMentorAggregates({ tenantId, agentId });

  const prompt = [
    'Voce e o Mentor de evolucao continua de uma plataforma de operacoes.',
    'Analise os agregados de uso do usuario (janelas de 7/30/90 dias) e gere',
    'um plano de evolucao pratico e curto. Responda APENAS com um JSON, sem',
    'texto adicional, no formato:',
    '{',
    '  "resumo": "<2 frases>",',
    '  "competenciasSugeridas": [{"skill": "<skillKey>", "motivo": "<...>"}],',
    '  "objetivos": [{"descricao": "<...>", "prazoDias": <numero>}],',
    '  "indicadores": [{"nome": "<...>", "meta": "<...>"}]',
    '}',
    'Regras: no maximo 3 competencias, 3 objetivos e 3 indicadores; priorize',
    'as skills fracas (weakSkills) e a reducao da taxa de erro; portugues.',
    `Agregados: ${JSON.stringify(aggregates)}`,
  ].join('\n');

  let plan = null;
  try {
    const result = await generateAiResponse(prompt, tenantId, {
      caller: 'learning-core-mentor',
      source: 'learning-core',
    });
    plan = extractJsonObject(result && result.text);
  } catch (error) {
    logger.warn('[learning-core] Mentor: IA indisponivel (ai_unavailable)', {
      tenantId,
      agentId: String(agentId),
      error: error.message,
    });
  }

  if (!plan) {
    const error = new Error('IA indisponivel ou resposta invalida ao gerar plano de evolucao (ai_unavailable)');
    error.code = 'AI_UNAVAILABLE';
    throw error;
  }

  const Model = getLearningMentorPlanModel();
  const record = await Model.create({
    tenant_id: String(tenantId),
    agentId: String(agentId),
    aggregates,
    plan,
    status: 'active',
    generatedAt: new Date(),
  });

  logger.info('[learning-core] Mentor: plano gerado', {
    tenantId,
    agentId: String(agentId),
    planId: record.id,
  });

  return serializePlan(record);
}

function serializePlan(row) {
  return {
    id: row.id,
    aggregates: row.aggregates || {},
    plan: row.plan || {},
    status: row.status,
    generatedAt: row.generatedAt,
  };
}

/**
 * Último plano gerado (null quando ainda não existe).
 */
async function getLatestMentorPlan({ tenantId, agentId }) {
  const Model = getLearningMentorPlanModel();
  const row = await Model.findOne({
    where: { tenant_id: String(tenantId), agentId: String(agentId) },
    order: [['generatedAt', 'DESC']],
  });
  return row ? serializePlan(row) : null;
}

module.exports = {
  buildMentorAggregates,
  generateMentorPlan,
  getLatestMentorPlan,
  WINDOWS_DAYS,
};
