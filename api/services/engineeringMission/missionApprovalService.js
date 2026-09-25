'use strict';

/**
 * api/services/engineeringMission/missionApprovalService.js
 *
 * Aprovação/rejeição/edição/re-enriquecimento de missões — a etapa formal que existe ENTRE o
 * enriquecimento e a execução.
 *
 * Invariantes:
 *   - aprovar congela (versão, hash) e libera execução SOMENTE daquela versão;
 *   - rejeitar é decisão registrada, nunca silenciosa;
 *   - editar cria uma NOVA versão (nunca mutação da versão anterior) e classifica materialidade;
 *   - re-enriquecer gera novo diff e reaplica a política de aprovação;
 *   - aprovar duas vezes é idempotente (uma decisão por (versão, estado));
 *   - autoaprovação NUNCA é concedida por esta camada — só pela política, no compilador.
 */

const { evaluateAutoApproval } = require('../../../engine/engineeringMission/autoApprovalPolicy');
const { classifyMateriality } = require('../../../engine/engineeringMission/materiality');
const { buildEnrichmentPreview } = require('../../../engine/engineeringMission/missionPreview');
const { createNextVersion, diffSpecs, assertExecutableVersion, computeSpecHash } = require('../../../engine/engineeringMission/missionSpec');
const { MISSION_FAILURE_CODES } = require('../../../engine/engineeringMission/constants');
const missionStore = require('./missionStoreService');
const policyAuthority = require('./missionPolicyAuthority');
const compiler = require('./missionCompilerService');
const { emitMissionStage } = require('./missionEvents');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function requireMission(missionId) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) throw Object.assign(new Error(`mission ${missionId} não encontrada`), { code: 'not_found' });
  return mission;
}

/**
 * Aprova a versão CORRENTE. Aprovar uma versão antiga é impossível por construção: a aprovação
 * referencia sempre `mission.current_version` no momento da decisão.
 */
async function approve(missionId, { actor = null, reason = null, tenantId = 'system', idempotencyKey = null } = {}) {
  const mission = await requireMission(missionId);
  if (mission.status === 'REJECTED') throw fail(MISSION_FAILURE_CODES.MISSION_REJECTED, 'mission rejeitada não pode ser aprovada — crie uma nova missão ou re-enriqueça');
  const current = await missionStore.getCurrentVersion(missionId);
  if (!current) throw fail(MISSION_FAILURE_CODES.MISSION_SPEC_NOT_APPROVED, 'mission ainda não foi enriquecida (sem MissionSpec)');

  const existing = await missionStore.getApproval(missionId, current.version);
  if (existing && existing.state === 'APPROVED') {
    return { approval: existing, mission: await compiler.getMissionDetail(missionId), created: false };
  }

  const { approval, created } = await missionStore.saveApproval({
    missionId,
    specVersion: current.version,
    specHash: current.spec_hash,
    state: 'APPROVED',
    mode: 'MANUAL',
    policyId: null,
    policySnapshot: {},
    rulesEvaluated: ['HUMAN_APPROVAL'],
    blockers: [],
    enrichmentDiff: current.diff || [],
    reason: reason || 'aprovada por decisão humana explícita',
    actor,
    idempotencyKey: idempotencyKey || `approve:${missionId}:v${current.version}`,
  });

  await missionStore.updateMission(missionId, { status: 'APPROVED', approval_state: 'APPROVED', approval_mode: 'MANUAL' });
  await missionStore.mergeMissionJson(missionId, { resume: { phase: 'APPROVED', approvedAt: new Date().toISOString(), approvedBy: actor } });

  const detail = await compiler.getMissionDetail(missionId);
  emitMissionStage(tenantId, missionId, {
    stage: 'APPROVED',
    status: 'success',
    phase: 'APPROVAL',
    missionVersion: current.version,
    approvalMode: 'MANUAL',
    displayStatus: detail.displayStatus,
    message: `missão aprovada por ${actor || 'operador'}`,
  });
  return { approval, mission: detail, created };
}

