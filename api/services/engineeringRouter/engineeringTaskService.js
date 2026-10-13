'use strict';

/**
 * api/services/engineeringRouter/engineeringTaskService.js
 *
 * CRUD + state machine + lock de concorrência para EngineeringTask. Persistência real via
 * Sequelize — sem fallback em memória (convenção do projeto: `persistence_required`).
 */

const { Op } = require('sequelize');
const getEngineeringTaskModel = require('../../db/models/EngineeringTask');
const getEngineeringAttemptModel = require('../../db/models/EngineeringAttempt');
const getEngineeringTestRunModel = require('../../db/models/EngineeringTestRun');
const getEngineeringRegressionRunModel = require('../../db/models/EngineeringRegressionRun');
const getEngineeringReviewModel = require('../../db/models/EngineeringReview');
const getEngineeringTelemetryEventModel = require('../../db/models/EngineeringTelemetryEvent');
const { classify } = require('../../../engine/engineeringRouter/taskClassifier');
const { resolveMaxIterations } = require('../../../engine/engineeringRouter/routingPolicy');
const { assertTransition, isTerminal } = require('../../../engine/engineeringRouter/stateMachine');
const { TASK_TYPES, RISK_LEVELS, TASK_SCOPES, FAILURE_CODES, TERMINAL_STATES } = require('../../../engine/engineeringRouter/constants');
const logger = require('../../utils/logger');
// DEFEITO LATENTE REAL corrigido em 2026-09-25: `resolveLeaseState` era USADO em `lockForRun`
// (caminho do lease) sem estar importado. O erro só aparece quando a task JÁ tem `lease_token` —
// ou seja, exatamente no caminho de RETOMADA real após crash. Os testes de task passavam porque
// criavam tasks sem lease (`row.lease_token` falso ⇒ a expressão nem era avaliada). Descoberto
// pelo verificador de retomada de task real, que exercita o caminho de verdade.
const { resolveLeaseState } = require('../../../engine/engineeringMission/leasePolicy');
const progressPolicy = require('../../../engine/engineeringMission/progressPolicy');
const { resolvePolicy, withDbDeadline, recordLivenessEvent } = require('../../utils/operationDeadline');

// AUTORIDADE DE POSSE (2026-09-28): não existe mais `LOCK_STALE_MS`. Uma task pode legitimamente
// durar horas; enquanto o heartbeat renovar o lease, ela continua sendo do worker que a executa.
// Quem decide takeover é SOMENTE a expiração do lease (heartbeat parou) — nunca a idade de
// `locked_at`. `locked_at`/`locked_by` seguem preenchidos como ESPELHO de diagnóstico.

/** TTL do lease de task: política `LEASE` do registry (env declarado lá), clampada em [min,max]. */
function resolveTaskLeaseTtlMs(ttlMs = null) {
  const legacyEnv = Number(process.env.ENGINEERING_TASK_LEASE_TTL_MS);
  const override = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : (Number.isFinite(legacyEnv) && legacyEnv > 0 ? legacyEnv : null);
  return resolvePolicy('LEASE', { override }).resolved;
}

function persistenceRequiredError(detail) {
  const err = new Error(`persistence_required: ${detail}`);
  err.code = 'persistence_required';
  return err;
}

/**
 * Tipos de task que PRODUZEM patch (escrevem em arquivo).
 *
 * DEFEITO MEDIDO (2026-10-11, exercitando a jornada real pela UI): uma task de
 * CODE/BUG criada sem `allowedPaths` era ACEITA, executava, chamava o provider,
 * gerava um patch e o validador o rejeitava com `NO_PATCH_SCOPE` (ausência total de
 * escopo declarado é reject explícito, ER-V1-FINAL-003). Com `max_iterations: 1` a
 * task esgotava na primeira tentativa e terminava RED com a mensagem
 * `ENGINEERING_TASK_EXHAUSTED: Esgotadas 1 tentativas` — que descreve o SINTOMA
 * (tentativas esgotadas) e não a CAUSA (contrato insatisfazível por construção).
 *
 * Uma task em que NENHUM patch pode ser aceito não deve ser criada: recusar no
 * contrato evita gastar tentativa, evita o provider desnecessário e devolve ao
 * operador a informação correta.
 */
const PATCH_PRODUCING_TASK_TYPES = Object.freeze(new Set([
  'CODE_GENERATION',
  'BUG_FIX',
  'COMPLEX_BUG_FIX',
  'REFACTOR',
  'TEST_GENERATION',
  'DATABASE_CHANGE',
  'FRONTEND',
  'DOCKER_INFRA',
]));

function contractError(code, message, statusCode = 400) {
  const erro = new Error(`${code}: ${message}`);
  erro.code = code;
  erro.statusCode = statusCode;
  return erro;
}

