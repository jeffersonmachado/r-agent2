'use strict';

/**
 * api/services/engineeringMission/missionStoreService.js
 *
 * Persistência durável do Engineering Mission Compiler. Nenhuma fase da missão vive apenas na
 * memória do processo: crash, kill -9, restart de container ou de worker não podem obrigar a
 * missão a recomeçar do zero (requisito de DURABLE EXECUTION).
 *
 * Regras fixas desta camada:
 *   - sem fallback em memória (convenção do projeto): falha de DB ⇒ erro `persistence_required`;
 *   - escritas idempotentes: a mesma operação repetida após restart não duplica efeito
 *     (idempotency_key, unicidades de versão/aprovação e "find-or-create" explícito);
 *   - `original_mission` nunca é alterável por UPDATE — a única escrita é na criação.
 */

const { Op } = require('sequelize');
const { sha256 } = require('../../../engine/engineeringMission/missionSpec');
const { DEFAULT_POLICY } = require('../../../engine/engineeringMission/autoApprovalPolicy');
const logger = require('../../utils/logger');

const LOCK_STALE_MS = Number(process.env.ENGINEERING_MISSION_LOCK_STALE_MS || 15 * 60 * 1000);
const SETTINGS_ID = 'default';

function models() {
  // require tardio: evita ciclo de inicialização com o índice de models.
  const index = require('../../db/models');
  return {
    Mission: index.EngineeringMission(),
    Version: index.EngineeringMissionVersion(),
    Approval: index.EngineeringMissionApproval(),
    Settings: index.EngineeringMissionSettings(),
  };
}

function persistenceRequired(detail) {
  const err = new Error(`persistence_required: ${detail}`);
  err.code = 'persistence_required';
  return err;
}

function toPlain(row) {
  return row && row.get ? row.get({ plain: true }) : row;
}

function isUniqueViolation(err) {
  return err && (err.name === 'SequelizeUniqueConstraintError' || err.parent?.code === '23505' || /unique/i.test(err.message || ''));
}

// ── Política de autoaprovação (instalação) ─────────────────────────────────────────────────────

/**
 * Lê a política persistida. Sem linha persistida ⇒ DEFAULT fail-closed (`enabled:false`,
 * modo MANUAL). Nunca inventa política habilitada.
 */
async function getAutoApprovalPolicy() {
  const { Settings } = models();
  try {
    const row = await Settings.findByPk(SETTINGS_ID);
    if (!row) return { ...DEFAULT_POLICY };
    return { ...DEFAULT_POLICY, ...(toPlain(row).auto_approval_policy || {}) };
  } catch (err) {
    // Ler política é pré-requisito para decidir execução autônoma: falha de DB aqui NÃO pode
    // virar "política habilitada". Fail-closed + diagnóstico explícito.
    logger.warn('[missionStore] falha ao ler política de autoaprovação; usando DEFAULT fail-closed', { error: err.message });
    return { ...DEFAULT_POLICY };
  }
}

async function setAutoApprovalPolicy(policy = {}, { actor = null } = {}) {
  const { Settings } = models();
  const merged = { ...DEFAULT_POLICY, ...policy };
  const [row, created] = await Settings.findOrCreate({
    where: { id: SETTINGS_ID },
    defaults: { id: SETTINGS_ID, auto_approval_policy: merged, updated_by: actor },
  });
  if (!created) await row.update({ auto_approval_policy: merged, updated_by: actor });
  return merged;
}

// ── Mission ───────────────────────────────────────────────────────────────────────────────────

async function createMission(input = {}) {
  const { Mission } = models();
  if (!input.originalMission || !String(input.originalMission).trim()) {
    const err = new Error('createMission: originalMission é obrigatório');
    err.code = 'MISSION_ORIGINAL_MISSION_REQUIRED';
    throw err;
  }
  const idempotencyKey = input.idempotencyKey || null;
  if (idempotencyKey) {
    const existing = await Mission.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return { mission: toPlain(existing), created: false };
  }
  try {
    const row = await Mission.create({
      title: input.title || String(input.originalMission).slice(0, 120),
      original_mission: input.originalMission,
      original_mission_hash: sha256(String(input.originalMission)),
      mission_type: input.missionType || 'INVESTIGATION',
      repository: input.repository || null,
      branch: input.branch || null,
      scope: input.scope || null,
      risk: input.risk || 'MEDIUM',
      status: 'CREATED',
      current_version: 0,
      approval_mode: input.approvalMode || 'MANUAL',
      auto_approval_policy: input.autoApprovalPolicy || {},
      constraints: input.constraints || [],
      classification: 'DEVELOPMENT',
      created_by: input.createdBy || null,
      parent_mission_id: input.parentMissionId || null,
      idempotency_key: idempotencyKey,
    });
    return { mission: toPlain(row), created: true };
  } catch (err) {
    if (isUniqueViolation(err) && idempotencyKey) {
      const existing = await Mission.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) return { mission: toPlain(existing), created: false };
    }
    throw persistenceRequired(`falha ao criar mission: ${err.message}`);
  }
}

