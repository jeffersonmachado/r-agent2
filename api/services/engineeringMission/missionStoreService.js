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
const crypto = require('crypto');
const { sha256 } = require('../../../engine/engineeringMission/missionSpec');
const { DEFAULT_POLICY } = require('../../../engine/engineeringMission/autoApprovalPolicy');
const {
  DEFAULT_LEASE_TTL_MS,
  normalizeLease,
  resolveLeaseState,
  assertWriterAuthorized,
  canAcquire,
} = require('../../../engine/engineeringMission/leasePolicy');
const { RESUMABLE_MISSION_STATES } = require('../../../engine/engineeringMission/constants');
const progressPolicy = require('../../../engine/engineeringMission/progressPolicy');
const logger = require('../../utils/logger');

// TTL do lease de missão: política `LEASE` do registry (clampada), com o override histórico
// `ENGINEERING_MISSION_LEASE_TTL_MS`. Não existe mais `LOCK_STALE_MS`: idade de `locked_at` não é
// critério de posse.
function resolveMissionLeaseTtlMs() {
  const legacy = Number(process.env.ENGINEERING_MISSION_LEASE_TTL_MS);
  // eslint-disable-next-line global-require
  const { resolvePolicy } = require('../../utils/operationDeadline');
  return resolvePolicy('LEASE', { override: Number.isFinite(legacy) && legacy > 0 ? legacy : null }).resolved;
}
const LEASE_TTL_MS = resolveMissionLeaseTtlMs();
const SETTINGS_ID = 'default';

