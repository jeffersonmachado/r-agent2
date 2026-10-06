'use strict';

const fs = require('fs');
const path = require('path');

const { generateRunId } = require('./run-id');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const RUN_CONTEXT_RELATIVE_PATH = path.join('governance', '.current-run.json');
const RUN_CONTEXT_VERSION = '1.0.0';

const RUN_STATES = Object.freeze({
  CREATED: 'CREATED',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
  INVALIDATED: 'INVALIDATED',
  COMPLETED: 'COMPLETED',
  PACKAGED: 'PACKAGED',
  VERIFIED: 'VERIFIED',
});

// DEFEITO MEDIDO (2026-10-05): a máquina não conhecia `FAILED`, embora o banco
// (`certificationService.calculateFinalDecision`) grave exatamente esse estado
// quando a decisão é NO_GO. Sem o estado, não havia transição de RECUPERAÇÃO —
// um run que falhou e depois convergiu ficava preso em FAILED para sempre, e o
// envelope publicava `scorecard 78/78 / overallStatus=VERIFIED` ao lado de
// `runStatus=FAILED / NO_GO` sem que nenhuma máquina pudesse reconciliar os dois.
// Recuperar é permitido (FAILED → RUNNING → COMPLETED); certificar um run ainda
// em FAILED, nunca (ver CERTIFIABLE_FINAL_STATES).
const ALLOWED_TRANSITIONS = Object.freeze({
  [RUN_STATES.CREATED]: new Set([RUN_STATES.RUNNING, RUN_STATES.FAILED, RUN_STATES.INVALIDATED]),
  [RUN_STATES.RUNNING]: new Set([RUN_STATES.COMPLETED, RUN_STATES.FAILED, RUN_STATES.INVALIDATED]),
  [RUN_STATES.FAILED]: new Set([RUN_STATES.RUNNING, RUN_STATES.INVALIDATED]),
  [RUN_STATES.COMPLETED]: new Set([RUN_STATES.PACKAGED, RUN_STATES.INVALIDATED]),
  [RUN_STATES.PACKAGED]: new Set([RUN_STATES.VERIFIED, RUN_STATES.INVALIDATED]),
  [RUN_STATES.VERIFIED]: new Set(),
  [RUN_STATES.INVALIDATED]: new Set(),
});

/**
 * Estados finais que PODEM sustentar certificação/release.
 * A ordem é a do ciclo: concluído → empacotado → verificado.
 */
const CERTIFIABLE_FINAL_STATES = Object.freeze([
  RUN_STATES.COMPLETED,
  RUN_STATES.PACKAGED,
  RUN_STATES.VERIFIED,
]);

/**
 * Estados que NUNCA certificam, em nenhuma fase. `FAILED` não é "ainda vai
 * convergir": é o desfecho REGISTRADO de uma decisão NO_GO. `INVALIDATED` é a
 * marca de drift de fonte (o run nem descreve a fonte atual).
 */
const NON_CERTIFIABLE_STATES = Object.freeze([
  RUN_STATES.FAILED,
  RUN_STATES.INVALIDATED,
]);

/**
 * Um status sustenta certificação final?
 * @returns {{certifiable:boolean, code:string|null, reason:string}}
 */
function assessCertifiableRunStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, normalized)) {
    return {
      certifiable: false,
      code: 'RUN_STATUS_UNKNOWN',
      reason: `status de run desconhecido: ${status || 'missing'}`,
    };
  }
  if (NON_CERTIFIABLE_STATES.includes(normalized)) {
    return {
      certifiable: false,
      code: normalized === RUN_STATES.INVALIDATED ? 'RUN_INVALIDATED' : 'RUN_STATUS_NOT_CERTIFIABLE',
      reason: `run em ${normalized} não pode ser certificado: transicione para ${RUN_STATES.RUNNING} (recuperação) e conclua o ciclo (${CERTIFIABLE_FINAL_STATES.join('/')}) antes de certificar`,
    };
  }
  return { certifiable: true, code: null, reason: `status ${normalized} pode certificar` };
}

