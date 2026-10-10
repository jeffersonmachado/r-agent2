'use strict';

/**
 * Triagem — coleta os fatos medidos e delega a montagem da fila ao módulo PURO
 * (`engine/securityIntel/triageDossier.js`).
 *
 * Fonte única de verdade: o CLI (`security-intel.js triage`) e a API
 * (`GET /api/security-intel/triage`) usam ESTE serviço. Duplicar a coleta criaria
 * duas filas que discordam — exatamente o tipo de divergência que a capacidade
 * existe para eliminar.
 *
 * O que este serviço NÃO faz: decidir. Ele não aplica correção, não cria waiver e
 * não altera a decisão do gate (que é lida do relatório oficial, não recalculada).
 */

const path = require('path');
const fs = require('fs');

const { connect, getSequelize } = require('../../db/sequelize');
const { Op } = require('sequelize');
const getSecurityComponent = require('../../db/models/SecurityComponent');
const getEngineeringMission = require('../../db/models/EngineeringMission');
const { listPatchCandidates } = require('./patchPlanService');
const { getFindingSummary, listFindings, loadPolicy } = require('./vulnerabilityScanService');
const { getLatestAdvisorySyncAge } = require('./securityIntelWorker');
const { consolidatePlansByPackage } = require('../../../engine/securityIntel/patchPlanner');
const { buildTriageDossier } = require('../../../engine/securityIntel/triageDossier');

