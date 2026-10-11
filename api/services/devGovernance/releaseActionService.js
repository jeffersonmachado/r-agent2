'use strict';

/**
 * Ações governadas de release.
 *
 * Princípios (o oposto de "botão que roda qualquer coisa"):
 *   1. ALLOWLIST FECHADA: cada ação é um comando canônico com argumentos FIXOS
 *      declarados aqui. Não existe ação parametrizada por entrada do cliente — o
 *      nome do release é DERIVADO dos artefatos server-side e validado contra um
 *      padrão estrito antes de virar argumento.
 *   2. CONFirmação explícita: ação mutante exige `confirm: true` no corpo.
 *   3. SINGLE-FLIGHT: uma ação por vez; o pipeline de selagem mexe em `dist/`.
 *   4. PRÉ-CONDIÇÃO HONESTA: se a árvore está suja ou o guard local recusa push
 *      de tag, a ação é RECUSADA com o mesmo motivo que a UI exibe. Nada aqui
 *      remove hook, usa `--no-verify` ou contorna guard de governança.
 *   5. AUSÊNCIA DE EVIDÊNCIA ≠ SUCESSO: o resultado é o exit code real do
 *      processo; log integral fica em arquivo fora do workspace.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const logger = require('../../utils/logger');
const { resolveRuntimePath } = require('../../utils/runtimePaths');
const { getReleaseState, DEFAULT_ROOT } = require('./releaseStateService');

const RELEASE_NAME_PATTERN = /^r-agent2-\d{8}-\d{6}$/;

const ACTION_IDS = Object.freeze({
  VERIFY: 'verify',
  SEAL: 'seal',
  PUBLISH_TAG: 'publish-tag',
});

/**
 * Catálogo fechado. `logicalKey` (não o comando) é o que a UI escolhe.
 * `mutates` marca o que exige confirmação explícita.
 */
const ACTION_CATALOG = Object.freeze({
  [ACTION_IDS.VERIFY]: {
    id: ACTION_IDS.VERIFY,
    label: 'Verificar o entregue',
    command: 'npm',
    args: ['run', '--silent', 'verify:delivered-release'],
    mutates: false,
    timeoutMs: 900000,
  },
  [ACTION_IDS.SEAL]: {
    id: ACTION_IDS.SEAL,
    label: 'Novo ciclo de selagem',
    command: 'bash',
    args: ['scripts/governance/seal-release.sh'],
    mutates: true,
    timeoutMs: 5400000,
  },
  [ACTION_IDS.PUBLISH_TAG]: {
    id: ACTION_IDS.PUBLISH_TAG,
    label: 'Publicar a tag do release',
    command: 'bash',
    // O argumento da tag é acrescentado em tempo de execução, DERIVADO e validado.
    args: ['scripts/create-release-tag.sh'],
    mutates: true,
    timeoutMs: 600000,
  },
});

/** Registro de execuções (processo único). Sobrevive em disco pelo log; em
 * memória, um restart da API zera o status — o log permanece acessível. */
const jobs = new Map();
const MAX_JOBS = 40;