function runContextPath(rootDir = DEFAULT_ROOT) {
  return path.join(path.resolve(rootDir), RUN_CONTEXT_RELATIVE_PATH);
}

function toIso(now = () => new Date()) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw runContextError('INVALID_RUN_CONTEXT', 'invalid timestamp');
  return date.toISOString();
}

function runContextError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  return error;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validateRunContext(run) {
  const missing = [];
  for (const field of ['runId', 'sourceFingerprint', 'startedAt', 'generatedAt', 'status', 'artifactType', 'artifactVersion']) {
    if (run?.[field] == null || run[field] === '') missing.push(field);
  }
  if (missing.length > 0) {
    return { valid: false, code: 'INVALID_RUN_CONTEXT', reason: `missing fields: ${missing.join(', ')}`, missing };
  }
  if (!isSha256(run.sourceFingerprint)) {
    return { valid: false, code: 'INVALID_RUN_CONTEXT', reason: 'sourceFingerprint must be a full SHA-256' };
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, run.status)) {
    return { valid: false, code: 'INVALID_RUN_CONTEXT', reason: `unknown status: ${run.status}` };
  }
  if (run.artifactType !== 'run-context') {
    return { valid: false, code: 'INVALID_RUN_CONTEXT', reason: `artifactType must be run-context, got ${run.artifactType}` };
  }
  if (Number.isNaN(Date.parse(run.startedAt)) || Number.isNaN(Date.parse(run.generatedAt))) {
    return { valid: false, code: 'INVALID_RUN_CONTEXT', reason: 'startedAt/generatedAt must be ISO timestamps' };
  }
  return { valid: true, code: 'CURRENT_RUN' };
}

function writeRunContext(rootDir, record) {
  const target = runContextPath(rootDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  return record;
}

function readRunContext(rootDir = DEFAULT_ROOT) {
  const target = runContextPath(rootDir);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw runContextError('INVALID_RUN_CONTEXT', `cannot parse ${RUN_CONTEXT_RELATIVE_PATH}: ${error.message}`);
  }
}

function requireRunContext(rootDir = DEFAULT_ROOT) {
  const run = readRunContext(rootDir);
  if (!run) throw runContextError('RUN_CONTEXT_REQUIRED', `${RUN_CONTEXT_RELATIVE_PATH} is missing`);
  const validation = validateRunContext(run);
  if (!validation.valid) throw runContextError(validation.code, validation.reason, validation);
  return run;
}

function createRunContext({ rootDir = DEFAULT_ROOT, sourceFingerprint, runId, now = () => new Date(), metadata = {} } = {}) {
  if (!isSha256(sourceFingerprint)) {
    throw runContextError('INVALID_RUN_CONTEXT', 'sourceFingerprint must be a full SHA-256');
  }
  const timestamp = toIso(now);
  const record = {
    runId: runId || generateRunId(sourceFingerprint),
    sourceFingerprint,
    startedAt: timestamp,
    generatedAt: timestamp,
    status: RUN_STATES.CREATED,
    artifactType: 'run-context',
    artifactVersion: RUN_CONTEXT_VERSION,
    stageHistory: [],
    ...metadata,
  };
  record.runId = runId || record.runId;
  record.sourceFingerprint = sourceFingerprint;
  record.startedAt = timestamp;
  record.generatedAt = timestamp;
  record.status = RUN_STATES.CREATED;
  record.artifactType = 'run-context';
  record.artifactVersion = RUN_CONTEXT_VERSION;
  const validation = validateRunContext(record);
  if (!validation.valid) throw runContextError(validation.code, validation.reason, validation);
  return writeRunContext(rootDir, record);
}