/**
 * O contrato desta task pode ser satisfeito? (PURA — testável sem banco.)
 *
 * Só o que produz patch exige escopo: análise/revisão/auditoria não escrevem
 * arquivo, e exigir escopo delas seria burocracia sem efeito.
 */
function assertTaskContract({ taskType, allowedPaths } = {}) {
  const produzPatch = PATCH_PRODUCING_TASK_TYPES.has(String(taskType || ''));
  if (!produzPatch) return;
  const escopo = Array.isArray(allowedPaths) ? allowedPaths.filter((p) => typeof p === 'string' && p.trim() !== '') : [];
  if (escopo.length === 0) {
    throw contractError(
      'TASK_CONTRACT_INVALID',
      `task do tipo ${taskType} produz patch e exige 'allowedPaths' declarado (sem escopo nenhum patch pode ser aceito — a task nasceria insatisfazível)`,
      400,
    );
  }
}

/**
 * Cria uma EngineeringTask a partir de um Task Contract (parcial), classifica
 * deterministicamente e persiste. Idempotente por `idempotencyKey`: uma segunda chamada com a
 * mesma chave retorna a task já existente em vez de duplicar.
 */
async function createTask(input = {}, { createdBy = null, idempotencyKey = null } = {}) {
  const Model = getEngineeringTaskModel();
  if (!Model || typeof Model.create !== 'function') throw persistenceRequiredError('EngineeringTask model indisponível');

  if (idempotencyKey) {
    const existing = await Model.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return toPlain(existing);
  }

  const classification = classify(input, { failingTests: input.failingTests || [] });
  // Contrato validado ANTES de persistir: task insatisfazível não chega a existir.
  assertTaskContract({
    taskType: input.taskType || classification.taskType,
    allowedPaths: input.allowedPaths,
  });
  const maxIterations = resolveMaxIterations(classification.taskType, input.maxIterations);

  let row;
  try {
    row = await Model.create({
      title: input.title || input.objective || 'EngineeringTask sem título',
      objective: input.objective || null,
      task_type: classification.taskType,
      risk: classification.risk,
      scope: classification.scope,
      required_capabilities: classification.requiredCapabilities,
      allowed_paths: Array.isArray(input.allowedPaths) ? input.allowedPaths : [],
      forbidden_paths: Array.isArray(input.forbiddenPaths) ? input.forbiddenPaths : [],
      // ER-V1-FINAL-003: nunca default true — só persiste true se o chamador setou
      // explicitamente (ato deliberado, nunca herdado/inferido).
      explicit_policy_authorization: input.explicitPolicyAuthorization === true,
      acceptance_criteria: Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria : [],
      test_commands: Array.isArray(input.testCommands) ? input.testCommands : [],
      max_iterations: maxIterations,
      status: 'CLASSIFIED',
      release_blocker: Boolean(input.releaseBlocker),
      classification: 'DEVELOPMENT',
      created_by: createdBy,
      idempotency_key: idempotencyKey,
      classifier_result: classification,
      routing_decision: {},
      // MISSION SOURCE AUTHORITY — HERANÇA DA FONTE DA MISSÃO.
      // O commit de onde esta task nasce é gravado AQUI, no momento da criação, e passa a ser a
      // autoridade de materialização do worktree (`patchApplyService.resolveTaskBaseCommit`). Sem
      // esta coluna, a task de uma missão voltaria a nascer do HEAD da main e um fix já integrado na
      // fonte da missão simplesmente não existiria para ela — o defeito do "bug que reaparece".
      source_commit: input.sourceCommit || null,
      source_ref: input.sourceRef || null,
      source_mission_fence: Number.isInteger(input.sourceMissionFence) ? input.sourceMissionFence : null,
      // Vínculo com a missão no MOMENTO da criação. Sem isto, uma fix task criada pelo Bug Loop
      // ficava "avulsa" (`mission_id` nulo) e nem herdava a fonte da missão nem integrava nela —
      // exatamente o elo em que o fix se perdia.
      mission_id: input.missionId || null,
    });
  } catch (err) {
    // Corrida em idempotência: outra chamada concorrente já criou com a mesma chave.
    // Achado real (missão de enriquecimento, teste §33 "duas execuções concorrentes"): o
    // `SequelizeUniqueConstraintError` tem `message === 'Validation error'` — não contém
    // "unique" — então a checagem por regex na mensagem NÃO pegava a corrida, e a segunda
    // chamada concorrente estourava em vez de devolver a task já criada. O `name` do erro é o
    // discriminador correto.
    const isUniqueViolation = err?.name === 'SequelizeUniqueConstraintError'
      || err?.parent?.code === '23505'
      || /unique|constraint/i.test(err.message || '');
    if (idempotencyKey && isUniqueViolation) {
      const existing = await Model.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) return toPlain(existing);
    }
    throw err;
  }

  return toPlain(row);
}

function toPlain(row) {
  return row.get ? row.get({ plain: true }) : row;
}

