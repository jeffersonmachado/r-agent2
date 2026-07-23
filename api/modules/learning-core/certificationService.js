'use strict';

/**
 * Learning Core — Certification Service (orquestração).
 *
 * Certificação automática por COMPETÊNCIA COMPROVADA — nunca por tempo,
 * presença ou consumo de conteúdo. Pipeline:
 *   1. garante competências persistidas (recompute se vazio);
 *   2. lê os eventos do ledger e computa recuperação/exceções por skill
 *      (assessment-engine, núcleo puro);
 *   3. avalia cada skill contra os thresholds (auditável: snapshot completo
 *      dos critérios e evidenceRefs do ledger fica na certificação);
 *   4. emite certificações novas e REVOGA certificações ativas cuja skill
 *      deixou de ser certificável (drift — integração com o adaptive engine).
 *
 * Sem fallback em memória: falha de DB propaga como erro explícito.
 */

const getUserCertificationModel = require('../../db/models/UserCertification');
const competencyService = require('./competencyService');
const assessmentEngine = require('../../../src/core/learning/assessment-engine');
const logger = require('../../utils/logger');

function serializeCertification(row) {
  return {
    id: row.id,
    skillKey: row.skillKey,
    level: row.level,
    status: row.status,
    assessmentSnapshot: row.assessmentSnapshot || {},
    evidenceRefs: row.evidenceRefs || [],
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
  };
}

/**
 * Avalia (e aplica) o estado de certificação de um usuário.
 *
 * @returns {Promise<{assessments, issued, revoked, active}>}
 */
async function evaluateCertifications({ tenantId, agentId }) {
  const { competencies } = await competencyService.getCompetencies({ tenantId, agentId });

  const events = await competencyService.loadLedgerEvents({ tenantId, agentId });

  const artifact = competencyService.getSkillGraphArtifact();
  const staticRouteMap = (artifact && artifact.routeSkillMap) || {};
  const tenantRouteMap = await competencyService.loadTenantRouteMap({ tenantId });
  const routeSkillMap = { ...staticRouteMap, ...tenantRouteMap };

  const recoveryBySkill = assessmentEngine.computeRecovery({ events, routeSkillMap });
  const assessments = assessmentEngine.assessSkills({ competencies, recoveryBySkill });

  const Model = getUserCertificationModel();
  const now = new Date();
  const issued = [];
  const revoked = [];

  for (const assessment of assessments) {
    const active = await Model.findOne({
      where: {
        tenant_id: String(tenantId),
        agentId: String(agentId),
        skillKey: assessment.skillKey,
        status: 'active',
      },
    });

    if (assessment.certifiable && !active) {
      const record = await Model.create({
        tenant_id: String(tenantId),
        agentId: String(agentId),
        skillKey: assessment.skillKey,
        status: 'active',
        assessmentSnapshot: {
          criteria: assessment.criteria,
          evaluations: assessment.evaluations,
          score: assessment.score,
          eventCount: assessment.eventCount,
          thresholds: assessmentEngine.DEFAULT_THRESHOLDS,
        },
        evidenceRefs: assessment.evidenceRefs,
        issuedAt: now,
      });
      issued.push(serializeCertification(record));
      logger.info('[learning-core] Certificacao emitida', {
        tenantId,
        agentId: String(agentId),
        skillKey: assessment.skillKey,
      });
    } else if (!assessment.certifiable && active) {
      await active.update({
        status: 'revoked',
        revokedAt: now,
        revokeReason: `drift:${assessment.missingEvidence.join(',')}`.slice(0, 255),
        assessmentSnapshot: {
          criteria: assessment.criteria,
          evaluations: assessment.evaluations,
          score: assessment.score,
          eventCount: assessment.eventCount,
          thresholds: assessmentEngine.DEFAULT_THRESHOLDS,
        },
      });
      revoked.push(serializeCertification(active));
      logger.info('[learning-core] Certificacao revogada por drift', {
        tenantId,
        agentId: String(agentId),
        skillKey: assessment.skillKey,
        missingEvidence: assessment.missingEvidence,
      });
    }
  }

  const activeRows = await Model.findAll({
    where: { tenant_id: String(tenantId), agentId: String(agentId), status: 'active' },
    order: [['issuedAt', 'DESC']],
  });

  return {
    assessments,
    issued,
    revoked,
    active: activeRows.map(serializeCertification),
  };
}

/**
 * Lista certificações do usuário (ativas e revogadas — histórico auditável).
 */
async function listCertifications({ tenantId, agentId }) {
  const Model = getUserCertificationModel();
  const rows = await Model.findAll({
    where: { tenant_id: String(tenantId), agentId: String(agentId) },
    order: [['issuedAt', 'DESC']],
  });
  return rows.map(serializeCertification);
}

module.exports = {
  evaluateCertifications,
  listCertifications,
};