async function reject(missionId, { actor = null, reason = null, tenantId = 'system' } = {}) {
  const mission = await requireMission(missionId);
  const current = await missionStore.getCurrentVersion(missionId);
  if (!current) throw fail(MISSION_FAILURE_CODES.MISSION_SPEC_NOT_APPROVED, 'mission ainda não foi enriquecida');

  const { approval } = await missionStore.saveApproval({
    missionId,
    specVersion: current.version,
    specHash: current.spec_hash,
    state: 'REJECTED',
    mode: 'MANUAL',
    policyId: null,
    policySnapshot: {},
    rulesEvaluated: ['HUMAN_REJECTION'],
    blockers: [],
    enrichmentDiff: current.diff || [],
    reason: reason || 'rejeitada por decisão humana explícita',
    actor,
    idempotencyKey: `reject:${missionId}:v${current.version}`,
  });
  await missionStore.updateMission(missionId, { status: 'REJECTED', approval_state: 'REJECTED' });
  const detail = await compiler.getMissionDetail(missionId);
  emitMissionStage(tenantId, missionId, {
    stage: 'REJECTED',
    status: 'error',
    phase: 'APPROVAL',
    missionVersion: current.version,
    displayStatus: detail.displayStatus,
    message: reason || 'missão rejeitada',
  });
  return { approval, mission: detail };
}

/**
 * Edição humana da MissionSpec: cria nova versão, classifica materialidade, reavalia política e,
 * por decisão explícita do operador, aprova a versão resultante.
 * `originalMission` continua intocável (o patch que tente alterá-la falha alto).
 */
async function editAndApprove(missionId, { patch = {}, actor = null, reason = null, tenantId = 'system', approveEdited = true, policyEscalationAuthorized = false } = {}) {
  const mission = await requireMission(missionId);
  const current = await missionStore.getCurrentVersion(missionId);
  if (!current) throw fail(MISSION_FAILURE_CODES.MISSION_SPEC_NOT_APPROVED, 'mission ainda não foi enriquecida');

  const nextSpec = createNextVersion(current.spec, patch);
  const changes = diffSpecs(current.spec, nextSpec);
  const materiality = classifyMateriality({
    previousSpec: current.spec,
    nextSpec,
    enrichment: current.enrichment || {},
    changes,
  });

  // AUTORIDADE ÚNICA: antes este caminho usava a política GLOBAL pura e ignorava a política
  // declarada pela missão — a decisão de editar/aprovar era tomada sob política diferente da que
  // o preview exibiu ao operador. Agora resolve igual ao compilador (recusa explícita).
  const policyResolution = await policyAuthority.resolvePolicyForMission({
    mission,
    actor,
    policyEscalationAuthorized: policyEscalationAuthorized === true,
  });
  const effectivePolicy = policyAuthority.requireAuthorizedPolicy(policyResolution, missionId);
  const autoApproval = evaluateAutoApproval({
    policy: effectivePolicy,
    spec: nextSpec,
    enrichment: { ...(current.enrichment || {}), derivedRequirements: nextSpec.derivedRequirements, risk: nextSpec.risk, confidence: nextSpec.confidence, missionType: nextSpec.missionType },
    repository: nextSpec.repository,
    branch: nextSpec.branch,
  });

  const preview = buildEnrichmentPreview({
    spec: nextSpec,
    enrichment: { ...(current.enrichment || {}), provenance: current.enrichment?.provenance || [] },
    previousSpec: current.spec,
    changes,
    materiality,
    autoApproval,
  });
  preview.policyResolution = policyResolution;

  await missionStore.saveVersion({
    missionId,
    spec: nextSpec,
    enrichment: current.enrichment || {},
    materiality: materiality.level,
    materialityReasons: materiality.reasons,
    changes,
    event: 'MATERIAL_CHANGE_APPLIED',
    note: reason || 'edição humana da MissionSpec',
    createdBy: actor,
  });
  await missionStore.supersedeApprovalsForOlderVersions(missionId, nextSpec.version);
  await missionStore.updateMission(missionId, {
    status: approveEdited ? 'APPROVED' : 'AWAITING_APPROVAL',
    approval_state: approveEdited ? 'APPROVED' : 'PENDING',
    preview,
  });

  if (!approveEdited) {
    await missionStore.saveApproval({
      missionId,
      specVersion: nextSpec.version,
      specHash: nextSpec.specHash,
      state: 'PENDING',
      mode: 'MANUAL',
      rulesEvaluated: ['HUMAN_EDIT'],
      blockers: autoApproval.blockers,
      enrichmentDiff: changes,
      reason: 'versão editada aguardando aprovação',
      actor,
      idempotencyKey: `pending:${missionId}:v${nextSpec.version}`,
    });
    return { mission: await compiler.getMissionDetail(missionId), materiality };
  }

  const { approval } = await missionStore.saveApproval({
    missionId,
    specVersion: nextSpec.version,
    specHash: nextSpec.specHash,
    state: 'APPROVED',
    mode: 'MANUAL',
    rulesEvaluated: ['HUMAN_EDIT_AND_APPROVE'],
    blockers: [],
    enrichmentDiff: changes,
    reason: reason || 'versão editada e aprovada por decisão humana',
    actor,
    idempotencyKey: `approve:${missionId}:v${nextSpec.version}`,
  });

  const detail = await compiler.getMissionDetail(missionId);
  emitMissionStage(tenantId, missionId, {
    stage: 'EDITED_AND_APPROVED',
    status: 'success',
    phase: 'APPROVAL',
    missionVersion: nextSpec.version,
    displayStatus: detail.displayStatus,
    message: `MissionSpec v${nextSpec.version} editada (materialidade ${materiality.level}) e aprovada`,
  });
  return { approval, mission: detail, materiality };
}