function models() {
  // require tardio: evita ciclo de inicialização com o índice de models.
  const index = require('../../db/models');
  const MissionModel = index.EngineeringMission();
  return {
    sequelize: MissionModel.sequelize,
    Mission: MissionModel,
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

/**
 * Campos JSONB acumulativos: merge em vez de sobrescrever cegamente.
 *
 * Achado real (auditoria V2): esta função aceitava APENAS `resume`/`enrichment`/`preview` e
 * DESCARTava qualquer outra chave em silêncio — a evidência de resolução de política passada pelo
 * compilador simplesmente não era persistida, e nada avisava. Chave desconhecida agora é erro
 * explícito (`MISSION_MERGE_UNKNOWN_KEY`), porque "merge que ignora o que recebeu" é a mesma
 * classe de falha silenciosa que o resto deste módulo existe para impedir.
 */
const MERGE_JSON_KEYS = Object.freeze(['resume', 'enrichment', 'preview', 'policyResolution']);

/**
 * Tentativas do compare-and-swap do merge acumulativo. Valor pequeno de propósito:
 * convergência real acontece em 1–2 rodadas; chegar ao teto significa contenção
 * anômala e deve falhar (MISSION_MERGE_CONFLICT), não insistir indefinidamente.
 */
const MERGE_MAX_TENTATIVAS = 5;

/**
 * Campos acumulativos a partir do estado ATUAL + patch (função pura do merge).
 * Extraída para que o laço de CAS reaplique exatamente a mesma semântica sobre o
 * estado relido.
 */
function montarMergeAcumulativo(current, patch) {
  const { resume = null, enrichment = null, preview = null, policyResolution = null } = patch;
  const out = {};
  if (resume) out.resume_metadata = { ...(current.resume_metadata || {}), ...resume };
  if (enrichment) out.enrichment = { ...(current.enrichment || {}), ...enrichment };
  if (preview) out.preview = { ...(current.preview || {}), ...preview };
  // §21: a resolução de política é EVIDÊNCIA — sobrevive a re-enriquecimento porque vive em
  // resume_metadata, não só no preview que é regerado.
  out.resume_metadata = { ...(current.resume_metadata || {}), ...(out.resume_metadata || {}), ...(policyResolution ? { policyResolution } : {}) };
  return out;
}

/**
 * Merge de JSONB acumulativo com COMPARE-AND-SWAP.
 *
 * DEFEITO MEDIDO (2026-10-20): o merge era read-modify-write puro — `getMission`
 * → monta objeto → `update` incondicional. Duas escritas concorrentes na MESMA
 * missão (o coordenador do Bug Loop gravando `resume.bugLoop.lineage` e o
 * orquestrador/worker gravando `resume.sourceReplan`) partiam do mesmo snapshot;
 * a última gravação vencia com o snapshot ANTIGO e a linha de lineage
 * simplesmente desaparecia. Efeito observado no E2E do Bug Loop: o coordenador
 * registrava `decision=REPLACE_TASK_RESUME_PHASE` com `replacementTaskId` novo
 * (log real) e a missão persistida ficava com a lineage anterior
 * (`replacementTaskId === originalTaskId`), porque outra escrita havia vencido a
 * corrida. Perda de atualização silenciosa é a pior classe aqui: o registro de
 * auditoria existe mas descreve um estado que nunca valeu.
 *
 * Correção: update condicional por `updated_at` (o mesmo padrão de
 * `updateMissionGuarded`, que já usa update com WHERE e checa `affected`). Se
 * outra escrita venceu a corrida, o merge é REAPLICADO sobre o estado relido —
 * escritas em chaves diferentes coexistem; escritas na mesma chave permanecem
 * ordenadas pelo vencedor real. Sem vitória após as tentativas, falha explícita
 * (`MISSION_MERGE_CONFLICT`) em vez de sobrescrever.
 */
async function mergeMissionJson(id, patch = {}, guard = null) {
  const unknown = Object.keys(patch).filter((key) => !MERGE_JSON_KEYS.includes(key));
  if (unknown.length > 0) {
    const err = new Error(`mergeMissionJson recebeu chave(s) não suportada(s): ${unknown.join(', ')}`);
    err.code = 'MISSION_MERGE_UNKNOWN_KEY';
    err.unknownKeys = unknown;
    throw err;
  }
  const { Mission } = models();
  let ultimoConflito = null;
  for (let tentativa = 1; tentativa <= MERGE_MAX_TENTATIVAS; tentativa += 1) {
    const current = await getMission(id);
    if (!current) return null;
    const out = montarMergeAcumulativo(current, patch);
    // Worker com posse (compiler/orquestrador/recovery) grava sob fence; sem guard é escrita
    // administrativa/leitura-reconciliação (mesma semântica de sempre). O caminho guardado já é
    // um update condicional por lease/fence — não precisa do CAS por updated_at.
    if (guard && guard.leaseToken) return updateMissionGuarded(id, out, guard);

    // `underscored: true` no model: o ATRIBUTO é `updatedAt` (coluna updated_at). Usar o
    // nome do atributo é o que o Sequelize mapeia no WHERE.
    const versaoVista = current.updatedAt;
    if (!versaoVista) {
      const err = new Error('mergeMissionJson: missão sem updatedAt — impossível garantir CAS');
      err.code = 'MISSION_MERGE_NO_VERSION';
      throw err;
    }
    const [afetadas] = await Mission.update(out, {
      where: { id, updatedAt: versaoVista },
    });
    if (afetadas === 1) return getMission(id);
    ultimoConflito = { tentativa, updatedAt: versaoVista };
  }
  const err = new Error(
    `merge concorrente em resume/enrichment não convergiu após ${MERGE_MAX_TENTATIVAS} tentativas`
  );
  err.code = 'MISSION_MERGE_CONFLICT';
  err.lastAttempt = ultimoConflito;
  throw err;
}

// ── Lock de concorrência (interface histórica sobre o LEASE) ─────────────────────────────────

/**
 * PID NÃO é autoridade (2026-09-28). Esta função existia para "acelerar" o takeover quando o dono
 * do lock era um processo morto na MESMA máquina (`process.kill(pid, 0)`). Isso não responde
 * "esse worker distribuído ainda é dono da missão?" — dois containers podem ter o mesmo PID, e um
 * worker em outro host tem PID sem significado local. Mantida apenas como DIAGNÓSTICO LOCAL
 * (relatório/log); nenhuma decisão de posse a consulta.
 */
function lockOwnerIsDead(lockedBy) {
  const match = /^mission-compiler-(\d+)$/.exec(String(lockedBy || ''));
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
}

/**
 * Posse de missão para chamadores legados: a AUTORIDADE é o lease (CAS em `acquireMissionLease`,
 * fence+1). Não existe mais takeover por idade de `locked_at` (STALE_BY_AGE_ONLY) nem por PID:
 *   - lease ativo de outro worker ⇒ MISSION_LOCKED_BY_OTHER_WORKER, qualquer que seja a idade;
 *   - lease expirado (heartbeat parou) ⇒ takeover com fence novo;
 *   - lease do próprio worker ⇒ continua.
 */
async function lockMission(id, workerId, { workerType = 'COMPILER', host = null } = {}) {
  const acquired = await acquireMissionLease(id, { workerInstanceId: workerId, workerType, host });
  if (acquired.acquired) {
    const mission = await getMission(id);
    return mission ? { ...mission, lease: acquired.lease } : null;
  }
  if (acquired.reason === 'MISSION_NOT_FOUND') return null;
  const current = await getMission(id);
  const err = new Error(`mission ${id} está travada por outro worker (${current?.lease_worker_instance_id || current?.locked_by || 'desconhecido'}) — lease ${acquired.lease ? resolveLeaseState(acquired.lease, Date.now()) : 'n/d'}`);
  err.code = 'MISSION_LOCKED_BY_OTHER_WORKER';
  err.lockedBy = current?.locked_by || null;
  err.leaseWorkerInstanceId = acquired.lease?.workerInstanceId || null;
  err.leaseState = acquired.lease ? resolveLeaseState(acquired.lease, Date.now()) : null;
  throw err;
}

async function unlockMission(id, workerId, { leaseToken = null } = {}) {
  if (leaseToken) return releaseMissionLease(id, { leaseToken });
  const { Mission } = models();
  const where = workerId ? { id, [Op.or]: [{ locked_by: workerId }, { lease_worker_instance_id: workerId }] } : { id };
  await Mission.update({
    locked_at: null, locked_by: null, lease_token: null, lease_expires_at: null, lease_heartbeat_at: null,
    lease_worker_instance_id: null, lease_worker_type: null, lease_host: null,
  }, { where });
  return true;
}

// ── LEASE DISTRIBUÍDO (§30–§32) ────────────────────────────────────────────────────────────────
//
// Por que isto existe (achado real da auditoria V2): a autoridade de "worker vivo" era
// `process.kill(pid, 0)`. PID não é identidade global — dois containers podem compartilhar PID e
// uma instância em outra máquina tem PID sem significado local. Sem fencing, um worker antigo
// podia voltar depois de perder o trabalho e gravar por cima do worker novo. O lease resolve as
// duas coisas: identidade de INSTÂNCIA + validade temporal (takeover) + fencing token monotônico
// (escrita). `process.kill` permanece só como otimização local de diagnóstico.

/**
 * Adquire (ou renova, se já for do mesmo worker) o lease da missão — CAS atômico no banco.
 *
 * A condição do UPDATE é a própria regra de takeover: livre, expirado, ou do próprio worker.
 * `lease_fence` só cresce, então um worker que perdeu o lease tem fence desatualizado e suas
 * escritas passam a ser rejeitadas por `updateMissionGuarded`.
 */
async function acquireMissionLease(missionId, { workerInstanceId, workerType = 'COMPILER', host = null, ttlMs = LEASE_TTL_MS } = {}) {
  if (!workerInstanceId) {
    const err = new Error('workerInstanceId é obrigatório para adquirir lease');
    err.code = 'MISSION_LEASE_WORKER_REQUIRED';
    throw err;
  }
  const { sequelize } = models();
  const token = crypto.randomUUID();
  const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));
  // QueryTypes.SELECT devolve a LISTA de linhas; o RETURNING tem uma única linha.
  const [row] = await sequelize.query(
    `UPDATE engineering_missions
        SET lease_worker_instance_id = :workerInstanceId,
            lease_worker_type = :workerType,
            lease_host = :host,
            lease_token = :token,
            lease_fence = lease_fence + 1,
            lease_acquired_at = NOW(),
            lease_expires_at = NOW() + make_interval(secs => :ttlSeconds),
            lease_heartbeat_at = NOW(),
            locked_at = NOW(),
            locked_by = :legacyWorkerId,
            updated_at = NOW()
      WHERE id = :missionId
        AND status NOT IN ('GREEN', 'FAILED', 'BLOCKED', 'DEGRADED', 'REJECTED', 'CANCELLED')
        AND (lease_token IS NULL OR lease_expires_at <= NOW() OR lease_worker_instance_id = :workerInstanceId)
      RETURNING lease_token, lease_fence, lease_expires_at, lease_worker_instance_id, lease_acquired_at, lease_heartbeat_at`,
    {
      replacements: {
        missionId, workerInstanceId, workerType, host, token, ttlSeconds,
        legacyWorkerId: `${String(workerType).toLowerCase()}-${workerInstanceId}`,
      },
      type: sequelize.constructor.QueryTypes.SELECT,
    },
  );
  if (!row) {
    const current = await getMission(missionId);
    if (!current) return { acquired: false, reason: 'MISSION_NOT_FOUND', lease: null };
    const lease = normalizeLease(current);
    return {
      acquired: false,
      reason: resolveLeaseState(lease, Date.now()) === 'ACTIVE' ? 'MISSION_LEASE_HELD_BY_OTHER_WORKER' : 'MISSION_TERMINAL_OR_UNKNOWN',
      lease,
    };
  }
  return {
    acquired: true,
    lease: normalizeLease({
      lease_token: row.lease_token,
      lease_fence: row.lease_fence,
      lease_expires_at: row.lease_expires_at,
      lease_worker_instance_id: row.lease_worker_instance_id,
      lease_acquired_at: row.lease_acquired_at,
      lease_heartbeat_at: row.lease_heartbeat_at,
    }),
  };
}

