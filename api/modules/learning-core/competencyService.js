'use strict';

/**
 * Learning Core — Competency Service (orquestração).
 *
 * Recomputa e persiste as competências de um usuário por skill:
 *   1. lê os eventos `learning.interaction.*` do ledger (últimos 90 dias);
 *   2. resolve rota -> skill pelo artefato estático do skill-graph mais os
 *      overrides/classificações do tenant em `learning_route_skill_map`;
 *   3. classifica rotas desconhecidas via IA (aiProviderService — AI-first,
 *      NUNCA heurística). IA indisponível/erro -> rotas reportadas em
 *      `unclassifiedRoutes`, recompute segue sem elas;
 *   4. delega o cálculo ao núcleo puro (src/core/learning/competency-engine);
 *   5. faz upsert em `user_competencies` e `user_learning_profiles`.
 *
 * Sem fallback em memória: falha de DB propaga como erro explícito.
 */

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

const { EventLedger } = require('../../db/models');
const getUserCompetencyModel = require('../../db/models/UserCompetency');
const getUserLearningProfileModel = require('../../db/models/UserLearningProfile');
const getLearningRouteSkillMapModel = require('../../db/models/LearningRouteSkillMap');
const { generateAiResponse } = require('../../services/aiProviderService');
const competencyEngine = require('../../../src/core/learning/competency-engine');
const logger = require('../../utils/logger');

const LOOKBACK_DAYS = 90;
const MAX_EVENTS = 5000;
const MAX_AI_ROUTES = 20;
const SKILL_GRAPH_PATH = path.join(__dirname, '..', '..', '..', 'config', 'learning', 'skill-graph.json');

/**
 * Lê o artefato do skill-graph. Retorna null quando ainda não foi gerado
 * (rode `npm run learning:skill-graph:build`).
 */
function getSkillGraphArtifact() {
  try {
    if (!fs.existsSync(SKILL_GRAPH_PATH)) return null;
    return JSON.parse(fs.readFileSync(SKILL_GRAPH_PATH, 'utf8'));
  } catch (error) {
    logger.warn('[learning-core] Falha ao ler skill-graph.json', { error: error.message });
    return null;
  }
}

function knownRoutesBySkillFromArtifact(artifact) {
  const map = {};
  for (const skill of (artifact && artifact.skills) || []) {
    map[skill.key] = Array.isArray(skill.routes) ? skill.routes : [];
  }
  return map;
}

function skillKeysFromArtifact(artifact) {
  return ((artifact && artifact.skills) || []).map((skill) => skill.key);
}

async function loadLedgerEvents({ tenantId, agentId }) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
  const rows = await EventLedger().findAll({
    where: {
      tenant_key: String(tenantId),
      source: 'learning-core',
      actor_id: String(agentId),
      type: { [Op.like]: 'learning.interaction.%' },
      occurred_at: { [Op.gte]: since },
    },
    order: [['occurred_at', 'ASC']],
    limit: MAX_EVENTS,
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    payload: row.payload || {},
  }));
}

async function loadTenantRouteMap({ tenantId }) {
  const Model = getLearningRouteSkillMapModel();
  const rows = await Model.findAll({ where: { tenant_id: String(tenantId) } });
  const map = {};
  for (const row of rows) {
    map[row.route] = row.skillKey;
  }
  return map;
}

function extractJsonArray(text) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Classifica rotas desconhecidas via IA em lote único (AI-first).
 * Retorna { classified: Map<route, {skillKey, confidence}>, unclassified: string[] }.
 * Nunca usa heurística: qualquer falha vira `unclassified` explícito.
 */
async function classifyRoutesWithAi({ tenantId, routes, skillKeys }) {
  const classified = new Map();
  const unclassified = [];

  if (routes.length === 0) return { classified, unclassified };
  if (skillKeys.length === 0) return { classified, unclassified: routes.slice() };

  const prompt = [
    'Voce e um classificador de rotas de uma plataforma de operacoes.',
    'Associe cada rota de UI a exatamente UMA skill da lista fornecida.',
    'Responda APENAS com um array JSON, sem texto adicional, no formato:',
    '[{"route": "<rota>", "skill": "<skillKey>", "confidence": <0..1>}]',
    `Skills disponiveis: ${skillKeys.join(', ')}`,
    `Rotas: ${routes.join(', ')}`,
  ].join('\n');

  let parsed = null;
  try {
    const result = await generateAiResponse(prompt, tenantId, {
      caller: 'learning-core-competency',
      source: 'learning-core',
    });
    parsed = extractJsonArray(result && result.text);
  } catch (error) {
    logger.warn('[learning-core] IA indisponivel para classificar rotas (ai_unavailable)', {
      tenantId,
      routes: routes.length,
      error: error.message,
    });
    return { classified, unclassified: routes.slice() };
  }

  if (!parsed) {
    logger.warn('[learning-core] Resposta da IA sem JSON valido ao classificar rotas', { tenantId });
    return { classified, unclassified: routes.slice() };
  }

  const knownSkills = new Set(skillKeys);
  const byRoute = new Map();
  for (const item of parsed) {
    if (!item || typeof item.route !== 'string' || typeof item.skill !== 'string') continue;
    if (!knownSkills.has(item.skill)) continue;
    const confidence = Number(item.confidence);
    byRoute.set(item.route, {
      skillKey: item.skill,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    });
  }

  for (const route of routes) {
    if (byRoute.has(route)) {
      classified.set(route, byRoute.get(route));
    } else {
      unclassified.push(route);
    }
  }

  return { classified, unclassified };
}

