'use strict';

/**
 * api/services/engineeringMission/missionReportService.js
 *
 * Relatório de auditoria da missão (§38, §39) — o artefato que permite a um auditor EXTERNO
 * responder, sem ler código: qual era a missão original, como foi enriquecida, o que foi
 * inferido, com que fontes, qual versão foi aprovada, se a aprovação foi humana ou automática,
 * qual política a autorizou, quais modelos/fallbacks participaram e por que a execução terminou
 * no estado em que terminou.
 *
 * Nada aqui é narrativo: cada afirmação vem de um registro persistido (versão, aprovação, task,
 * tentativas, reviews, decisões de roteamento).
 */

const compiler = require('./missionCompilerService');
const missionStore = require('./missionStoreService');
const logger = require('../../utils/logger');

function safeJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return value;
}

async function buildMissionReport(missionId) {
  const detail = await compiler.getMissionDetail(missionId);
  if (!detail) return null;

  const versions = await missionStore.listVersions(missionId);
  const approvals = await missionStore.listApprovals(missionId);

  let task = null;
  let attempts = [];
  try {
    const index = require('../../db/models');
    if (detail.linked_task_id) {
      const taskRow = await index.EngineeringTask().findByPk(detail.linked_task_id);
      if (taskRow) {
        task = taskRow.get({ plain: true });
        const attemptRows = await index.EngineeringAttempt().findAll({
          where: { task_id: detail.linked_task_id },
          order: [['attempt_number', 'ASC']],
        });
        attempts = attemptRows.map((a) => {
          const plain = a.get({ plain: true });
          return {
            attemptNumber: plain.attempt_number,
            status: plain.status,
            coderProvider: safeJson(plain.coder_provider),
            coderModel: safeJson(plain.coder_model),
            routingReasonCodes: plain.routing_reason_codes,
            patchValidation: plain.patch_validation,
            failureBundle: plain.failure_bundle,
            startedAt: plain.started_at,
            completedAt: plain.completed_at,
          };
        });
      }
    }
  } catch (err) {
    logger.warn('[missionReport] falha ao carregar execução vinculada', { missionId, error: err.message });
  }

  const reviewRows = [];
  if (attempts.length > 0) {
    try {
      const index = require('../../db/models');
      const rows = await index.EngineeringReview().findAll({
        where: { attempt_id: { [require('sequelize').Op.in]: (await index.EngineeringAttempt().findAll({ where: { task_id: detail.linked_task_id }, attributes: ['id'] })).map((a) => a.get('id')) } },
      });
      for (const r of rows) {
        const plain = r.get({ plain: true });
        reviewRows.push({
          reviewerProvider: plain.reviewer_provider,
          reviewerModel: plain.reviewer_model,
          decision: plain.decision,
          independentOfCoder: plain.independent_of_coder,
          findings: plain.findings,
        });
      }
    } catch (err) {
      logger.warn('[missionReport] falha ao carregar reviews', { missionId, error: err.message });
    }
  }

  return {
    artifactType: 'engineering-mission-report',
    generatedAt: new Date().toISOString(),
    mission: {
      id: detail.id,
      title: detail.title,
      status: detail.status,
      displayStatus: detail.displayStatus,
      missionType: detail.mission_type,
      risk: detail.risk,
      scope: detail.scope,
      repository: detail.repository,
      branch: detail.branch,
      createdBy: detail.created_by,
      createdAt: detail.created_at,
      startedAt: detail.started_at,
      completedAt: detail.completed_at,
      iteration: detail.iteration,
      failure: detail.failure,
    },
    originalMission: {
      text: detail.original_mission,
      hash: detail.original_mission_hash,
      // Prova de imutabilidade: todas as versões carregam a MESMA intenção original.
      preservedAcrossVersions: versions.every((v) => v.original_mission === detail.original_mission),
      versionsCount: versions.length,
    },
    enrichment: {
      current: detail.enrichment || {},
      preview: detail.preview || {},
      contextSources: detail.context_sources || [],
      subsystems: detail.subsystems || [],
      modelSelection: detail.enrichment?.modelSelection || null,
      degraded: detail.enrichment?.degraded || [],
    },
    versions: versions.map((v) => ({
      version: v.version,
      specHash: v.spec_hash,
      materiality: v.materiality,
      materialityReasons: v.materiality_reasons,
      event: v.event,
      note: v.note,
      createdAt: v.created_at,
      createdBy: v.created_by,
      diff: v.diff,
      spec: v.spec,
    })),
    approvals: approvals.map((a) => ({
      state: a.state,
      mode: a.mode,
      specVersion: a.spec_version,
      specHash: a.spec_hash,
      policyId: a.policy_id,
      policySnapshot: a.policy_snapshot,
      rulesEvaluated: a.rules_evaluated,
      blockers: a.blockers,
      enrichmentDiff: a.enrichment_diff,
      reason: a.decision_reason,
      actor: a.actor,
      decidedAt: a.decided_at,
    })),
    execution: {
      taskId: detail.linked_task_id,
      taskIds: detail.linked_task_ids || [],
      taskStatus: task ? task.status : null,
      taskType: task ? task.task_type : null,
      requiredCapabilities: task ? task.required_capabilities : null,
      allowedPaths: task ? task.allowed_paths : null,
      routingDecision: task ? task.routing_decision : null,
      attempts,
      reviews: reviewRows,
      lastError: task ? task.last_error : null,
    },
    trace: {
      missionId: detail.id,
      missionVersion: detail.current_version,
      specHash: detail.current_spec_hash,
    },
  };
}

async function listMissionReports({ limit = 50 } = {}) {
  const missions = await missionStore.listMissions({ limit });
  return missions.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    missionType: m.mission_type,
    risk: m.risk,
    currentVersion: m.current_version,
    approvalState: m.approval_state,
    createdAt: m.created_at,
    completedAt: m.completed_at,
  }));
}

module.exports = {
  buildMissionReport,
  listMissionReports,
};