/**
 * Heartbeat: renova a validade do PRÓPRIO lease. Perder o lease é falha explícita
 * (`MISSION_LEASE_LOST`) — o worker não pode continuar trabalhando "achando" que tem o lease.
 */
async function renewMissionLease(missionId, { leaseToken, ttlMs = LEASE_TTL_MS } = {}) {
  const { sequelize } = models();
  const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));
  const [row] = await sequelize.query(
    `UPDATE engineering_missions
        SET lease_expires_at = NOW() + make_interval(secs => :ttlSeconds),
            lease_heartbeat_at = NOW(),
            updated_at = NOW()
      WHERE id = :missionId AND lease_token = :leaseToken AND lease_expires_at > NOW()
      RETURNING lease_token, lease_fence, lease_expires_at, lease_heartbeat_at`,
    {
      replacements: { missionId, leaseToken, ttlSeconds },
      type: sequelize.constructor.QueryTypes.SELECT,
    },
  );
  if (!row) {
    const err = new Error(`lease da missão ${missionId} não está mais ativo para este worker`);
    err.code = 'MISSION_LEASE_LOST';
    throw err;
  }
  return normalizeLease(row);
}

/**
 * Libera o lease (fim de fase / fim de trabalho). O `lease_fence` NÃO é zerado — fence monotônico
 * é o que impede um worker antigo de "reentrar" com credencial vencida.
 */
