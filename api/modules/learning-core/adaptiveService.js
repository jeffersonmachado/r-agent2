'use strict';

/**
 * Learning Core — Adaptive Service.
 *
 * Detecta sinais de mudança (drift) e mantém os treinamentos/certificações
 * atualizados:
 *  - certification_drift: certificações ativas com erros novos do mesmo
 *    usuário em rotas da skill certificada (após a emissão);
 *  - unclassified_routes: rotas presentes nos eventos recentes sem mapeamento
 *    rota→skill (estático nem de tenant) — treinamento/competência cego ali;
 *  - weak_skills: skills com score médio < 0.5 (evidência suficiente) e sem
 *    missão de treinamento associada.
 *
 * `runAdaptiveCycle` aplica a ação segura automática: reavaliar as
 * certificações dos usuários com drift (revoga se não mais certificável).
 * A geração de treinamentos permanece ação administrativa explícita
 * (journey trainer), aqui apenas sinalizada.
 */

const { Op } = require('sequelize');

const { EventLedger } = require('../../db/models');
const getUserCertificationModel = require('../../db/models/UserCertification');
const getUserCompetencyModel = require('../../db/models/UserCompetency');
const getLearningMissionModel = require('../../db/models/LearningMission');
const competencyService = require('./competencyService');
const certificationService = require('./certificationService');
const logger = require('../../utils/logger');

const DRIFT_MIN_ERRORS = 2;
const WEAK_SCORE = 0.5;
const WEAK_MIN_EVENTS = 5;
const MAX_SIGNAL_ITEMS = 50;

async function collectDriftSignals({ tenantId, routeSkillMap }) {
  const Model = getUserCertificationModel();
  const active = await Model.findAll({
    where: { tenant_id: String(tenantId), status: 'active' },
    limit: 500,
  });
  if (active.length === 0) return [];

  const since = new Date(Date.now() - 30 * 86400000);
  const signals = [];

  // Janela de eventos por certificação: max(issuedAt, since). Antes havia um
  // findAll por certificação (até 500 queries); agora uma query única cobre
  // todos os actors desde a janela mais antiga e o refinamento por
  // certificação acontece em JS.
  const windowStartByCert = active.map((cert) => (cert.issuedAt > since ? cert.issuedAt : since));
  const earliestWindowStart = new Date(Math.min(...windowStartByCert.map((d) => new Date(d).getTime())));
  const actorIds = Array.from(new Set(active.map((cert) => String(cert.agentId))));

  // Cap defensivo de scan (tabela append-only): antes eram até 2000 linhas por
  // certificação; o cap global evita varredura ilimitada e é logado se atingido.
  const DRIFT_SCAN_LIMIT = 50000;
  const rows = await EventLedger().findAll({
    where: {
      tenant_key: String(tenantId),
      source: 'learning-core',
      actor_id: { [Op.in]: actorIds },
      type: { [Op.like]: 'learning.interaction.%' },
      occurred_at: { [Op.gte]: earliestWindowStart },
    },
    order: [['occurred_at', 'ASC']],
    limit: DRIFT_SCAN_LIMIT,
  });
  if (rows.length >= DRIFT_SCAN_LIMIT) {
    logger.warn('[learning-core] Scan de drift atingiu o limite defensivo', {
      tenantId: String(tenantId),
      limit: DRIFT_SCAN_LIMIT,
    });
  }

  const rowsByActor = new Map();
  for (const row of rows) {
    const actorId = String(row.actor_id);
    if (!rowsByActor.has(actorId)) rowsByActor.set(actorId, []);
    rowsByActor.get(actorId).push(row);
  }

  for (let i = 0; i < active.length; i++) {
    const cert = active[i];
    const windowStart = windowStartByCert[i];

    let errorCount = 0;
    for (const row of rowsByActor.get(String(cert.agentId)) || []) {
      const occurredAt = row.occurred_at ? new Date(row.occurred_at) : null;
      if (!occurredAt || occurredAt < new Date(windowStart)) continue;
      const payload = row.payload || {};
      if (routeSkillMap[payload.route] !== cert.skillKey) continue;
      const status = Number(payload.status);
      const isError = row.type === 'learning.interaction.error'
        || row.type === 'learning.interaction.flow_abandoned'
        || (row.type === 'learning.interaction.api_call' && ((Number.isFinite(status) && status >= 400) || Boolean(payload.errorCode)));
      if (isError) errorCount += 1;
    }

    if (errorCount >= DRIFT_MIN_ERRORS) {
      signals.push({
        type: 'certification_drift',
        agentId: String(cert.agentId),
        skillKey: cert.skillKey,
        certificationId: cert.id,
        errorsSinceIssued: errorCount,
        action: 'reavaliar_certificacao',
      });
      if (signals.length >= MAX_SIGNAL_ITEMS) break;
    }
  }

  return signals;
}