async function persistAiRouteClassifications({ tenantId, classified }) {
  if (classified.size === 0) return;
  const Model = getLearningRouteSkillMapModel();
  for (const [route, { skillKey, confidence }] of classified.entries()) {
    await Model.findOrCreate({
      where: { tenant_id: String(tenantId), route },
      defaults: {
        tenant_id: String(tenantId),
        route,
        skillKey,
        source: 'ai',
        confidence,
      },
    });
  }
}

async function upsertCompetencies({ tenantId, agentId, competencies }) {
  const Model = getUserCompetencyModel();
  for (const competency of competencies) {
    const existing = await Model.findOne({
      where: { tenant_id: String(tenantId), agentId: String(agentId), skillKey: competency.skillKey },
    });
    const values = {
      score: competency.score,
      components: competency.components,
      evidenceRefs: (competency.evidenceRefs || []).slice(0, 20),
      eventCount: competency.eventCount,
      firstSeenAt: competency.firstSeenAt ? new Date(competency.firstSeenAt) : null,
      lastSeenAt: competency.lastSeenAt ? new Date(competency.lastSeenAt) : null,
    };
    if (existing) {
      await existing.update(values);
    } else {
      await Model.create({
        tenant_id: String(tenantId),
        agentId: String(agentId),
        skillKey: competency.skillKey,
        ...values,
      });
    }
  }
}

async function upsertProfile({ tenantId, agentId, profile, computedAt }) {
  const Model = getUserLearningProfileModel();
  const existing = await Model.findOne({
    where: { tenant_id: String(tenantId), agentId: String(agentId) },
  });
  if (existing) {
    await existing.update({ summary: profile, computedAt });
  } else {
    await Model.create({
      tenant_id: String(tenantId),
      agentId: String(agentId),
      summary: profile,
      computedAt,
    });
  }
}

/**
 * Recomputa competências e perfil de aprendizado de um usuário.
 *
 * @returns {Promise<{competencies, profile, unclassifiedRoutes, eventsProcessed}>}
 */
async function recomputeCompetencies({ tenantId, agentId, username }) {
  void username; // reservado para enriquecimento futuro do perfil
  const now = new Date();

  const events = await loadLedgerEvents({ tenantId, agentId });

  const artifact = getSkillGraphArtifact();
  const staticRouteMap = (artifact && artifact.routeSkillMap) || {};
  const knownRoutesBySkill = knownRoutesBySkillFromArtifact(artifact);
  const skillKeys = skillKeysFromArtifact(artifact);

  // Overrides/classificações do tenant prevalecem sobre o mapa estático.
  const tenantRouteMap = await loadTenantRouteMap({ tenantId });
  const routeSkillMap = { ...staticRouteMap, ...tenantRouteMap };

  // Rotas presentes nos eventos e ainda não mapeadas -> classificação via IA.
  const eventRoutes = Array.from(new Set(events.map((e) => e.payload && e.payload.route).filter(Boolean)));
  const unknownRoutes = eventRoutes.filter((route) => !routeSkillMap[route]);
  const aiCandidates = unknownRoutes.slice(0, MAX_AI_ROUTES);
  const unclassifiedRoutes = unknownRoutes.slice(MAX_AI_ROUTES);

  if (aiCandidates.length > 0) {
    const { classified, unclassified } = await classifyRoutesWithAi({
      tenantId,
      routes: aiCandidates,
      skillKeys,
    });
    await persistAiRouteClassifications({ tenantId, classified });
    for (const [route, { skillKey }] of classified.entries()) {
      routeSkillMap[route] = skillKey;
    }
    unclassifiedRoutes.push(...unclassified);
  }

  const competencies = competencyEngine.computeCompetencies({
    events,
    routeSkillMap,
    knownRoutesBySkill,
    now,
  });
  const profile = competencyEngine.buildProfile(competencies);

  await upsertCompetencies({ tenantId, agentId, competencies });
  await upsertProfile({ tenantId, agentId, profile, computedAt: now });

  logger.info('[learning-core] Competencias recomputadas', {
    tenantId,
    agentId: String(agentId),
    eventsProcessed: events.length,
    skills: competencies.length,
    unclassifiedRoutes: unclassifiedRoutes.length,
  });

  return {
    competencies,
    profile,
    unclassifiedRoutes,
    eventsProcessed: events.length,
  };
}

function serializeCompetency(row) {
  return {
    skillKey: row.skillKey,
    score: row.score,
    components: row.components || {},
    evidenceRefs: row.evidenceRefs || [],
    eventCount: row.eventCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Lê competências persistidas; se não houver nada, dispara um recompute e
 * lê novamente.
 */
async function getCompetencies({ tenantId, agentId }) {
  const Competency = getUserCompetencyModel();
  const Profile = getUserLearningProfileModel();

  let rows = await Competency.findAll({
    where: { tenant_id: String(tenantId), agentId: String(agentId) },
    order: [['score', 'DESC']],
  });

  if (rows.length === 0) {
    await recomputeCompetencies({ tenantId, agentId });
    rows = await Competency.findAll({
      where: { tenant_id: String(tenantId), agentId: String(agentId) },
      order: [['score', 'DESC']],
    });
  }

  const profileRow = await Profile.findOne({
    where: { tenant_id: String(tenantId), agentId: String(agentId) },
  });

  return {
    agentId: String(agentId),
    competencies: rows.map(serializeCompetency),
    profile: profileRow ? profileRow.summary : null,
    computedAt: profileRow ? profileRow.computedAt : null,
  };
}

module.exports = {
  recomputeCompetencies,
  getCompetencies,
  getSkillGraphArtifact,
  loadLedgerEvents,
  loadTenantRouteMap,
  LOOKBACK_DAYS,
  MAX_AI_ROUTES,
};
