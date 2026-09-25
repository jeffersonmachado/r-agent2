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

const LOCK_STALE_MS = Number(process.env.ENGINEERING_ROUTER_LOCK_STALE_MS || 15 * 60 * 1000);

function persistenceRequiredError(detail) {
  const err = new Error(`persistence_required: ${detail}`);
  err.code = 'persistence_required';
  return err;
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
    return updateTaskGuarded(taskId, { status: toStatus, ...extra }, { leaseToken: guard.leaseToken, fence: guard.fence });
  }

  await row.update({ status: toStatus, ...extra });
  return toPlain(row);
}

/**
 * Adquire posse de execução da task (evita rodar a mesma task duas vezes simultaneamente).
 *
 * MUDANÇA DE AUTORIDADE (missão V2): antes o critério era TEMPO (`LOCK_STALE_MS` sobre `locked_at`) e
 * esse lock temporal tinha PRECEDÊNCIA sobre o lease — medido em 2026-09-25: com o lease da task
 * EXPIRADO, `lockForRun` ainda recusava com TASK_ALREADY_RUNNING, porque `locked_at` do worker morto
 * não havia "envelhecido". Ou seja, a primitiva de lease existia mas o runtime não a usava para
 * decidir posse — exatamente o gap DISTRIBUTED_LEASE_RUNTIME_INTEGRATION.
 *
 * Agora a autoridade é o LEASE (workerInstanceId + token + expiração + fence). `locked_at`/`locked_by`
 * continuam preenchidos, mas como ESPELHO de diagnóstico — nunca como critério de posse.
 */
async function lockForRun(taskId, runnerId) {
  const Model = getEngineeringTaskModel();
  const sequelize = Model.sequelize;
  const now = new Date();

  return sequelize.transaction(async (t) => {
    const row = await Model.findByPk(taskId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });

    if (isTerminal(row.status)) {
      const err = new Error(`Task já está em estado terminal: ${row.status}`);
      err.code = 'TASK_TERMINAL';
      err.status = row.status;
      throw err;
    }

    // ORDEM: o LEASE é consultado PRIMEIRO e é a autoridade quando existe. O lock temporal só decide
    // quando não há lease algum (tasks criadas antes desta mudança). Assim o comportamento do fluxo
    // legado é preservado byte a byte — a troca de autoridade acontece apenas onde o lease existe.
    const leaseState = row.lease_token ? resolveLeaseState(taskLeaseToPlain(row), now.getTime()) : null;
    // DEFEITO REAL corrigido em 2026-09-25: o lease ATIVO era tratado como conflito SEM olhar de
    // quem ele é. Resultado medido na retomada real: o worker que acabara de tomar posse da task
    // (via `acquireTaskLease`, fence+1) era RECUSADO por `lockForRun` com TASK_ALREADY_RUNNING —
    // o próprio dono não conseguia executar o que tinha acabado de assumir. `leasePolicy` já
    // trata o dono como escritor autorizado; aqui a regra é a mesma: lease ativo do PRÓPRIO
    // runnerId não é conflito, é o dono continuando.
    const leaseOwner = row.lease_worker_instance_id || null;
    const sameOwner = Boolean(leaseOwner) && leaseOwner === runnerId;
    if (leaseState === 'ACTIVE' && !sameOwner) {
      const err = new Error('EngineeringTask já está em execução');
      err.code = FAILURE_CODES.TASK_ALREADY_RUNNING;
      err.lockedBy = row.lease_worker_instance_id;
      err.leaseExpiresAt = row.lease_expires_at;
      err.fence = row.lease_fence;
      throw err;
    }

    const lockedAt = row.locked_at ? new Date(row.locked_at) : null;
    const lockIsStale = lockedAt && (now.getTime() - lockedAt.getTime() > LOCK_STALE_MS);

    if (lockedAt && !lockIsStale && leaseState === null) {
      const err = new Error('EngineeringTask já está em execução');
      err.code = FAILURE_CODES.TASK_ALREADY_RUNNING;
      err.lockedBy = row.locked_by;
      err.lockedAt = row.locked_at;
      throw err;
    }

    if (lockIsStale) {
      logger.warn('[engineeringTaskService] recuperando lock órfão (restart-safe)', { taskId, previousOwner: row.locked_by, lockedAt: row.locked_at });
    }

    await row.update({ locked_at: now, locked_by: runnerId }, { transaction: t });
    return toPlain(row);
  });
}

async function unlockTask(taskId) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
  await row.update({ locked_at: null, locked_by: null });
  return toPlain(row);
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
const TASK_LEASE_TERMINAL_STATES = ['GREEN', 'FAILED', 'CANCELLED', 'REJECTED', 'PROMOTED', 'DONE'];

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
 * `lease_fence = lease_fence + 1` a cada troca de dono — é o que permite REJEITAR o worker antigo.
 */