async function getMission(id) {
  const { Mission } = models();
  const row = await Mission.findByPk(id);
  return row ? toPlain(row) : null;
}

async function listMissions({ status, missionType, risk, limit = 50, offset = 0 } = {}) {
  const { Mission } = models();
  const where = {};
  if (status) where.status = status;
  if (missionType) where.mission_type = missionType;
  if (risk) where.risk = risk;
  const rows = await Mission.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  });
  return rows.map(toPlain);
}

/**
 * Update guardado: `original_mission` e `original_mission_hash` são imutáveis.
 */
async function updateMission(id, patch = {}) {
  const { Mission } = models();
  const row = await Mission.findByPk(id);
  if (!row) return null;
  if (Object.prototype.hasOwnProperty.call(patch, 'original_mission')
    && patch.original_mission !== row.get('original_mission')) {
    const err = new Error('originalMission é imutável — nenhuma fase pode reescrever a intenção do usuário');
    err.code = 'ORIGINAL_MISSION_MUTATED';
    throw err;
  }
  const safePatch = { ...patch };
  delete safePatch.original_mission;
  delete safePatch.original_mission_hash;
  await row.update(safePatch);
  return toPlain(row);
}

/** Campos JSONB acumulativos: merge em vez de sobrescrever cegamente. */
async function mergeMissionJson(id, { resume = null, enrichment = null, preview = null } = {}) {
  const current = await getMission(id);
  if (!current) return null;
  const patch = {};
  if (resume) patch.resume_metadata = { ...(current.resume_metadata || {}), ...resume };
  if (enrichment) patch.enrichment = { ...(current.enrichment || {}), ...enrichment };
  if (preview) patch.preview = { ...(current.preview || {}), ...preview };
  return updateMission(id, patch);
}

// ── Lock de concorrência (múltiplos workers) ───────────────────────────────────────────────────

/**
 * O lock pertence a um processo que não existe mais? O id do worker do compilador carrega o PID
 * (`mission-compiler-<pid>`), o que permite distinguir "outro worker vivo está trabalhando"
 * (fail-closed: não mexer) de "o worker que travou morreu num crash" (lock é lixo, pode ser
 * tomado imediatamente). Sem isso, um crash recente deixava a missão bloqueada até o stale
 * timeout inteiro — e a missão só seria retomada 15 minutos depois, sem necessidade.
 */
function lockOwnerIsDead(lockedBy) {
  const match = /^mission-compiler-(\d+)$/.exec(String(lockedBy || ''));
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false; // processo existe (ou pertence a outro usuário — tratado como vivo)
  } catch (err) {
    return err.code === 'ESRCH';
  }
}

/**
 * Adquire o lock da mission de forma ATÔMICA (UPDATE condicional). Dois workers nunca trabalham
 * na mesma missão: o perdedor recebe MISSION_LOCKED_BY_OTHER_WORKER em vez de executar em
 * duplicidade. Lock órfão expira por stale timeout OU é tomado na hora quando o dono morreu.
 */
async function lockMission(id, workerId) {
  const { Mission } = models();
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const [affected] = await Mission.update(
    { locked_at: new Date(), locked_by: workerId },
    {
      where: {
        id,
        [Op.or]: [
          { locked_at: null },
          { locked_at: { [Op.lt]: staleBefore } },
          { locked_by: workerId },
        ],
      },
    },
  );
  if (affected > 0) return getMission(id);

  const current = await getMission(id);
  if (!current) return null;

  if (lockOwnerIsDead(current.locked_by)) {
    // Takeover CAS: só assume se o dono ainda for o processo morto (nunca rouba de um worker
    // que acabou de assumir).
    const [takenOver] = await Mission.update(
      { locked_at: new Date(), locked_by: workerId },
      { where: { id, locked_by: current.locked_by } },
    );
    if (takenOver > 0) {
      logger.warn('[missionStore] lock de worker morto assumido por retomada', {
        missionId: id, deadWorker: current.locked_by, workerId,
      });
      return getMission(id);
    }
  }

  const err = new Error(`mission ${id} está travada por outro worker (${current.locked_by})`);
  err.code = 'MISSION_LOCKED_BY_OTHER_WORKER';
  err.lockedBy = current.locked_by;
  throw err;
}

async function unlockMission(id, workerId) {
  const { Mission } = models();
  const where = workerId ? { id, locked_by: workerId } : { id };
  await Mission.update({ locked_at: null, locked_by: null }, { where });
}