async function getTask(taskId) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  return row ? toPlain(row) : null;
}

async function listTasks({ status, risk, taskType, limit = 50, offset = 0 } = {}) {
  const Model = getEngineeringTaskModel();
  const where = {};
  if (status) where.status = status;
  if (risk) where.risk = risk;
  if (taskType) where.task_type = taskType;
  const rows = await Model.findAll({
    where,
    order: [['updated_at', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  });
  return rows.map(toPlain);
}

/**
 * Transiciona a task para um novo estado, validando contra a state machine. Nunca aplica
 * transição inválida silenciosamente.
 */
async function transitionTask(taskId, toStatus, extra = {}, guard = {}) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  assertTransition(row.status, toStatus);

  // Transição de fase é ESCRITA MATERIAL: se o chamador apresenta o lease (worker real do Router),
  // ela passa por CAS (fence/token). Um worker antigo que volte atrasado é recusado com
  // TASK_STALE_WORKER_WRITE em vez de sobrescrever o estado do novo dono.
  if (guard && guard.leaseToken) {
    return updateTaskGuarded(taskId, { status: toStatus, ...extra }, { leaseToken: guard.leaseToken, fence: guard.fence, expectedStatus: row.status });
  }

  // Escrita SEM credencial de lease enquanto existe um dono VIVO é exatamente o que o fencing
  // existe para impedir — exceto o cancelamento administrativo (operador/supersessão), que é uma
  // decisão acima do worker: o dono descobre na próxima escrita guardada (transição inválida a
  // partir de CANCELLED) e encerra sem sobrescrever nada.
  if (toStatus !== 'CANCELLED' && row.lease_token && resolveLeaseState(taskLeaseToPlain(row), Date.now()) === 'ACTIVE') {
    const err = new Error(`transição ${row.status}→${toStatus} sem credencial de lease recusada: task pertence a ${row.lease_worker_instance_id} (fence ${row.lease_fence})`);
    err.code = 'TASK_LEASE_HELD_BY_OTHER_WORKER';
    err.leaseWorkerInstanceId = row.lease_worker_instance_id;
    throw err;
  }

  await row.update({ status: toStatus, ...extra });
  return toPlain(row);
}

/**
 * Adquire posse de execução da task (evita rodar a mesma task duas vezes simultaneamente).
 *
 * MODELO ÚNICO DE POSSE (2026-09-28): esta função é apenas a interface histórica sobre o LEASE —
 * delega a `acquireTaskLease` (CAS no banco, fence+1 a cada troca de dono). O caminho antigo
 * decidia posse por TEMPO (`LOCK_STALE_MS` sobre `locked_at`): uma task saudável com 16 minutos de
 * execução era considerada órfã e roubada. Agora:
 *   - lease ATIVO de outro worker ⇒ TASK_ALREADY_RUNNING (independentemente da idade);
 *   - lease EXPIRADO (heartbeat parou) ⇒ takeover com fence novo;
 *   - lease do PRÓPRIO worker ⇒ o dono continua.
 * `locked_at`/`locked_by` são gravados pelo próprio CAS como espelho de diagnóstico.
 */
async function lockForRun(taskId, runnerId, { host = null, ttlMs = null } = {}) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  if (isTerminal(row.status)) {
    const err = new Error(`Task já está em estado terminal: ${row.status}`);
    err.code = 'TASK_TERMINAL';
    err.status = row.status;
    throw err;
  }
  const acquired = await acquireTaskLease(taskId, { workerInstanceId: runnerId, host, ttlMs });
  if (!acquired.acquired) {
    const current = acquired.lease || {};
    const refreshed = await Model.findByPk(taskId);
    if (refreshed && isTerminal(refreshed.status)) {
      const err = new Error(`Task já está em estado terminal: ${refreshed.status}`);
      err.code = 'TASK_TERMINAL';
      err.status = refreshed.status;
      throw err;
    }
    const err = new Error('EngineeringTask já está em execução');
    err.code = FAILURE_CODES.TASK_ALREADY_RUNNING;
    err.lockedBy = current.workerInstanceId || null;
    err.leaseExpiresAt = current.expiresAt ? new Date(current.expiresAt).toISOString() : null;
    err.fence = current.fence ?? null;
    throw err;
  }
  const task = await getTask(taskId);
  return { ...task, lease: acquired.lease, leaseTakeover: acquired.takeover || null };
}

/**
 * Libera a posse. Com `leaseToken`, só libera se o lease ainda for deste worker (um worker que
 * perdeu o lease nunca apaga o lease do novo dono). Sem token (uso administrativo/teste), limpa.
 */
async function unlockTask(taskId, { leaseToken = null } = {}) {
  await releaseTaskLease(taskId, { leaseToken });
  return getTask(taskId);
}