async function releaseMissionLease(missionId, { leaseToken } = {}) {
  const { Mission } = models();
  const where = leaseToken ? { id: missionId, lease_token: leaseToken } : { id: missionId };
  const [affected] = await Mission.update(
    {
      lease_token: null,
      lease_expires_at: null,
      lease_heartbeat_at: null,
      lease_worker_instance_id: null,
      lease_worker_type: null,
      lease_host: null,
      locked_at: null,
      locked_by: null,
    },
    { where },
  );
  return affected > 0;
}

/** Lease atual (shape normalizado) — usado por recovery, relatório e guarda de escrita. */
async function getMissionLease(missionId) {
  const mission = await getMission(missionId);
  if (!mission) return null;
  return normalizeLease(mission);
}

/**
 * Escrita de worker com FENCING (§32). Diferente de `updateMission`, esta porta exige que o autor
 * ainda seja o dono do lease vigente: um worker antigo que voltou tarde recebe
 * `MISSION_STALE_WORKER_WRITE` e NÃO consegue sobrescrever o estado da execução atual.
 *
 * ATÔMICA (2026-09-28): a versão anterior fazia um CAS "vazio" (`SET updated_at`) e DEPOIS aplicava
 * o patch com `updateMission` sem guarda — entre as duas instruções outro worker podia assumir e a
 * escrita obsoleta passava. Agora o patch é aplicado NO MESMO UPDATE cujo WHERE prova a posse
 * (token + fence + lease não expirado).
 */