function codedError(code, message, statusCode = 400) {
  const error = new Error(message ? `${code}:${message}` : code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function pruneJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const ordered = [...jobs.values()].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  for (const job of ordered.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id);
}

function runningJob() {
  for (const job of jobs.values()) {
    if (job.status === 'running') return job;
  }
  return null;
}

function actionDefinition(actionId) {
  const definition = ACTION_CATALOG[actionId];
  if (!definition) throw codedError('unknown_release_action', String(actionId || ''), 400);
  return definition;
}

/**
 * Pré-condições derivadas do MESMO estado que a UI mostra. Recusar aqui evita
 * oferecer um botão que só falharia depois — e mantém uma única fonte de verdade
 * sobre por que a ação não está disponível.
 */
async function assertPreconditions(actionId, { rootDir, state }) {
  const resolved = state || await getReleaseState({ rootDir });
  const byId = new Map(resolved.actions.map((action) => [action.id, action]));
  const action = byId.get(actionId);
  if (!action) throw codedError('unknown_release_action', actionId, 400);
  if (action.enabled !== true) {
    throw codedError('release_action_unavailable', action.blockedReason || 'ação indisponível no estado atual', 409);
  }
  return resolved;
}

function openLog(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return fs.openSync(logPath, 'a');
}

/**
 * Executa uma ação da allowlist.
 *
 * @param {object} input
 * @param {string}  input.actionId
 * @param {boolean} input.confirm    exigido para ação mutante
 * @param {string}  [input.rootDir]
 */
async function runReleaseAction({ actionId, confirm = false, rootDir = DEFAULT_ROOT, actor = null } = {}) {
  const definition = actionDefinition(actionId);
  if (definition.mutates && confirm !== true) {
    throw codedError('confirmation_required', 'ação que altera o repositório exige confirmação explícita', 400);
  }

  const current = runningJob();
  if (current) {
    throw codedError('release_action_in_flight', `já existe uma ação em execução (${current.actionId} ${current.id})`, 409);
  }

  const state = await assertPreconditions(actionId, { rootDir });
  const args = definition.args.slice();

  if (actionId === ACTION_IDS.PUBLISH_TAG) {
    const releaseName = state.releaseName;
    if (!releaseName || !RELEASE_NAME_PATTERN.test(releaseName)) {
      throw codedError('release_name_invalid', 'nome do release indisponível ou fora do padrão esperado', 409);
    }
    args.push(releaseName);
  }

  const logDir = resolveRuntimePath('logs', 'dev-governance');
  const id = crypto.randomUUID();
  const logPath = path.join(logDir, `release-${actionId}-${id}.log`);
  const job = {
    id,
    actionId,
    label: definition.label,
    status: 'running',
    mutates: definition.mutates === true,
    actor: actor || null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logPath,
    releaseName: state.releaseName || null,
  };
  jobs.set(job.id, job);
  pruneJobs();

  let stream;
  try {
    const fd = openLog(logPath);
    stream = fs.createWriteStream(null, { fd });
    const child = spawn(definition.command, args, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    job.pid = child.pid;
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
        job.timedOut = true;
      } catch (_) { /* processo já saiu */ }
    }, definition.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      job.status = 'failed';
      job.exitCode = null;
      job.finishedAt = new Date().toISOString();
      job.error = error.message;
      stream.end();
      logger.error(`[dev-governance] ação ${actionId} não pôde iniciar: ${error.message}`);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      job.exitCode = typeof code === 'number' ? code : null;
      job.signal = signal || null;
      job.status = code === 0 ? 'succeeded' : 'failed';
      job.finishedAt = new Date().toISOString();
      stream.end();
      logger.info(`[dev-governance] ação ${actionId} terminou: ${job.status} (exit ${code})`);
    });
  } catch (error) {
    if (stream) stream.end();
    job.status = 'failed';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    throw codedError('release_action_spawn_failed', error.message, 500);
  }

  return { ...job, commandPreview: `${definition.command} ${args.join(' ')}` };
}

function readLogTail(logPath, { maxBytes = 12000 } = {}) {
  try {
    const stat = fs.statSync(logPath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logPath, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (_) {
    return null;
  }
}

function getReleaseAction({ jobId } = {}) {
  const job = jobs.get(String(jobId || ''));
  if (!job) throw codedError('release_action_not_found', String(jobId || ''), 404);
  return { ...job, logTail: readLogTail(job.logPath) };
}

function listReleaseActions() {
  return [...jobs.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .map((job) => ({ ...job, logTail: null }));
}

module.exports = {
  ACTION_IDS,
  ACTION_CATALOG,
  RELEASE_NAME_PATTERN,
  runReleaseAction,
  getReleaseAction,
  listReleaseActions,
  readLogTail,
};
