'use strict';

/**
 * patchPlanService — geração e persistência de candidatos de correção e a
 * ponte com o Roteador Engenheiro.
 *
 * Fronteira de responsabilidade (importante):
 *   - Este serviço PLANEJA, persiste a proposta e — quando explicitamente
 *     autorizado — SUBMETE uma missão ao Roteador Engenheiro.
 *   - Ele NUNCA aplica a correção, nunca escreve em manifesto/lockfile e nunca
 *     toca produção. A execução acontece no fluxo normal de missão (aprovação,
 *     ambiente isolado, QA, promoção), que é o caminho auditável da plataforma.
 *   - Candidato de Nível C (mudança MAJOR ou runtime) NÃO gera missão sem
 *     autorização explícita: a missão é criada, no máximo, como proposta.
 */

const logger = require('../../utils/logger');
const { connect, getSequelize } = require('../../db/sequelize');
const getSecurityFinding = require('../../db/models/SecurityFinding');
const getSecurityComponent = require('../../db/models/SecurityComponent');
const getSecurityAdvisory = require('../../db/models/SecurityAdvisory');
const getSecurityPatchCandidate = require('../../db/models/SecurityPatchCandidate');

const {
  planPatch,
  buildPatchMissionSpec,
  rankPlans,
  summarizePlans,
  AUTONOMY,
} = require('../../../engine/securityIntel/patchPlanner');
const { sha256 } = require('../../../engine/securityIntel/componentIdentity');

const UPSERT_CHUNK_SIZE = 500;
const NON_RISK_STATUSES = ['NOT_AFFECTED', 'FALSE_POSITIVE', 'RESOLVED'];

async function ensureConnected() {
  if (getSequelize()) return getSequelize();
  try {
    return await connect(3, 500);
  } catch (error) {
    const wrapped = new Error(`persistence_required:${error.message}`);
    wrapped.code = 'persistence_required';
    throw wrapped;
  }
}

/** Chave do candidato: um plano por (achado + versão de destino). */
function candidateKeyOf(findingKey, targetVersion, kind) {
  return `${findingKey}|${targetVersion || 'no-target'}|${kind}`;
}

/**
 * Gera planos para os achados correntes e persiste os candidatos (idempotente).
 *
 * @param {object} input
 * @param {string} [input.tenantKey]
 * @param {boolean} [input.onlyBlocking]  considerar apenas CRITICAL/HIGH
 * @param {boolean} [input.includeDevOnly]
 * @param {boolean} [input.includeNotApplicable]
 */
async function generatePatchPlans({
  tenantKey = 'system',
  onlyBlocking = false,
  includeDevOnly = false,
  includeNotApplicable = false,
} = {}) {
  await ensureConnected();
  const Finding = getSecurityFinding();
  const Component = getSecurityComponent();
  const Advisory = getSecurityAdvisory();
  const Candidate = getSecurityPatchCandidate();

  const { Op } = require('sequelize');
  const where = { tenant_key: tenantKey, resolved_at: null, status: { [Op.notIn]: NON_RISK_STATUSES } };
  if (onlyBlocking) where.severity = { [Op.in]: ['CRITICAL', 'HIGH'] };

  const findings = await Finding.findAll({ where, raw: true });
  const components = await Component.findAll({
    where: { tenant_key: tenantKey },
    attributes: ['bom_ref', 'ecosystem', 'name', 'version', 'version_class', 'service', 'direct', 'dev', 'built_locally'],
    raw: true,
  });
  const componentByRef = new Map(components.map((row) => [row.bom_ref, row]));
  const advisories = await Advisory.findAll({ attributes: ['advisory_id', 'severity', 'kev'], raw: true });
  const advisoryById = new Map(advisories.map((row) => [row.advisory_id, row]));

  const plans = [];
  for (const finding of findings) {
    const component = componentByRef.get(finding.component_bom_ref) || {};
    if (component.dev === true && !includeDevOnly) continue;
    const advisory = advisoryById.get(finding.advisory_id) || {};
    const plan = planPatch({
      finding: {
        findingKey: finding.finding_key,
        advisoryId: finding.advisory_id,
        severity: finding.severity,
        applicability: finding.applicability,
        packageName: finding.package_name,
        installedVersion: finding.installed_version,
        ecosystem: finding.ecosystem,
        service: finding.service,
        fixedVersions: finding.fixed_versions || [],
        kev: finding.kev === true || advisory.kev === true,
        dev: component.dev === true,
      },
      component: {
        ecosystem: component.ecosystem || finding.ecosystem,
        name: component.name || finding.package_name,
        version: component.version || finding.installed_version,
        versionClass: component.version_class,
        service: component.service || finding.service,
        direct: component.direct,
        dev: component.dev,
        builtLocally: component.built_locally,
      },
    });
    if (plan.kind === 'NOT_APPLICABLE' && !includeNotApplicable) continue;
    plan.candidateKey = candidateKeyOf(finding.finding_key, plan.targetVersion, plan.kind);
    plans.push(plan);
  }

  const ranked = rankPlans(plans);
  const rows = ranked.map((plan) => ({
    tenant_key: tenantKey,
    candidate_key: plan.candidateKey,
    finding_key: plan.findingKey,
    advisory_id: plan.advisoryId,
    ecosystem: plan.ecosystem,
    package_name: plan.packageName,
    service: plan.service,
    current_version: plan.currentVersion,
    target_version: plan.targetVersion,
    kind: plan.kind,
    update_risk: plan.updateRisk,
    autonomy: plan.autonomy,
    requires_human_approval: plan.requiresHumanApproval === true,
    severity: plan.severity,
    kev: plan.kev === true,
    dev_only: plan.devOnly === true,
    status: 'PROPOSED',
    preconditions: plan.preconditions || [],
    rationale: plan.rationale || [],
    plan,
    generated_at: new Date(),
    updated_at: new Date(),
  }));

  let written = 0;
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
    await Candidate.bulkCreate(chunk, {
      updateOnDuplicate: [
        'current_version', 'target_version', 'update_risk', 'autonomy',
        'requires_human_approval', 'severity', 'kev', 'dev_only', 'preconditions',
        'rationale', 'plan', 'generated_at', 'updated_at',
      ],
    });
    written += chunk.length;
  }

  const summary = summarizePlans(ranked);
  logger.info('[SecurityIntel] candidatos de correção gerados', {
    findings: findings.length,
    candidates: written,
    withoutPatch: summary.withoutPatch,
    requiringHumanApproval: summary.requiringHumanApproval,
  });

  return { findings: findings.length, candidates: written, summary, plans: ranked };
}