async function acquireTaskLease(taskId, { workerInstanceId, host = null, ttlMs } = {}) {
  if (!workerInstanceId) {
    throw Object.assign(new Error('workerInstanceId é obrigatório para adquirir lease de task'), { code: 'TASK_LEASE_WORKER_REQUIRED' });
  }
  const leasePolicy = require('../../../engine/engineeringMission/leasePolicy');
  const ttl = Number(ttlMs || process.env.ENGINEERING_TASK_LEASE_TTL_MS || leasePolicy.DEFAULT_LEASE_TTL_MS);
  const ttlSeconds = Math.max(1, Math.round(ttl / 1000));
  const Model = getEngineeringTaskModel();
  const sequelize = Model.sequelize;

  const [rows] = await sequelize.query(
    `UPDATE engineering_tasks
        SET lease_token = gen_random_uuid(),
            lease_fence = lease_fence + 1,
            lease_worker_instance_id = :workerInstanceId,
            lease_host = :host,
            lease_acquired_at = NOW(),
            lease_expires_at = NOW() + make_interval(secs => :ttlSeconds),
            lease_heartbeat_at = NOW(),
            locked_at = NOW(),
            locked_by = :workerInstanceId
      WHERE id = :id
        AND status NOT IN (:terminalStates)
        AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at < NOW() OR lease_worker_instance_id = :workerInstanceId)
      RETURNING id`,
    {
      replacements: { id: taskId, workerInstanceId, host, ttlSeconds, terminalStates: TASK_LEASE_TERMINAL_STATES },
    },
  );

  if (rows.length === 0) {
    const current = await getTaskLease(taskId);
    return { acquired: false, reason: 'TASK_LEASE_HELD_BY_OTHER_WORKER', lease: current };
  }
  return { acquired: true, lease: await getTaskLease(taskId) };
}

async function renewTaskLease(taskId, { leaseToken, ttlMs } = {}) {
  const leasePolicy = require('../../../engine/engineeringMission/leasePolicy');
  const ttl = Number(ttlMs || process.env.ENGINEERING_TASK_LEASE_TTL_MS || leasePolicy.DEFAULT_LEASE_TTL_MS);
  const ttlSeconds = Math.max(1, Math.round(ttl / 1000));
  const Model = getEngineeringTaskModel();
  const [rows] = await Model.sequelize.query(
    `UPDATE engineering_tasks
        SET lease_expires_at = NOW() + make_interval(secs => :ttlSeconds),
            lease_heartbeat_at = NOW()
      WHERE id = :id AND lease_token = :leaseToken
      RETURNING id`,
    { replacements: { id: taskId, leaseToken, ttlSeconds } },
  );
  if (rows.length === 0) {
    throw Object.assign(new Error('lease da task não pertence mais a este worker'), { code: 'TASK_LEASE_LOST' });
  }
  return getTaskLease(taskId);
}

async function releaseTaskLease(taskId, { leaseToken } = {}) {
  const Model = getEngineeringTaskModel();
  const where = leaseToken ? { id: taskId, lease_token: leaseToken } : { id: taskId };
  await Model.update(
    { lease_token: null, lease_expires_at: null, lease_worker_instance_id: null, lease_host: null, locked_at: null, locked_by: null },
    { where },
  );
  return getTaskLease(taskId);
}

/**
 * Escrita protegida por fence: o worker ANTIGO recebe TASK_STALE_WORKER_WRITE e não sobrescreve o
 * trabalho do novo dono. É o teste obrigatório da missão (o que a primitiva de lease sozinha não
 * garante).
 */
async function updateTaskGuarded(taskId, patch, { leaseToken, fence = null } = {}) {
  const leasePolicy = require('../../../engine/engineeringMission/leasePolicy');
  const Model = getEngineeringTaskModel();
  const lease = await getTaskLease(taskId);
  if (!lease) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });

  // `nowMs` é OBRIGATÓRIO na primitiva pura (o motor não lê relógio — determinismo de replay é
  // verificado por teste). O DEFEITO REAL foi aqui, no call site: omitir `nowMs` faz
  // `lease.expiresAt > undefined` ser sempre falso, e o dono LEGÍTIMO passava a ser recusado com
  // TASK_LEASE_EXPIRED — o Router inteiro travaria. O relógio entra pela borda (api/services).
  const authorization = leasePolicy.assertWriterAuthorized({ lease, nowMs: Date.now(), leaseToken, fence });
  if (!authorization.authorized) {
    // `leasePolicy` é compartilhado com EngineeringMission e devolve códigos com prefixo MISSION_.
    // A recusa aqui é de TASK e precisa ser rastreável como tal (a missão exige distinguir os dois
    // domínios); o COMPORTAMENTO é o mesmo, só o vocabulário é traduzido.
    const taskCode = {
      MISSION_STALE_WORKER_WRITE: 'TASK_STALE_WORKER_WRITE',
      MISSION_LEASE_NOT_HELD: 'TASK_LEASE_NOT_HELD',
      MISSION_LEASE_EXPIRED: 'TASK_LEASE_EXPIRED',
    }[authorization.code] || authorization.code;
    const err = new Error(authorization.message || 'escrita recusada por fencing');
    err.code = taskCode;
    err.lease = lease;
    throw err;
  }

  const [affected] = await Model.update(patch, {
    where: { id: taskId, lease_token: leaseToken, lease_fence: fence },
  });
  if (affected === 0) {
    throw Object.assign(new Error('escrita recusada: fence/token não correspondem ao dono atual'), {
      code: 'TASK_STALE_WORKER_WRITE',
    });
  }
  return getTask(taskId);
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

async function saveRoutingDecision(taskId, routingDecision) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  await row.update({ routing_decision: routingDecision });
  return toPlain(row);
}

async function saveLastError(taskId, error = {}) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
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