/** Missões não terminais — insumo do resume durável após restart. */
async function findResumableMissions({ limit = 50 } = {}) {
  const { Mission } = models();
  const rows = await Mission.findAll({
    where: { status: { [Op.in]: ['CREATED', 'ENRICHING', 'APPROVED', 'EXECUTING'] } },
    order: [['updated_at', 'ASC']],
    limit,
  });
  return rows.map(toPlain);
}

async function linkTask({ missionId, taskId }) {
  const current = await getMission(missionId);
  if (!current) return null;
  const ids = Array.isArray(current.linked_task_ids) ? [...current.linked_task_ids] : [];
  if (!ids.includes(taskId)) ids.push(taskId);
  const iteration = ids.length;
  return updateMission(missionId, {
    linked_task_id: taskId,
    linked_task_ids: ids,
    iteration,
    started_at: current.started_at || new Date(),
  });
}

// ── Versões de MissionSpec ────────────────────────────────────────────────────────────────────

/**
 * Grava uma versão. Idempotente por `(mission_id, version)` e por `(mission_id, spec_hash)`:
 * dois workers concorrentes produzindo a MESMA spec resultam em UMA linha, nunca em divergência.
 */
async function saveVersion({ missionId, spec, enrichment = {}, materiality = 'MATERIAL', materialityReasons = [], changes = [], event = 'ENRICHED', note = null, createdBy = null }) {
  const { Version, Mission } = models();
  const mission = await getMission(missionId);
  if (!mission) throw persistenceRequired(`mission ${missionId} não existe`);
  if (spec.originalMission !== mission.original_mission) {
    const err = new Error('originalMission da versão diverge da intenção original persistida');
    err.code = 'ORIGINAL_MISSION_MUTATED';
    throw err;
  }
  try {
    const row = await Version.create({
      mission_id: missionId,
      version: spec.version,
      original_mission: spec.originalMission,
      spec,
      spec_hash: spec.specHash,
      materiality,
      materiality_reasons: materialityReasons,
      enrichment,
      diff: changes,
      event,
      note,
      created_by: createdBy,
    });
    await Mission.update(
      {
        current_version: spec.version,
        current_spec_hash: spec.specHash,
        mission_type: spec.missionType || mission.mission_type,
        objective: spec.objective || mission.objective,
        enriched_mission: spec.objective || mission.enriched_mission,
        risk: spec.risk || mission.risk,
        scope: spec.scope || mission.scope,
        branch: spec.branch || mission.branch,
        enrichment_confidence: spec.confidence === null || spec.confidence === undefined ? mission.enrichment_confidence : spec.confidence,
        context_sources: spec.contextSources || [],
        subsystems: spec.subsystems || [],
        enrichment,
      },
      { where: { id: missionId } },
    );
    return toPlain(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await Version.findOne({ where: { mission_id: missionId, version: spec.version } });
      if (existing) return toPlain(existing);
    }
    throw persistenceRequired(`falha ao gravar versão ${spec.version}: ${err.message}`);
  }
}

async function getVersion(missionId, version) {
  const { Version } = models();
  const row = await Version.findOne({ where: { mission_id: missionId, version } });
  return row ? toPlain(row) : null;
}

async function getCurrentVersion(missionId) {
  const mission = await getMission(missionId);
  if (!mission || !mission.current_version) return null;
  return getVersion(missionId, mission.current_version);
}

async function listVersions(missionId) {
  const { Version } = models();
  const rows = await Version.findAll({ where: { mission_id: missionId }, order: [['version', 'ASC']] });
  return rows.map(toPlain);
}

// ── Aprovações ────────────────────────────────────────────────────────────────────────────────

const APPROVAL_PRIORITY = ['APPROVED', 'AUTO_APPROVED', 'REJECTED', 'PENDING', 'SUPERSEDED'];

/**
 * Registra a decisão vigente de uma versão. Modelo: UMA linha por (mission, versão); decisões
 * sucessivas (ex.: PENDING→APPROVED, APPROVED→REJECTED) atualizam a linha e MANTÊM o histórico
 * anterior em `history` (append-only) — nenhuma decisão é apagada e nenhuma versão acumula duas
 * decisões simultâneas. Idempotente por `idempotencyKey` e por estado já vigente.
 */