async function updateMissionGuarded(missionId, patch, { leaseToken, fence = null } = {}) {
  const { Mission } = models();
  const lease = await getMissionLease(missionId);
  if (!lease) {
    const err = new Error(`mission ${missionId} não encontrada`);
    err.code = 'not_found';
    throw err;
  }
  const authorization = assertWriterAuthorized({ lease, nowMs: Date.now(), leaseToken, fence });
  if (!authorization.authorized) {
    recordStaleWrite(missionId, authorization.code, lease);
    const err = new Error(`escrita recusada: ${authorization.detail}`);
    err.code = authorization.code;
    err.leaseStale = authorization.code === 'MISSION_STALE_WORKER_WRITE';
    throw err;
  }
  const current = await getMission(missionId);
  if (Object.prototype.hasOwnProperty.call(patch, 'original_mission')
    && patch.original_mission !== current.original_mission) {
    const err = new Error('originalMission é imutável — nenhuma fase pode reescrever a intenção do usuário');
    err.code = 'ORIGINAL_MISSION_MUTATED';
    throw err;
  }
  const safePatch = { ...patch };
  delete safePatch.original_mission;
  delete safePatch.original_mission_hash;
  const [affected] = await Mission.update(safePatch, {
    where: {
      id: missionId,
      lease_token: leaseToken,
      lease_fence: fence ?? lease.fence,
      lease_expires_at: { [Op.gt]: Mission.sequelize.fn('NOW') },
    },
  });
  if (affected === 0) {
    recordStaleWrite(missionId, 'MISSION_STALE_WORKER_WRITE', await getMissionLease(missionId));
    const err = new Error('escrita recusada: lease mudou durante a operação (CAS)');
    err.code = 'MISSION_STALE_WORKER_WRITE';
    err.leaseStale = true;
    throw err;
  }
  return getMission(missionId);
}

function recordStaleWrite(missionId, code, lease) {
  try {
    // eslint-disable-next-line global-require
    require('../../utils/operationDeadline').recordLivenessEvent('STALE_WRITE_REJECTED', {
      scope: 'MISSION', missionId, code, currentFence: lease?.fence ?? null, currentWorker: lease?.workerInstanceId ?? null,
    });
  } catch (_) { /* métrica best-effort */ }
}

/**
 * Posse vigente comprovada no banco ANTES de escrita crítica em tabela-filha (versão, aprovação,
 * parecer). Essas linhas não carregam o fence da missão.
 */
async function assertMissionLeaseHeld(missionId, { leaseToken, fence } = {}) {
  const { sequelize } = models();
  const rows = await sequelize.query(
    `SELECT id FROM engineering_missions
      WHERE id = :missionId AND lease_token = :leaseToken AND lease_fence = :fence AND lease_expires_at > NOW()`,
    { replacements: { missionId, leaseToken, fence }, type: sequelize.constructor.QueryTypes.SELECT },
  );
  if (rows.length === 0) {
    const lease = await getMissionLease(missionId);
    recordStaleWrite(missionId, 'MISSION_STALE_WORKER_WRITE', lease);
    const err = new Error('escrita crítica recusada: este worker não é mais o dono vigente da missão');
    err.code = 'MISSION_STALE_WORKER_WRITE';
    err.leaseStale = true;
    throw err;
  }
  return true;
}

/**
 * Missões não terminais cujo lease EXPIROU: trabalho abandonado por worker morto (crash, kill -9,
 * container removido). É a entrada do recovery automático — nunca depende de chamada manual.
 */