/**
 * Lease distribuído + fencing de EngineeringTask (missão V2).
 *
 * Por que existe: `lockForRun` decide posse por TEMPO (`LOCK_STALE_MS`) sobre `locked_at`. Isso não
 * impede o caso que a missão exige bloquear:
 *   Worker A adquire (fence 10) → para de fazer heartbeat → lease expira → Worker B adquire (fence 11)
 *   → Worker A volta atrasado e grava. Sem fence, A sobrescreve o estado produzido por B.
 *
 * A semântica é a MESMA já usada por EngineeringMission (`engine/engineeringMission/leasePolicy.js`)
 * — reuso, não arquitetura paralela. `locked_at`/`locked_by` continuam preenchidos para diagnóstico.
 */
// Mesma fonte única de estados terminais do Router (`constants.TERMINAL_STATES`). A lista local
// anterior (GREEN/FAILED/CANCELLED/REJECTED/PROMOTED/DONE) não continha RED, BLOCKED nem
// READY_FOR_PROMOTION — o recovery podia "retomar" (tomar lease de) uma task já terminada em RED.
const TASK_LEASE_TERMINAL_STATES = TERMINAL_STATES;

function taskLeaseToPlain(row) {
  const leasePolicy = require('../../../engine/engineeringMission/leasePolicy');
  return leasePolicy.normalizeLease({
    lease_worker_instance_id: row.lease_worker_instance_id,
    lease_worker_type: null,
    lease_host: row.lease_host,
    lease_token: row.lease_token,
    lease_fence: row.lease_fence,
    lease_acquired_at: row.lease_acquired_at,
    lease_expires_at: row.lease_expires_at,
    lease_heartbeat_at: row.lease_heartbeat_at,
  });
}

async function getTaskLease(taskId) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
  return taskLeaseToPlain(row);
}

/**
 * Aquisição atômica por CAS: só grava se NINGUÉM tem lease vivo (ou se o lease é do próprio worker).
 * `lease_fence = lease_fence + 1` a cada aquisição — é o que permite REJEITAR o worker antigo.
 *
 * O CAS roda sob `statement_timeout` da política DATABASE_QUERY: um banco travado vira DB_TIMEOUT
 * classificado (rollback, estado intacto), nunca um worker pendurado para sempre segurando nada.
 * `takeover` descreve o dono anterior quando a posse foi TOMADA de um lease expirado.
 */
async function acquireTaskLease(taskId, { workerInstanceId, host = null, ttlMs } = {}) {
  if (!workerInstanceId) {
    throw Object.assign(new Error('workerInstanceId é obrigatório para adquirir lease de task'), { code: 'TASK_LEASE_WORKER_REQUIRED' });
  }
  const ttlSeconds = Math.max(1, Math.round(resolveTaskLeaseTtlMs(ttlMs) / 1000));
  const Model = getEngineeringTaskModel();
  const sequelize = Model.sequelize;

  const rows = await withDbDeadline(sequelize, async (transaction) => {
    const [result] = await sequelize.query(
      `WITH previous AS (
         SELECT id, lease_token AS prev_token, lease_worker_instance_id AS prev_worker,
                lease_expires_at AS prev_expires_at, lease_fence AS prev_fence
           FROM engineering_tasks WHERE id = :id FOR UPDATE
       )
       UPDATE engineering_tasks t
          SET lease_token = gen_random_uuid(),
              lease_fence = t.lease_fence + 1,
              lease_worker_instance_id = :workerInstanceId,
              lease_host = :host,
              lease_acquired_at = NOW(),
              lease_expires_at = NOW() + make_interval(secs => :ttlSeconds),
              lease_heartbeat_at = NOW(),
              locked_at = NOW(),
              locked_by = :workerInstanceId
         FROM previous p
        WHERE t.id = p.id
          AND t.status NOT IN (:terminalStates)
          AND (t.lease_token IS NULL OR t.lease_expires_at IS NULL OR t.lease_expires_at < NOW() OR t.lease_worker_instance_id = :workerInstanceId)
        RETURNING t.id, p.prev_token, p.prev_worker, p.prev_expires_at, p.prev_fence`,
      {
        replacements: { id: taskId, workerInstanceId, host, ttlSeconds, terminalStates: TASK_LEASE_TERMINAL_STATES },
        transaction,
      },
    );
    return result;
  }, { operation: 'task_lease_acquire', meta: { taskId } });

  if (rows.length === 0) {
    const current = await getTaskLease(taskId);
    return { acquired: false, reason: 'TASK_LEASE_HELD_BY_OTHER_WORKER', lease: current };
  }
  const previous = rows[0];
  let takeover = null;
  if (previous.prev_token && previous.prev_worker && previous.prev_worker !== workerInstanceId) {
    takeover = {
      previousWorker: previous.prev_worker,
      previousFence: Number(previous.prev_fence) || 0,
      previousExpiresAt: previous.prev_expires_at,
    };
    recordLivenessEvent('LEASE_EXPIRED', { scope: 'TASK', taskId, previousWorker: previous.prev_worker });
    recordLivenessEvent('LEASE_TAKEOVER', { scope: 'TASK', taskId, previousWorker: previous.prev_worker, newWorker: workerInstanceId });
  }
  return { acquired: true, lease: await getTaskLease(taskId), takeover };
}