async function saveApproval({
  missionId,
  specVersion,
  specHash,
  state,
  mode = 'MANUAL',
  policyId = null,
  policySnapshot = {},
  rulesEvaluated = [],
  blockers = [],
  enrichmentDiff = [],
  reason = null,
  actor = null,
  idempotencyKey = null,
}) {
  const { Approval } = models();
  if (idempotencyKey) {
    const existingByKey = await Approval.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existingByKey) return { approval: toPlain(existingByKey), created: false };
  }

  const existing = await Approval.findOne({ where: { mission_id: missionId, spec_version: specVersion } });
  const decided = state === 'PENDING' ? null : new Date();

  if (existing) {
    if (existing.get('state') === state) return { approval: toPlain(existing), created: false };
    const previous = toPlain(existing);
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    history.push({
      state: previous.state,
      actor: previous.actor,
      reason: previous.decision_reason,
      blockers: previous.blockers,
      at: previous.decided_at || previous.updated_at,
    });
    await existing.update({
      state,
      spec_hash: specHash,
      mode,
      policy_id: policyId,
      policy_snapshot: policySnapshot,
      rules_evaluated: rulesEvaluated,
      blockers,
      enrichment_diff: enrichmentDiff,
      decision_reason: reason,
      actor,
      idempotency_key: idempotencyKey || existing.get('idempotency_key'),
      decided_at: decided || existing.get('decided_at'),
      history,
    });
    return { approval: toPlain(existing), created: false, supersededPreviousState: previous.state };
  }

  try {
    const row = await Approval.create({
      mission_id: missionId,
      spec_version: specVersion,
      spec_hash: specHash,
      state,
      mode,
      policy_id: policyId,
      policy_snapshot: policySnapshot,
      rules_evaluated: rulesEvaluated,
      blockers,
      enrichment_diff: enrichmentDiff,
      decision_reason: reason,
      actor,
      idempotency_key: idempotencyKey,
      decided_at: decided,
      history: [],
    });
    return { approval: toPlain(row), created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const found = await Approval.findOne({ where: { mission_id: missionId, spec_version: specVersion } });
      if (found) return { approval: toPlain(found), created: false };
    }
    throw persistenceRequired(`falha ao registrar aprovação: ${err.message}`);
  }
}

/**
 * Aprovação vigente de uma versão: prioriza aprovação válida, depois rejeição, depois pendência.
 * Retorna no shape do BANCO (snake_case) — para consumo de API/relatório.
 */
async function getApproval(missionId, specVersion) {
  const { Approval } = models();
  const rows = await Approval.findAll({ where: { mission_id: missionId, spec_version: specVersion } });
  if (rows.length === 0) return null;
  const plain = rows.map(toPlain);
  for (const state of APPROVAL_PRIORITY) {
    const found = plain.find((a) => a.state === state);
    if (found) return found;
  }
  return plain[0];
}

/**
 * Converte uma aprovação do shape do banco (snake_case) para o CONTRATO do motor puro
 * (`assertExecutableVersion` opera com camelCase). Sem esta conversão, o motor recebe
 * `spec_version`/`mission_id` ausentes e trata uma aprovação válida como inexistente —
 * defeito real observado: `MISSION_APPROVAL_NOT_FOUND` logo após aprovar.
 */
function toEngineApproval(approval) {
  if (!approval) return null;
  return {
    id: approval.id,
    missionId: approval.mission_id,
    specVersion: approval.spec_version,
    specHash: approval.spec_hash,
    state: approval.state,
    mode: approval.mode,
    policyId: approval.policy_id,
    policySnapshot: approval.policy_snapshot,
    rulesEvaluated: approval.rules_evaluated,
    blockers: approval.blockers,
    enrichmentDiff: approval.enrichment_diff,
    reason: approval.decision_reason,
    actor: approval.actor,
    decidedAt: approval.decided_at,
  };
}

/** Aprovação que autoriza execução da versão CORRENTE (ou null), no contrato do motor puro. */
async function getExecutionApproval(missionId) {
  const mission = await getMission(missionId);
  if (!mission || !mission.current_version) return null;
  const approval = await getApproval(missionId, mission.current_version);
  if (!approval || !['APPROVED', 'AUTO_APPROVED'].includes(approval.state)) return null;
  return toEngineApproval(approval);
}

async function listApprovals(missionId) {
  const { Approval } = models();
  const rows = await Approval.findAll({ where: { mission_id: missionId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

/** Marca aprovações de versões anteriores como SUPERSEDED (histórico preservado, nunca apagado). */
async function supersedeApprovalsForOlderVersions(missionId, keepVersion) {
  const { Approval } = models();
  await Approval.update(
    { state: 'SUPERSEDED' },
    { where: { mission_id: missionId, spec_version: { [Op.lt]: keepVersion }, state: { [Op.in]: ['APPROVED', 'AUTO_APPROVED', 'PENDING'] } } },
  );
}

module.exports = {
  LOCK_STALE_MS,
  lockOwnerIsDead,
  getAutoApprovalPolicy,
  setAutoApprovalPolicy,
  createMission,
  getMission,
  listMissions,
  updateMission,
  mergeMissionJson,
  lockMission,
  unlockMission,
  findResumableMissions,
  linkTask,
  saveVersion,
  getVersion,
  getCurrentVersion,
  listVersions,
  saveApproval,
  getApproval,
  toEngineApproval,
  getExecutionApproval,
  listApprovals,
  supersedeApprovalsForOlderVersions,
};