const ROOT = path.join(__dirname, '..', '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const GATE_REPORT_NAME = 'security-release-gate-report.json';
const MAX_CANDIDATES = 500;
const MAX_FINDINGS_PER_SEVERITY = 500;

/** Lê o relatório oficial do gate. O nome do arquivo vem por parâmetro (leitor puro). */
function readGateReport(reportFileName, reportsDir = REPORTS_DIR) {
  const target = path.join(reportsDir, reportFileName);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

/** Converte a linha persistida do candidato no plano que a consolidação entende. */
function planOf(row) {
  return {
    ...(row.plan || {}),
    ecosystem: row.ecosystem,
    packageName: row.package_name,
    service: row.service,
    currentVersion: row.current_version,
    targetVersion: row.target_version,
    kind: row.kind,
    updateRisk: row.update_risk,
    autonomy: row.autonomy,
    requiresHumanApproval: row.requires_human_approval,
    severity: row.severity,
    kev: row.kev,
    devOnly: row.dev_only,
    advisoryId: row.advisory_id,
  };
}

async function buildTriage({ tenantKey = 'system', now = new Date() } = {}) {
  const policy = loadPolicy({ reload: true });
  const releaseGate = policy.releaseGate || {};

  const candidates = await listPatchCandidates({ tenantKey, limit: MAX_CANDIDATES });
  const plans = candidates.items.map(planOf);
  const consolidated = consolidatePlansByPackage(plans);

  // REMEDIAÇÃO RASTREADA (2026-10-10): o candidato com missão submetida precisa
  // mostrar o ESTADO da correção. Sem isto o operador não distingue "ainda não
  // submeti" de "submeti e a missão falhou" — e a fila sugeria o mesmo comando de
  // novo, como se nada tivesse acontecido.
  const missionIds = [...new Set(candidates.items.map((row) => row.mission_id).filter(Boolean))];
  const missionStatusById = new Map();
  if (missionIds.length > 0) {
    const missionRows = await getEngineeringMission().findAll({
      where: { id: { [Op.in]: missionIds } },
      attributes: ['id', 'status', 'linked_task_id'],
      raw: true,
    });
    for (const row of missionRows) {
      missionStatusById.set(row.id, { status: row.status || null, linkedTaskId: row.linked_task_id || null });
    }
  }

  // Chaves reais por agrupamento: a fila precisa ser EXECUTÁVEL, não um lembrete.
  const keysByGroup = new Map();
  for (const row of candidates.items) {
    const key = `${row.ecosystem || '?'}:${row.package_name}@${row.service || '-'}`;
    if (!keysByGroup.has(key)) {
      keysByGroup.set(key, { candidates: [], findingKeys: [], withoutFixFindingKeys: [], remediations: [] });
    }
    const entry = keysByGroup.get(key);
    entry.candidates.push({
      candidateKey: row.candidate_key,
      findingKey: row.finding_key,
      targetVersion: row.target_version || null,
    });
    entry.findingKeys.push(row.finding_key);
    if (!row.target_version) entry.withoutFixFindingKeys.push(row.finding_key);
    if (row.mission_id) {
      const mission = missionStatusById.get(row.mission_id) || null;
      entry.remediations.push({
        missionId: row.mission_id,
        candidateKey: row.candidate_key,
        targetVersion: row.target_version || null,
        status: mission ? mission.status : null,
        linkedTaskId: mission ? mission.linkedTaskId : null,
        requestedAt: row.mission_requested_at || null,
        requestedBy: row.mission_requested_by || null,
      });
    }
  }

  // Impacto: achado de severidade bloqueante ainda aberto por pacote/serviço.
  // `dev` vem do COMPONENTE (fato por `bom_ref`), nunca de heurística por nome, e
  // achado dev-only só conta como bloqueio quando a política manda bloquear dev.
  const blockingSeverities = releaseGate.blockOnSeverity || [];
  const blockOnDev = releaseGate.blockOnDevDependencies === true;
  if (!getSequelize()) await connect(3, 500);
  const componentRows = await getSecurityComponent().findAll({
    where: { tenant_key: tenantKey },
    attributes: ['bom_ref', 'dev'],
    raw: true,
  });
  const devByBomRef = new Map(componentRows.map((row) => [row.bom_ref, row.dev === true]));

  const blockingCounts = new Map();
  const devOnlyBlockingCounts = new Map();
  for (const severity of blockingSeverities) {
    const page = await listFindings({ tenantKey, severity, limit: MAX_FINDINGS_PER_SEVERITY });
    for (const row of page.items) {
      const key = `${row.package_name}|${row.service || ''}`;
      const isDevOnly = devByBomRef.get(row.component_bom_ref) === true;
      const target = isDevOnly && !blockOnDev ? devOnlyBlockingCounts : blockingCounts;
      target.set(key, (target.get(key) || 0) + 1);
    }
  }

  const groups = consolidated.map((group) => {
    const entry = keysByGroup.get(group.key) || { candidates: [], findingKeys: [], withoutFixFindingKeys: [], remediations: [] };
    // O recomendado é o candidato cujo alvo limpa TODOS os advisories do pacote:
    // mandar missão para o primeiro da lista resolveria só parte e a fila travaria.
    const withTarget = entry.candidates.filter((candidate) => candidate.targetVersion);
    const recommended = withTarget.find((candidate) => candidate.targetVersion === group.recommendedVersion) || null;
    const ordered = recommended
      ? [recommended, ...withTarget.filter((candidate) => candidate !== recommended)]
      : withTarget;
    const packageServiceKey = `${group.packageName}|${group.service || ''}`;
    return {
      ...group,
      candidateKeys: ordered.map((candidate) => candidate.candidateKey),
      recommendedCandidateKey: recommended ? recommended.candidateKey : null,
      findingKeys: entry.findingKeys,
      withoutFixFindingKeys: entry.withoutFixFindingKeys,
      remediations: entry.remediations || [],
      blockingFindingsOpen: blockingCounts.get(packageServiceKey) || 0,
      blockingFindingsDevOnly: devOnlyBlockingCounts.get(packageServiceKey) || 0,
    };
  });

  const findings = await getFindingSummary({ tenantKey });
  const advisoryAgeHours = await getLatestAdvisorySyncAge();
  const staleAfter = policy.advisorySources?.osv?.maxAgeHoursBeforeStale ?? 72;
  const gateReport = readGateReport(GATE_REPORT_NAME);

  return buildTriageDossier({
    groups,
    gate: gateReport
      ? { decision: gateReport.decision || gateReport.status || null, blocking: gateReport.blocking || [], warnings: gateReport.warnings || [] }
      : null,
    findings,
    advisoryBase: {
      ageHours: advisoryAgeHours === null ? null : Math.round(advisoryAgeHours * 100) / 100,
      stale: advisoryAgeHours === null || advisoryAgeHours > staleAfter,
    },
    policy: releaseGate,
    tenantKey,
    now: new Date(now).toISOString(),
  });
}

module.exports = {
  GATE_REPORT_NAME,
  readGateReport,
  planOf,
  buildTriage,
};