async function reEnrich(missionId, options = {}) {
  return compiler.enrichMission(missionId, { ...options, forceNewVersion: true });
}

/** Avaliação de política para a versão corrente (usada pela UI antes de aprovar). */
async function evaluatePolicyForMission(missionId) {
  const mission = await requireMission(missionId);
  const current = await missionStore.getCurrentVersion(missionId);
  if (!current) return { eligible: false, blockers: [{ code: 'NOT_ENRICHED', detail: 'mission ainda não enriquecida' }] };
  // AUTORIDADE ÚNICA (mesma do compilador). Antes esta função fazia
  // `{ ...policy, ...mission.auto_approval_policy }` — merge ingênuo que aceitava a escalação de
  // privilégio declarada pela missão e exibia ELEGÍVEL justamente o que a execução real recusava
  // com POLICY_ESCALATION_DENIED (UI e execução discordavam).
  const resolution = await policyAuthority.resolvePolicyForMission({
    mission,
    actor: null,
    // A UI não é identidade administrativa: sem RBAC verificado, escalação é NEGADA.
    policyEscalationAuthorized: false,
  });
  const autoApproval = resolution.evaluate({
    spec: current.spec,
    enrichment: current.enrichment || {},
    repository: current.spec.repository,
    branch: current.spec.branch,
  });
  const denialBlocker = policyAuthority.policyDenialBlocker(resolution);
  return {
    ...autoApproval,
    eligible: denialBlocker ? false : autoApproval.eligible,
    blockers: denialBlocker ? [denialBlocker, ...(autoApproval.blockers || [])] : (autoApproval.blockers || []),
    policyResolution: resolution,
  };
}

async function getPolicy() {
  return missionStore.getAutoApprovalPolicy();
}

/**
 * Configuração da política de autoaprovação (administrável, persistida, auditável).
 * `enabled:true` exige modo explícito: nunca habilita autoaprovação "por acidente" num default.
 */
async function setPolicy(policy = {}, { actor = null } = {}) {
  const normalized = { ...policy };
  if (normalized.enabled === true) {
    const mode = normalized.mode || 'MANUAL';
    if (mode === 'MANUAL') {
      throw fail(MISSION_FAILURE_CODES.INVALID_MISSION_TRANSITION, 'política com enabled=true exige mode SAFE_ONLY ou POLICY_BASED (MANUAL nunca autoaprova)');
    }
  }
  return missionStore.setAutoApprovalPolicy(normalized, { actor });
}

/**
 * Verificação usada pelo orquestrador antes de executar — reexportada aqui para que a rota possa
 * responder 409 com a causa exata (versão obsoleta, sem aprovação, aprovação de outra mission,
 * spec adulterada).
 */
async function assertMissionExecutable(missionId) {
  const mission = await requireMission(missionId);
  const current = await missionStore.getCurrentVersion(missionId);
  if (!current) throw fail(MISSION_FAILURE_CODES.MISSION_SPEC_NOT_APPROVED, 'mission não possui MissionSpec corrente');

  // Detecção de ADULTERAÇÃO: o hash é RECOMPUTADO a partir da spec persistida e comparado com o
  // hash registrado. Sem isto, escrever o JSONB da spec sem atualizar `spec_hash` (mutação
  // silenciosa pós-aprovação) passaria despercebido, porque a comparação de versão usaria apenas
  // o campo `spec_hash` — que ninguém tocou.
  const recomputed = computeSpecHash(current.spec);
  if (recomputed !== current.spec_hash) {
    throw fail(
      MISSION_FAILURE_CODES.MISSION_STALE_VERSION,
      'integridade da MissionSpec violada: hash recomputado difere do hash persistido (spec alterada após a gravação)',
    );
  }

  const approval = await missionStore.getExecutionApproval(missionId);
  assertExecutableVersion({
    mission: { id: mission.id },
    approval,
    currentSpec: { version: current.version, specHash: current.spec_hash },
  });
  return { mission, spec: current.spec, approval };
}

module.exports = {
  approve,
  reject,
  editAndApprove,
  reEnrich,
  evaluatePolicyForMission,
  getPolicy,
  setPolicy,
  assertMissionExecutable,
};