/** Lista candidatos persistidos. */
async function listPatchCandidates({
  tenantKey = 'system',
  status,
  autonomy,
  severity,
  limit = 100,
  offset = 0,
} = {}) {
  await ensureConnected();
  const Candidate = getSecurityPatchCandidate();
  const where = { tenant_key: tenantKey };
  if (status) where.status = status;
  if (autonomy) where.autonomy = autonomy;
  if (severity) where.severity = severity;
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows, count } = await Candidate.findAndCountAll({
    where,
    order: [['kev', 'DESC'], ['severity', 'ASC'], ['package_name', 'ASC']],
    limit: boundedLimit,
    offset: Math.max(Number(offset) || 0, 0),
  });
  return { total: count, limit: boundedLimit, offset: Math.max(Number(offset) || 0, 0), items: rows };
}

async function getCandidate(candidateKey, { tenantKey = 'system' } = {}) {
  await ensureConnected();
  const Candidate = getSecurityPatchCandidate();
  return Candidate.findOne({ where: { tenant_key: tenantKey, candidate_key: candidateKey } });
}

/**
 * Submete uma missão ao Roteador Engenheiro para o candidato.
 *
 * Segurança de autonomia: candidato que exige aprovação humana (Nível C) só
 * gera missão se `authorizedBy` for declarado — sem isso a chamada é recusada
 * com `patch_candidate_requires_authorization`. Nada é executado aqui.
 */
async function createPatchMission({
  candidateKey,
  tenantKey = 'system',
  actor = null,
  authorizedBy = null,
} = {}) {
  if (!candidateKey) throw new Error('patch_candidate_key_required');
  const candidate = await getCandidate(candidateKey, { tenantKey });
  if (!candidate) {
    const error = new Error('patch_candidate_not_found');
    error.code = 'patch_candidate_not_found';
    throw error;
  }
  if (candidate.mission_id) {
    return { missionId: candidate.mission_id, created: false, reason: 'mission_already_linked' };
  }
  if (candidate.requires_human_approval && !authorizedBy) {
    const error = new Error('patch_candidate_requires_authorization');
    error.code = 'patch_candidate_requires_authorization';
    error.autonomy = candidate.autonomy;
    throw error;
  }

  const spec = buildPatchMissionSpec({
    plan: {
      ...(candidate.plan || {}),
      candidateKey: candidate.candidate_key,
      findingKey: candidate.finding_key,
      advisoryId: candidate.advisory_id,
      packageName: candidate.package_name,
      service: candidate.service,
      currentVersion: candidate.current_version,
      targetVersion: candidate.target_version,
      kind: candidate.kind,
      updateRisk: candidate.update_risk,
      autonomy: candidate.autonomy,
      severity: candidate.severity,
      kev: candidate.kev,
      devOnly: candidate.dev_only,
      preconditions: candidate.preconditions || [],
    },
  });

  const { compileMission } = require('../engineeringMission/missionCompilerService');
  const result = await compileMission(spec.mission, {
    ...spec.options,
    createdBy: actor || 'security-intel',
    tenantId: tenantKey,
    idempotencyKey: `security-intel:${candidate.candidate_key}`,
  });

  const missionId = result?.mission?.id || null;
  await candidate.update({
    mission_id: missionId,
    mission_requested_at: new Date(),
    mission_requested_by: authorizedBy || actor || 'security-intel',
    status: 'MISSION_REQUESTED',
    updated_at: new Date(),
  });

  logger.info('[SecurityIntel] missão de correção submetida ao Roteador Engenheiro', {
    candidateKey: candidate.candidate_key,
    missionId,
    package: candidate.package_name,
    target: candidate.target_version,
    created: result?.created === true,
  });

  return { missionId, created: result?.created === true, candidateKey: candidate.candidate_key, spec };
}

/** Impressão digital do conjunto de planos (comparação entre execuções). */
function fingerprintPlans(plans = []) {
  return sha256(plans.map((plan) => `${plan.packageName}|${plan.currentVersion}|${plan.targetVersion}|${plan.kind}`).sort().join('\n'));
}

module.exports = {
  candidateKeyOf,
  generatePatchPlans,
  listPatchCandidates,
  getCandidate,
  createPatchMission,
  fingerprintPlans,
  AUTONOMY,
};