/**
 * HEARTBEAT: renova a validade do PRÓPRIO lease e marca `lease_heartbeat_at`. Nunca toca em
 * `last_progress_at` — liveness não é avanço. Token diferente ⇒ TASK_LEASE_LOST (outro dono).
 */
async function renewTaskLease(taskId, { leaseToken, ttlMs } = {}) {
  const ttlSeconds = Math.max(1, Math.round(resolveTaskLeaseTtlMs(ttlMs) / 1000));
  const Model = getEngineeringTaskModel();
  const sequelize = Model.sequelize;
  const rows = await withDbDeadline(sequelize, async (transaction) => {
    const [result] = await sequelize.query(
      `UPDATE engineering_tasks
          SET lease_expires_at = NOW() + make_interval(secs => :ttlSeconds),
              lease_heartbeat_at = NOW()
        WHERE id = :id AND lease_token = :leaseToken
        RETURNING id`,
      { replacements: { id: taskId, leaseToken, ttlSeconds }, transaction },
    );
    return result;
  }, { operation: 'task_lease_renew', meta: { taskId } });
  if (rows.length === 0) {
    throw Object.assign(new Error('lease da task não pertence mais a este worker'), { code: 'TASK_LEASE_LOST' });
  }
  return getTaskLease(taskId);
}

async function releaseTaskLease(taskId, { leaseToken } = {}) {
  const Model = getEngineeringTaskModel();
  const where = leaseToken ? { id: taskId, lease_token: leaseToken } : { id: taskId };
  // `lease_fence` NÃO é zerado: fence monotônico é o que impede um worker antigo de reentrar.
  await Model.update(
    { lease_token: null, lease_expires_at: null, lease_worker_instance_id: null, lease_host: null, locked_at: null, locked_by: null },
    { where },
  );
  return getTaskLease(taskId);
}

function staleWriteError(code, message, lease, taskId) {
  recordLivenessEvent('STALE_WRITE_REJECTED', { scope: 'TASK', taskId, code, currentFence: lease?.fence ?? null, currentWorker: lease?.workerInstanceId ?? null });
  const err = new Error(message);
  err.code = code;
  err.lease = lease;
  err.staleWrite = true;
  return err;
}

/**
 * Escrita protegida por fence: o worker ANTIGO recebe TASK_STALE_WORKER_WRITE e não sobrescreve o
 * trabalho do novo dono. O WHERE é o CAS completo — token + fence + lease não expirado (+ status
 * esperado quando informado) — então nem uma troca de dono nem um cancelamento entre a leitura e a
 * escrita passam despercebidos.
 */
async function updateTaskGuarded(taskId, patch, { leaseToken, fence = null, expectedStatus = null } = {}) {
  const leasePolicy = require('../../../engine/engineeringMission/leasePolicy');
  const Model = getEngineeringTaskModel();
  const lease = await getTaskLease(taskId);
  if (!lease) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });

  // `nowMs` é OBRIGATÓRIO na primitiva pura (o motor não lê relógio — determinismo de replay é
  // verificado por teste). O relógio entra pela borda (api/services).
  const authorization = leasePolicy.assertWriterAuthorized({ lease, nowMs: Date.now(), leaseToken, fence });
  if (!authorization.authorized) {
    // `leasePolicy` é compartilhado com EngineeringMission e devolve códigos com prefixo MISSION_.
    const taskCode = {
      MISSION_STALE_WORKER_WRITE: 'TASK_STALE_WORKER_WRITE',
      MISSION_LEASE_NOT_HELD: 'TASK_LEASE_NOT_HELD',
      MISSION_LEASE_EXPIRED: 'TASK_LEASE_EXPIRED',
    }[authorization.code] || authorization.code;
    throw staleWriteError(taskCode, authorization.detail || 'escrita recusada por fencing', lease, taskId);
  }

  const where = {
    id: taskId,
    lease_token: leaseToken,
    lease_fence: fence ?? lease.fence,
    lease_expires_at: { [Op.gt]: Model.sequelize.fn('NOW') },
  };
  if (expectedStatus) where.status = expectedStatus;
  const [affected] = await withDbDeadline(Model.sequelize, (transaction) => Model.update(patch, { where, transaction }), { operation: 'task_guarded_update', meta: { taskId } });
  if (affected === 0) {
    const current = await getTask(taskId);
    if (expectedStatus && current && current.status !== expectedStatus && current.lease_token === leaseToken) {
      // O dono ainda é este worker, mas o STATUS mudou por fora (cancelamento administrativo):
      // não é escrita obsoleta de worker antigo, é transição que deixou de ser válida.
      const err = new Error(`transição recusada: status mudou para ${current.status} durante a escrita`);
      err.code = FAILURE_CODES.INVALID_STATE_TRANSITION;
      throw err;
    }
    throw staleWriteError('TASK_STALE_WORKER_WRITE', 'escrita recusada: fence/token não correspondem ao dono atual ou lease expirou', await getTaskLease(taskId), taskId);
  }
  return getTask(taskId);
}

