'use strict';

/**
 * Learning Core — Analytics Service.
 *
 * Dashboards de aprendizado por tenant (dados reais, sem síntese): usuários,
 * skills, missões, certificações, simulações, dicas do tutor e um proxy de
 * ROI — redução de erros e de tempo de navegação comparando os últimos 30
 * dias com os 30 anteriores (event ledger).
 */

const { Op } = require('sequelize');

const { EventLedger } = require('../../db/models');
const getUserCompetencyModel = require('../../db/models/UserCompetency');
const getUserCertificationModel = require('../../db/models/UserCertification');
const getLearningMissionModel = require('../../db/models/LearningMission');
const getLearningSimulationModel = require('../../db/models/LearningSimulation');
const getLearningTutorHintModel = require('../../db/models/LearningTutorHint');

const WINDOW_DAYS = 30;
const MAX_LEDGER_ROWS = 10000;

function round4(value) {
  return value === null ? null : Math.round(value * 10000) / 10000;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isErrorRow(row) {
  const payload = row.payload || {};
  const status = Number(payload.status);
  return row.type === 'learning.interaction.error'
    || row.type === 'learning.interaction.flow_abandoned'
    || (row.type === 'learning.interaction.api_call' && ((Number.isFinite(status) && status >= 400) || Boolean(payload.errorCode)));
}

async function computeRoiProxy({ tenantId }) {
  const now = Date.now();
  const currentStart = new Date(now - WINDOW_DAYS * 86400000);
  const previousStart = new Date(now - 2 * WINDOW_DAYS * 86400000);

  const rows = await EventLedger().findAll({
    where: {
      tenant_key: String(tenantId),
      source: 'learning-core',
      type: { [Op.like]: 'learning.interaction.%' },
      occurred_at: { [Op.gte]: previousStart },
    },
    order: [['occurred_at', 'ASC']],
    limit: MAX_LEDGER_ROWS,
  });

  const current = { events: 0, errors: 0, navDurations: [] };
  const previous = { events: 0, errors: 0, navDurations: [] };

  for (const row of rows) {
    const bucket = new Date(row.occurred_at).getTime() >= currentStart.getTime() ? current : previous;
    bucket.events += 1;
    if (isErrorRow(row)) bucket.errors += 1;
    const durationMs = Number(row.payload && row.payload.durationMs);
    if (row.type === 'learning.interaction.navigation' && Number.isFinite(durationMs) && durationMs >= 0) {
      bucket.navDurations.push(durationMs);
    }
  }

  const currentErrorRate = current.events > 0 ? current.errors / current.events : null;
  const previousErrorRate = previous.events > 0 ? previous.errors / previous.events : null;
  const currentMedianNav = median(current.navDurations);
  const previousMedianNav = median(previous.navDurations);

  return {
    windowDays: WINDOW_DAYS,
    current: {
      events: current.events,
      errors: current.errors,
      errorRate: round4(currentErrorRate),
      medianNavigationMs: currentMedianNav,
    },
    previous: {
      events: previous.events,
      errors: previous.errors,
      errorRate: round4(previousErrorRate),
      medianNavigationMs: previousMedianNav,
    },
    errorRateDelta: round4(
      currentErrorRate !== null && previousErrorRate !== null ? currentErrorRate - previousErrorRate : null,
    ),
    navigationMsDelta: currentMedianNav !== null && previousMedianNav !== null
      ? Math.round(currentMedianNav - previousMedianNav)
      : null,
  };
}

/**
 * Visão geral de aprendizado do tenant.
 */
async function getOverview({ tenantId }) {
  const Competency = getUserCompetencyModel();
  const Certification = getUserCertificationModel();
  const Mission = getLearningMissionModel();
  const Simulation = getLearningSimulationModel();
  const TutorHint = getLearningTutorHintModel();

  const competencyRows = await Competency.findAll({
    where: { tenant_id: String(tenantId) },
    limit: 5000,
  });

  const users = new Set(competencyRows.map((row) => String(row.agentId)));
  const bySkill = new Map();
  for (const row of competencyRows) {
    if (!bySkill.has(row.skillKey)) bySkill.set(row.skillKey, { users: 0, scoreSum: 0 });
    const agg = bySkill.get(row.skillKey);
    agg.users += 1;
    agg.scoreSum += Number(row.score) || 0;
  }

  const certificationRows = await Certification.findAll({
    where: { tenant_id: String(tenantId) },
    attributes: ['skillKey', 'status'],
    limit: 5000,
  });
  const activeCertsBySkill = new Map();
  let activeCertifications = 0;
  let revokedCertifications = 0;
  for (const row of certificationRows) {
    if (row.status === 'active') {
      activeCertifications += 1;
      activeCertsBySkill.set(row.skillKey, (activeCertsBySkill.get(row.skillKey) || 0) + 1);
    } else if (row.status === 'revoked') {
      revokedCertifications += 1;
    }
  }

  const skills = Array.from(bySkill.entries())
    .map(([skillKey, agg]) => ({
      skillKey,
      users: agg.users,
      avgScore: round4(agg.scoreSum / agg.users),
      activeCertifications: activeCertsBySkill.get(skillKey) || 0,
    }))
    .sort((a, b) => a.skillKey.localeCompare(b.skillKey));

  const [missionsTotal, missionsCompleted] = await Promise.all([
    Mission.count({ where: { tenant_id: String(tenantId) } }),
    Mission.count({ where: { tenant_id: String(tenantId), status: 'completed' } }),
  ]);

  const simulationsTotal = await Simulation.count({ where: { tenant_id: String(tenantId) } });

  const tutorHints30d = await TutorHint.count({
    where: {
      tenant_id: String(tenantId),
      created_at: { [Op.gte]: new Date(Date.now() - WINDOW_DAYS * 86400000) },
    },
  });

  const avgScore = competencyRows.length > 0
    ? round4(competencyRows.reduce((sum, row) => sum + (Number(row.score) || 0), 0) / competencyRows.length)
    : null;

  const roi = await computeRoiProxy({ tenantId });

  return {
    generatedAt: new Date().toISOString(),
    users: users.size,
    avgScore,
    skills,
    missions: { total: missionsTotal, completed: missionsCompleted },
    certifications: { active: activeCertifications, revoked: revokedCertifications },
    simulations: { total: simulationsTotal },
    tutorHints30d,
    roi,
  };
}

module.exports = {
  getOverview,
  WINDOW_DAYS,
};