async function findMissionsWithExpiredLease({ limit = 50, excludeIds = [] } = {}) {
  const { Mission } = models();
  const where = {
    status: { [Op.in]: RESUMABLE_MISSION_STATES },
    lease_token: { [Op.ne]: null },
    lease_expires_at: { [Op.lte]: new Date() },
  };
  // `NOT IN ()` é inválido em SQL — a exclusão só é aplicada quando há ids. O caller usa isto para
  // DRENAR o backlog em páginas: sem excluir o que já foi visto, o `ORDER BY ... ASC` devolveria
  // para sempre os mesmos mais antigos.
  if (excludeIds.length > 0) where.id = { [Op.notIn]: excludeIds };
  const rows = await Mission.findAll({
    where,
    order: [['lease_expires_at', 'ASC']],
    limit,
  });
  return rows.map(toPlain);
}

/** Missões não terminais SEM lease (crash antes de adquirir, ou linhas legadas). */
async function findMissionsWithoutLease({ limit = 50, excludeIds = [] } = {}) {
  const { Mission } = models();
  const where = {
    status: { [Op.in]: RESUMABLE_MISSION_STATES },
    lease_token: null,
  };
  if (excludeIds.length > 0) where.id = { [Op.notIn]: excludeIds };
  const rows = await Mission.findAll({
    where,
    order: [['updated_at', 'ASC']],
    limit,
  });
  return rows.map(toPlain);
}

/** Missões não terminais — insumo do resume durável após restart. */
async function findResumableMissions({ limit = 50 } = {}) {
  const { Mission } = models();
  const rows = await Mission.findAll({
    where: { status: { [Op.in]: RESUMABLE_MISSION_STATES } },
    order: [['updated_at', 'ASC']],
    limit,
  });
  return rows.map(toPlain);
}

/**
 * Encontra a missão que possui a task no HISTÓRICO de vínculos (`linked_task_ids`). Usado para
 * derivar o vínculo task↔MissionSpec de tasks criadas antes das colunas de vínculo existirem.
 * Procura no histórico, não só no vínculo corrente: uma task substituída continua pertencendo à
 * missão (e é justamente por isso que precisa ser reconhecida como obsoleta, não como órfã).
 */
async function findMissionByLinkedTask(taskId) {
  const { Mission } = models();
  const rows = await Mission.findAll({
    where: {
      [Op.or]: [
        { linked_task_id: taskId },
        { linked_task_ids: { [Op.contains]: [taskId] } },
      ],
    },
    order: [['updated_at', 'DESC']],
    limit: 1,
  });
  return rows.length > 0 ? toPlain(rows[0]) : null;
}

async function linkTask({ missionId, taskId, guard = null }) {
  const current = await getMission(missionId);
  if (!current) return null;
  const ids = Array.isArray(current.linked_task_ids) ? [...current.linked_task_ids] : [];
  if (!ids.includes(taskId)) ids.push(taskId);
  const iteration = ids.length;
  const patch = {
    linked_task_id: taskId,
    linked_task_ids: ids,
    iteration,
    started_at: current.started_at || new Date(),
  };
  if (guard && guard.leaseToken) return updateMissionGuarded(missionId, patch, guard);
  return updateMission(missionId, patch);
}

/**
 * Aquisição que ESPERA um dono vivo terminar (política LEASE_ACQUIRE_WAIT + backoff com jitter do
 * RETRY_BACKOFF) — serializa trabalho curto concorrente sem jamais tomar posse de lease ativo.
 */
async function acquireMissionLeaseWaiting(missionId, options = {}) {
  // eslint-disable-next-line global-require
  const { policyMs } = require('../../utils/operationDeadline');
  // eslint-disable-next-line global-require
  const { computeBackoffMs } = require('../../../engine/shared/executionDeadline');
  let acquired = await acquireMissionLease(missionId, options);
  const waitUntil = Date.now() + policyMs('LEASE_ACQUIRE_WAIT');
  const baseMs = Math.min(policyMs('RETRY_BACKOFF'), 250);
  let attempt = 1;
  while (!acquired.acquired && acquired.reason === 'MISSION_LEASE_HELD_BY_OTHER_WORKER' && Date.now() < waitUntil) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, Math.min(computeBackoffMs({ attempt, baseMs, maxMs: 2000 }), Math.max(0, waitUntil - Date.now()))); });
    attempt += 1;
    // eslint-disable-next-line no-await-in-loop
    acquired = await acquireMissionLease(missionId, options);
  }
  return acquired;
}