/**
 * Verificação de AUTORIDADE antes de escrita crítica em tabelas-filhas (attempt, test run, review,
 * regression run, telemetria de fase). Essas linhas não carregam o fence; a guarda é conferir, no
 * banco, que este worker ainda é o dono vigente com lease válido — e recusar ANTES do efeito.
 */
async function assertTaskLeaseHeld(taskId, { leaseToken, fence } = {}) {
  const Model = getEngineeringTaskModel();
  const [rows] = await Model.sequelize.query(
    `SELECT id FROM engineering_tasks
      WHERE id = :id AND lease_token = :leaseToken AND lease_fence = :fence AND lease_expires_at > NOW()`,
    { replacements: { id: taskId, leaseToken, fence } },
  );
  if (rows.length === 0) {
    throw staleWriteError('TASK_STALE_WORKER_WRITE', 'escrita crítica recusada: este worker não é mais o dono vigente da task', await getTaskLease(taskId), taskId);
  }
  return true;
}

function taskProgressRecord(row) {
  if (!row) return {};
  return {
    lastMeaningfulProgressAt: row.last_progress_at ?? null,
    lastProgressSignal: row.last_progress_signal ?? null,
    progressCount: Number(row.progress_count ?? 0) || 0,
  };
}

/**
 * Registra PROGRESSO SIGNIFICATIVO da task (patch gerado, comando concluído, resultado de teste,
 * review, regressão, gate, promoção...). Sinais de liveness (heartbeat/lease_renewal) são
 * RECUSADOS pelo núcleo. Com credencial de lease, a escrita é guardada por fence: um worker antigo
 * não "mantém viva" uma task que já não é dele.
 */
async function recordTaskProgress(taskId, { signal, detail = null, atMs = null } = {}, guard = null) {
  const current = await getTask(taskId);
  if (!current) return { ok: false, accepted: false, reason: 'not_found' };
  const decided = progressPolicy.recordProgress(taskProgressRecord(current), {
    signal,
    atMs: Number.isFinite(atMs) ? atMs : Date.now(),
    detail,
  });
  if (!decided.accepted) return { ok: false, accepted: false, reason: decided.reason };
  const patch = {
    last_progress_at: new Date(decided.record.lastMeaningfulProgressAt),
    last_progress_signal: decided.record.lastProgressSignal,
    progress_count: decided.record.progressCount,
  };
  if (guard && guard.leaseToken) {
    await updateTaskGuarded(taskId, patch, { leaseToken: guard.leaseToken, fence: guard.fence });
  } else {
    const Model = getEngineeringTaskModel();
    await Model.update(patch, { where: { id: taskId } });
  }
  return { ok: true, accepted: true, signal: decided.record.lastProgressSignal, lastProgressAt: decided.record.lastMeaningfulProgressAt };
}

/**
 * SLOW ≠ STUCK ≠ DEAD para a task, a partir do estado PERSISTIDO (lease + heartbeat + progresso).
 * A fase usada no limiar de NO_PROGRESS é o status corrente da task.
 */
async function evaluateTaskLiveness(taskId, { nowMs = Date.now(), policy = null, operationStartedAtMs = null, operationBaselineMs = null } = {}) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
  const plain = toPlain(row);
  const phaseMap = { CODING: 'IMPLEMENTING', ROUTED: 'ANALYZING', CLASSIFIED: 'ANALYZING', TESTING: 'TESTING', REVIEWING: 'REVIEWING', REGRESSION: 'REGRESSION', GOVERNANCE: 'REGRESSION' };
  return progressPolicy.classifyLiveness({
    lease: plain.lease_token ? taskLeaseToPlain(plain) : null,
    progressRecord: taskProgressRecord(plain),
    nowMs,
    phase: phaseMap[plain.status] || plain.status,
    policy,
    operationStartedAtMs,
    operationBaselineMs,
  });
}

async function findTasksWithExpiredLease({ limit = 50 } = {}) {
  const Model = getEngineeringTaskModel();
  const rows = await Model.findAll({
    where: {
      lease_token: { [require('sequelize').Op.ne]: null },
      lease_expires_at: { [require('sequelize').Op.lt]: new Date() },
      status: { [require('sequelize').Op.notIn]: TASK_LEASE_TERMINAL_STATES },
    },
    limit,
    order: [['lease_expires_at', 'ASC']],
  });
  return rows.map(toPlain);
}