async function collectUnclassifiedRouteSignals({ tenantId, routeSkillMap }) {
  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await EventLedger().findAll({
    where: {
      tenant_key: String(tenantId),
      source: 'learning-core',
      type: { [Op.like]: 'learning.interaction.%' },
      occurred_at: { [Op.gte]: since },
    },
    attributes: ['payload'],
    limit: 5000,
  });

  const unknown = new Set();
  for (const row of rows) {
    const route = row.payload && row.payload.route;
    if (route && !routeSkillMap[route]) unknown.add(route);
  }

  return Array.from(unknown).slice(0, MAX_SIGNAL_ITEMS).map((route) => ({
    type: 'unclassified_route',
    route,
    action: 'classificar_rota_ia',
  }));
}

async function collectWeakSkillSignals({ tenantId }) {
  const Competency = getUserCompetencyModel();
  const Mission = getLearningMissionModel();

  const rows = await Competency.findAll({
    where: {
      tenant_id: String(tenantId),
      score: { [Op.lt]: WEAK_SCORE },
      eventCount: { [Op.gte]: WEAK_MIN_EVENTS },
    },
    limit: 1000,
  });
  if (rows.length === 0) return [];

  const bySkill = new Map();
  for (const row of rows) {
    if (!bySkill.has(row.skillKey)) bySkill.set(row.skillKey, { users: 0, scoreSum: 0 });
    const agg = bySkill.get(row.skillKey);
    agg.users += 1;
    agg.scoreSum += Number(row.score) || 0;
  }

  const missions = await Mission.findAll({
    where: { tenant_id: String(tenantId) },
    attributes: ['journeyKey', 'metadata'],
    limit: 500,
  });
  const covered = new Set();
  for (const mission of missions) {
    const metadata = mission.metadata || {};
    for (const key of [mission.journeyKey, ...(metadata.skillKeys || [])].filter(Boolean)) {
      covered.add(key);
    }
  }

  const signals = [];
  for (const [skillKey, agg] of bySkill.entries()) {
    if (covered.has(skillKey)) continue;
    signals.push({
      type: 'weak_skill',
      skillKey,
      users: agg.users,
      avgScore: Math.round((agg.scoreSum / agg.users) * 10000) / 10000,
      action: 'gerar_treinamento',
    });
    if (signals.length >= MAX_SIGNAL_ITEMS) break;
  }
  return signals;
}

/**
 * Coleta todos os sinais de adaptação do tenant.
 */
async function collectSignals({ tenantId }) {
  const artifact = competencyService.getSkillGraphArtifact();
  const staticRouteMap = (artifact && artifact.routeSkillMap) || {};
  const tenantRouteMap = await competencyService.loadTenantRouteMap({ tenantId });
  const routeSkillMap = { ...staticRouteMap, ...tenantRouteMap };

  const [drift, unclassified, weakSkills] = await Promise.all([
    collectDriftSignals({ tenantId, routeSkillMap }),
    collectUnclassifiedRouteSignals({ tenantId, routeSkillMap }),
    collectWeakSkillSignals({ tenantId }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    signals: [...drift, ...unclassified, ...weakSkills],
    summary: {
      certificationDrift: drift.length,
      unclassifiedRoutes: unclassified.length,
      weakSkills: weakSkills.length,
    },
  };
}

/**
 * Aplica as ações automáticas seguras: reavalia as certificações dos
 * usuários com drift (revoga o que não for mais certificável).
 */
async function runAdaptiveCycle({ tenantId }) {
  const { signals, summary } = await collectSignals({ tenantId });

  const agentsWithDrift = Array.from(new Set(
    signals.filter((s) => s.type === 'certification_drift').map((s) => s.agentId),
  ));

  const actions = [];
  for (const driftAgentId of agentsWithDrift) {
    const result = await certificationService.evaluateCertifications({
      tenantId,
      agentId: driftAgentId,
    });
    actions.push({
      agentId: driftAgentId,
      revoked: result.revoked.map((r) => r.skillKey),
      stillActive: result.active.map((a) => a.skillKey),
    });
  }

  logger.info('[learning-core] Ciclo adaptativo executado', {
    tenantId,
    ...summary,
    agentsReevaluated: agentsWithDrift.length,
  });

  return {
    summary,
    signals,
    actions,
  };
}

module.exports = {
  collectSignals,
  runAdaptiveCycle,
  DRIFT_MIN_ERRORS,
  WEAK_SCORE,
};