function transitionRunContext({ rootDir = DEFAULT_ROOT, toStatus, now = () => new Date(), metadata = {} } = {}) {
  const run = requireRunContext(rootDir);
  const allowed = ALLOWED_TRANSITIONS[run.status];
  if (!allowed || !allowed.has(toStatus)) {
    throw runContextError('INVALID_RUN_TRANSITION', `${run.status} -> ${toStatus} is not allowed`, {
      fromStatus: run.status,
      toStatus,
    });
  }
  const timestamp = toIso(now);
  const next = {
    ...run,
    ...metadata,
    status: toStatus,
    generatedAt: timestamp,
  };
  if (toStatus === RUN_STATES.COMPLETED) next.completedAt = timestamp;
  if (toStatus === RUN_STATES.PACKAGED) next.packagedAt = timestamp;
  if (toStatus === RUN_STATES.VERIFIED) next.verifiedAt = timestamp;
  if (toStatus === RUN_STATES.INVALIDATED) next.invalidatedAt = timestamp;
  return writeRunContext(rootDir, next);
}

function invalidateForDrift({ rootDir, run, stage, actualSourceFingerprint, now }) {
  const timestamp = toIso(now);
  const invalidation = {
    reason: 'RUN_SOURCE_DRIFT',
    stage,
    expectedSourceFingerprint: run.sourceFingerprint,
    actualSourceFingerprint,
    detectedAt: timestamp,
  };
  const invalidated = {
    ...run,
    status: RUN_STATES.INVALIDATED,
    generatedAt: timestamp,
    invalidatedAt: timestamp,
    invalidation,
  };
  writeRunContext(rootDir, invalidated);
  throw runContextError(
    'RUN_SOURCE_DRIFT',
    `${stage}: expected ${run.sourceFingerprint}, got ${actualSourceFingerprint}`,
    invalidation,
  );
}

function assertSourceFreeze({
  rootDir = DEFAULT_ROOT,
  stage,
  computeSourceFingerprint,
  now = () => new Date(),
} = {}) {
  if (!stage) throw runContextError('INVALID_RUN_STAGE', 'stage is required');
  let run = requireRunContext(rootDir);
  if (run.status === RUN_STATES.INVALIDATED) {
    throw runContextError('RUN_INVALIDATED', `${run.runId} is invalidated`, run.invalidation || {});
  }
  if (run.status === RUN_STATES.VERIFIED) {
    throw runContextError('RUN_ALREADY_VERIFIED', `${run.runId} is immutable and already verified`);
  }
  const compute = computeSourceFingerprint || (() => {
    const { computeSourceFingerprint: computeCanonical } = require('../proof-engine/fingerprint-chain');
    return computeCanonical(path.resolve(rootDir));
  });
  const actualSourceFingerprint = compute(path.resolve(rootDir));
  if (!isSha256(actualSourceFingerprint)) {
    throw runContextError('SOURCE_FINGERPRINT_INVALID', `${stage}: canonical fingerprint is not SHA-256`);
  }
  if (actualSourceFingerprint !== run.sourceFingerprint) {
    return invalidateForDrift({ rootDir, run, stage, actualSourceFingerprint, now });
  }

  const timestamp = toIso(now);
  const nextStatus = run.status === RUN_STATES.CREATED ? RUN_STATES.RUNNING : run.status;
  run = {
    ...run,
    status: nextStatus,
    generatedAt: timestamp,
    lastGovernedStage: stage,
    lastSourceVerificationAt: timestamp,
    stageHistory: [
      ...(Array.isArray(run.stageHistory) ? run.stageHistory : []),
      { stage, sourceFingerprint: actualSourceFingerprint, verifiedAt: timestamp },
    ],
  };
  return writeRunContext(rootDir, run);
}

module.exports = {
  RUN_STATES,
  RUN_CONTEXT_VERSION,
  RUN_CONTEXT_RELATIVE_PATH,
  ALLOWED_TRANSITIONS,
  CERTIFIABLE_FINAL_STATES,
  NON_CERTIFIABLE_STATES,
  assessCertifiableRunStatus,
  createRunContext,
  readRunContext,
  requireRunContext,
  validateRunContext,
  transitionRunContext,
  assertSourceFreeze,
  runContextPath,
  isSha256,
};