async function saveRoutingDecision(taskId, routingDecision, guard = null) {
  if (guard && guard.leaseToken) {
    return updateTaskGuarded(taskId, { routing_decision: routingDecision }, guard);
  }
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  await row.update({ routing_decision: routingDecision });
  return toPlain(row);
}

async function saveLastError(taskId, error = {}, guard = null) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
  if (guard && guard.leaseToken) {
    const { message = null, code = null, ...extra } = error;
    return updateTaskGuarded(taskId, { last_error: { message, code: code || null, at: new Date().toISOString(), ...extra } }, guard);
  }
  // DEFEITO REAL corrigido aqui (medido em 2026-09-25): a versão anterior montava
  // `{ message, code, at }` e DESCARTAVA todo o resto que o chamador passou. Quem registrava um
  // bloqueio com contexto adicional (estado, estratégia, decisão pendente) achava que tinha
  // persistido evidência, e o banco guardava só a mensagem — o mesmo padrão de "engolir
  // informação" que já produziu diagnósticos enganosos em outros pontos. Agora os campos extras
  // são preservados; o formato histórico (`message`/`code`/`at`) continua idêntico.
  const { message = null, code = null, ...extra } = error;
  await row.update({ last_error: { message, code: code || null, at: new Date().toISOString(), ...extra } });
  return toPlain(row);
}

/** Próximo número de tentativa (retry não cria nova task — attempt sequencial). */
async function nextAttemptNumber(taskId) {
  const AttemptModel = getEngineeringAttemptModel();
  const count = await AttemptModel.count({ where: { task_id: taskId } });
  return count + 1;
}

async function createAttempt(taskId, data = {}) {
  const AttemptModel = getEngineeringAttemptModel();
  const attemptNumber = await nextAttemptNumber(taskId);
  const row = await AttemptModel.create({
    task_id: taskId,
    attempt_number: attemptNumber,
    status: data.status || 'PENDING',
    started_at: new Date(),
    ...data,
  });
  return toPlain(row);
}

async function updateAttempt(attemptId, data = {}) {
  const AttemptModel = getEngineeringAttemptModel();
  const row = await AttemptModel.findByPk(attemptId);
  if (!row) throw Object.assign(new Error('EngineeringAttempt não encontrada'), { code: 'not_found' });
  await row.update(data);
  return toPlain(row);
}

async function listAttempts(taskId) {
  const AttemptModel = getEngineeringAttemptModel();
  const rows = await AttemptModel.findAll({ where: { task_id: taskId }, order: [['attempt_number', 'ASC']] });
  return rows.map(toPlain);
}

async function getAttempt(attemptId) {
  const AttemptModel = getEngineeringAttemptModel();
  const row = await AttemptModel.findByPk(attemptId);
  return row ? toPlain(row) : null;
}

async function createTestRun(attemptId, data = {}) {
  const Model = getEngineeringTestRunModel();
  const row = await Model.create({ attempt_id: attemptId, ...data });
  return toPlain(row);
}

async function updateTestRun(testRunId, data = {}) {
  const Model = getEngineeringTestRunModel();
  const row = await Model.findByPk(testRunId);
  if (!row) throw Object.assign(new Error('EngineeringTestRun não encontrada'), { code: 'not_found' });
  await row.update(data);
  return toPlain(row);
}