/**
 * Executa `fn({lease, guard, heartbeat})` sob MissionLease — a ÚNICA forma de um worker escrever
 * estado de missão. Usa o lease PROPAGADO pelo chamador (mesmo token/fence) ou adquire um próprio
 * e o libera no fim (por token). `heartbeat: true` renova a posse enquanto `fn` durar.
 * `allowTerminalWithoutLease`: missão em estado no qual NENHUM worker consegue lease (terminal) —
 * decisões humanas administrativas seguem sem guard, pois não existe dono concorrente possível.
 */
async function withMissionLease(missionId, providedLease, fn, {
  workerInstanceId,
  workerType = 'ORCHESTRATOR',
  host = null,
  heartbeat = false,
  allowTerminalWithoutLease = false,
  // Operações administrativas curtas (aprovação, início de execução) ESPERAM o dono vivo terminar,
  // com backoff do registry, em vez de falhar na primeira colisão — serializam, nunca roubam.
  waitForLease = false,
} = {}) {
  let lease = null;
  let owns = false;
  if (providedLease && providedLease.token) {
    const current = await getMissionLease(missionId);
    if (!current || current.token !== providedLease.token) {
      const err = new Error(`lease propagado para a missão ${missionId} não é mais o vigente`);
      err.code = 'MISSION_LEASE_LOST';
      throw err;
    }
    lease = current;
  } else {
    // Identidade POR EXECUÇÃO: duas unidades de trabalho concorrentes no MESMO processo não podem
    // compartilhar a identidade de posse — o CAS trataria a segunda como "o mesmo dono" e trocaria o
    // token, invalidando a primeira no meio do trabalho.
    const executionWorkerId = `${workerInstanceId}#${crypto.randomUUID().slice(0, 8)}`;
    const acquired = waitForLease
      ? await acquireMissionLeaseWaiting(missionId, { workerInstanceId: executionWorkerId, workerType, host })
      : await acquireMissionLease(missionId, { workerInstanceId: executionWorkerId, workerType, host });
    if (!acquired.acquired) {
      if (allowTerminalWithoutLease && acquired.reason === 'MISSION_TERMINAL_OR_UNKNOWN') {
        return fn({ lease: null, guard: null, heartbeat: null });
      }
      const err = new Error(`mission ${missionId} está com outro worker (${acquired.lease?.workerInstanceId || 'desconhecido'}) — ${acquired.reason}`);
      err.code = acquired.reason === 'MISSION_NOT_FOUND' ? 'not_found' : 'MISSION_LOCKED_BY_OTHER_WORKER';
      err.lockedBy = acquired.lease?.workerInstanceId || null;
      throw err;
    }
    lease = acquired.lease;
    owns = true;
  }
  const guard = { leaseToken: lease.token, fence: lease.fence };
  let hb = null;
  if (heartbeat) {
    // eslint-disable-next-line global-require
    const { startLeaseHeartbeat } = require('../engineeringRouter/leaseHeartbeat');
    hb = startLeaseHeartbeat({
      name: `mission:${missionId}`,
      renew: () => renewMissionLease(missionId, { leaseToken: guard.leaseToken }),
      meta: { missionId, workerInstanceId: lease.workerInstanceId, fence: lease.fence },
    });
  }
  try {
    return await fn({ lease, guard, heartbeat: hb });
  } finally {
    if (hb) hb.stop();
    if (owns) await releaseMissionLease(missionId, { leaseToken: guard.leaseToken }).catch(() => {});
  }
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

// ── PROGRESSO SIGNIFICATIVO (separado de LIVENESS) ────────────────────────────
//
// A ausência desta camada forçava toda decisão para o único sinal disponível:
// TEMPO DECORRIDO. Com `last_progress_at` persistido, os três estados ficam
// distinguíveis: SLOW (vivo e avançando), STUCK (vivo sem avançar → DIAGNOSE),
// DEAD (heartbeat parou → lease expira → takeover por fence). O coração e o
// cérebro desta separação vivem em `progressPolicy` (puro, testável).

/**
 * Adaptador de NOMES entre a linha do banco (snake_case, `last_progress_at`) e o
 * contrato do núcleo puro (`lastMeaningfulProgressAt`).
 *
 * Defeito real medido em 2026-09-26 pelo E2E: sem este adaptador,
 * `evaluateMissionProgress` lia `row.lastMeaningfulProgressAt` (inexistente),
 * concluía "sem marco registrado" e devolvia UNKNOWN — o detector nunca
 * disparava NO_PROGRESS contra dados REAIS, apesar de passar nos testes puros.
 */
function progressRecordFromRow(row) {
  if (!row) return {};
  return {
    lastMeaningfulProgressAt: row.last_progress_at ?? row.lastMeaningfulProgressAt ?? null,
    lastProgressSignal: row.last_progress_signal ?? row.lastProgressSignal ?? null,
    progressCount: Number(row.progress_count ?? row.progressCount ?? 0) || 0,
  };
}

/**
 * Registra progresso SIGNIFICATIVO. Sinais de liveness (`heartbeat`,
 * `lease_renewal`, `poll_tick`) são RECUSADOS pelo núcleo: aceitá-los apagaria a
 * distinção entre estar vivo e estar avançando.
 *
 * @returns {{ok:boolean, accepted:boolean, reason:string, lastProgressAt?:string, signal?:string}}
 */
async function recordMissionProgress(missionId, { signal, detail = null, atMs = null } = {}, guard = null) {
  const current = await getMission(missionId);
  if (!current) return { ok: false, accepted: false, reason: 'not_found' };
  const decided = progressPolicy.recordProgress(progressRecordFromRow(current), {
    signal,
    atMs: Number.isFinite(atMs) ? atMs : Date.now(),
    detail,
  });
  if (!decided.accepted) return { ok: false, accepted: false, reason: decided.reason };
  const progressPatch = {
    last_progress_at: new Date(decided.record.lastMeaningfulProgressAt),
    last_progress_signal: decided.record.lastProgressSignal,
    progress_count: decided.record.progressCount,
  };
  if (guard && guard.leaseToken) await updateMissionGuarded(missionId, progressPatch, guard);
  else await updateMission(missionId, progressPatch);
  return {
    ok: true,
    accepted: true,
    reason: decided.reason,
    lastProgressAt: decided.record.lastMeaningfulProgressAt,
    signal: decided.record.lastProgressSignal,
  };
}

/**
 * Avalia o progresso cruzando LIVENESS (lease/heartbeat) com AVANÇO (marco
 * persistido). NÃO decide morte: devolve estado + o que investigar, para o
 * chamador escolher entre esperar/cancelar a operação/trocar provider/replanejar.
 */
async function evaluateMissionProgress(missionId, { phase = null, nowMs = Date.now(), policy = null } = {}) {
  const current = await getMission(missionId);
  if (!current) return null;
  const lease = current.lease_token ? normalizeLease(current) : null;
  const heartbeatAgeMs = lease && Number.isFinite(lease.heartbeatAt) ? nowMs - lease.heartbeatAt : null;
  return progressPolicy.evaluateProgress(progressRecordFromRow(current), {
    nowMs,
    phase: phase || current.phase || null,
    policy,
    heartbeatAgeMs,
  });
}

module.exports = {
  LEASE_TTL_MS,
  lockOwnerIsDead,
  // Lease distribuído (§30–§32)
  acquireMissionLease,
  renewMissionLease,
  releaseMissionLease,
  getMissionLease,
  // Progresso significativo (separado de liveness)
  recordMissionProgress,
  evaluateMissionProgress,
  updateMissionGuarded,
  assertMissionLeaseHeld,
  withMissionLease,
  acquireMissionLeaseWaiting,
  findMissionsWithExpiredLease,
  findMissionsWithoutLease,
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
  findMissionByLinkedTask,
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