async function listTestRuns(attemptId) {
  const Model = getEngineeringTestRunModel();
  const rows = await Model.findAll({ where: { attempt_id: attemptId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

/** ER-V1-FINAL-006: um registro por EXECUÇÃO REAL do plano de regressão (nunca evidence revalidation). */
async function createRegressionRun(taskId, attemptId, data = {}) {
  const Model = getEngineeringRegressionRunModel();
  const row = await Model.create({ task_id: taskId, attempt_id: attemptId, ...data });
  return toPlain(row);
}

async function listRegressionRuns(attemptId) {
  const Model = getEngineeringRegressionRunModel();
  const rows = await Model.findAll({ where: { attempt_id: attemptId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function createReview(attemptId, data = {}) {
  const Model = getEngineeringReviewModel();
  const row = await Model.create({ attempt_id: attemptId, ...data });
  return toPlain(row);
}

async function listReviews(attemptId) {
  const Model = getEngineeringReviewModel();
  const rows = await Model.findAll({ where: { attempt_id: attemptId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function recordTelemetry(data = {}) {
  const Model = getEngineeringTelemetryEventModel();
  const row = await Model.create(data);
  return toPlain(row);
}

async function listTelemetry(taskId) {
  const Model = getEngineeringTelemetryEventModel();
  const rows = await Model.findAll({ where: { task_id: taskId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

/**
 * Campos de METADADO de vínculo/identidade da task. Allowlist ESTRITA: `updateTaskFields` não é
 * uma porta lateral para escrever `status` sem passar pelo fencing (seria um bypass do CAS).
 */
const TASK_METADATA_FIELDS = Object.freeze([
  'mission_id',
  'mission_version',
  'mission_spec_hash',
  'mission_spec_state',
  'mission_spec_checked_at',
  'superseded_by_task_id',
  // MISSION SOURCE AUTHORITY: reapontar a task para a fonte corrente da missão é uma escrita de
  // METADADO (não muda status, resultado nem evidência de trabalho) — exatamente a categoria desta
  // função. É o que permite a uma task criada antes de uma integração passar a enxergar o patch.
  'source_commit',
  'source_ref',
  'source_mission_fence',
]);

/**
 * Escrita de metadados (vínculo com a MissionSpec, estado de frescor, supersessão).
 *
 * Não é escrita de estado de execução: não altera `status`, resultado ou evidência de trabalho, e
 * por isso não passa pelo fence — que existe para impedir um worker ANTIGO de sobrescrever o
 * trabalho do dono novo. Como consequência, qualquer campo fora da allowlist é RECUSADO (em
 * especial `status`), para que esta função nunca vire um caminho de escrita sem CAS.
 */
async function updateTaskFields(taskId, patch = {}) {
  const invalid = Object.keys(patch).filter((key) => !TASK_METADATA_FIELDS.includes(key));
  if (invalid.length > 0) {
    throw Object.assign(
      new Error(`updateTaskFields recusa campos não-metadados: ${invalid.join(', ')} — escrita de estado passa por transitionTask/updateTaskGuarded (CAS)`),
      { code: 'TASK_METADATA_FIELD_NOT_ALLOWED', fields: invalid },
    );
  }
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  await row.update(patch);
  return toPlain(row);
}

async function computeOverview() {
  // ERV1-CLOSE-005: usa TERMINAL_STATES (fonte única) em vez de uma lista hardcoded — quando
  // READY_FOR_PROMOTION foi adicionado como terminal, uma lista solta aqui teria continuado
  // contando essas tasks como "em execução" para sempre.
  //
  // A declaração local do model estava AUSENTE: `computeOverview` referenciava `Model` sem
  // jamais atribuí-lo (todas as demais funções deste arquivo declaram o seu), então a função
  // lançava `ReferenceError: Model is not defined` em 100% das chamadas. Efeito real medido em
  // 2026-09-26: `GET /engineering/release-closure` devolvia HTTP 500 (`internal_error`) — a
  // página /dev/engineering/release-closure não carregava. Nenhum teste pegava porque
  // tests/unit/engineeringRouterRoutes.test.js injeta um `engineeringTaskService` MOCKADO, então
  // a implementação real de `computeOverview` nunca era exercitada.
  const Model = getEngineeringTaskModel();
  if (!Model || typeof Model.count !== 'function') {
    throw persistenceRequiredError('EngineeringTask model indisponível');
  }
  const [total, green, red, running, blocked, releaseBlockers] = await Promise.all([
    Model.count(),
    Model.count({ where: { status: 'GREEN' } }),
    Model.count({ where: { status: 'RED' } }),
    Model.count({ where: { status: { [Op.notIn]: TERMINAL_STATES } } }),
    Model.count({ where: { status: 'BLOCKED' } }),
    Model.count({ where: { release_blocker: true, status: { [Op.notIn]: ['GREEN', 'CANCELLED'] } } }),
  ]);
  const active = await Model.findAll({
    where: { status: { [Op.notIn]: TERMINAL_STATES } },
    order: [['updated_at', 'DESC']],
    limit: 20,
  });
  return {
    totals: { total, green, red, running, blocked, releaseBlockers },
    activeTasks: active.map(toPlain),
  };
}

module.exports = {
  TASK_TYPES,
  RISK_LEVELS,
  TASK_SCOPES,
  PATCH_PRODUCING_TASK_TYPES,
  assertTaskContract,
  createTask,
  updateTaskFields,
  TASK_METADATA_FIELDS,
  getTask,
  listTasks,
  transitionTask,
  lockForRun,
  unlockTask,
  acquireTaskLease,
  renewTaskLease,
  releaseTaskLease,
  getTaskLease,
  updateTaskGuarded,
  assertTaskLeaseHeld,
  recordTaskProgress,
  evaluateTaskLiveness,
  resolveTaskLeaseTtlMs,
  findTasksWithExpiredLease,
  saveRoutingDecision,
  saveLastError,
  createAttempt,
  updateAttempt,
  listAttempts,
  getAttempt,
  nextAttemptNumber,
  createTestRun,
  updateTestRun,
  listTestRuns,
  createRegressionRun,
  listRegressionRuns,
  createReview,
  listReviews,
  recordTelemetry,
  listTelemetry,
  computeOverview,
};
