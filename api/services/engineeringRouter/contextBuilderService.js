'use strict';

/**
 * api/services/engineeringRouter/contextBuilderService.js
 *
 * EngineeringContextBuilder — parte de I/O (leitura real de arquivos do repositório). A
 * política de segurança (bloqueio/redação de segredo) é a função pura
 * `engine/engineeringRouter/secretRedaction.js`; este serviço só resolve QUAIS arquivos entram,
 * lê o conteúdo real e aplica orçamento/dedupe, sempre registrando o que foi incluído/excluído
 * para auditoria (nunca envia o repositório inteiro silenciosamente).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { applySecretPolicy } = require('../../../engine/engineeringRouter/secretRedaction');
const { globToRegExp, normalize } = require('../../../engine/engineeringRouter/pathBoundary');
const logger = require('../../utils/logger');

// ER-V1-SEALFIX-002 (Real Container Deployment) — achado real: `path.resolve(__dirname, ...)`
// resolve a raiz do monorepo relativa a ONDE ESTE ARQUIVO está fisicamente no filesystem de
// QUEM o executa. Isso é correto quando o processo roda direto no host (dev, Jest) — mas quebra
// em produção containerizada: o container da API não necessariamente monta o checkout do
// projeto no MESMO caminho absoluto que o HOST usa, e o Engineering Runner (container SEPARADO,
// que fala com o Docker daemon do HOST via socket) precisa que os caminhos que ele passa em
// `docker run -v <origem>:<destino>` sejam caminhos REAIS DO HOST — nunca um caminho que só faz
// sentido de dentro do container que o calculou. `ENGINEERING_ROUTER_HOST_REPO_ROOT`, quando
// definida (produção containerizada: aponta para o bind mount do checkout real do host,
// montado no MESMO caminho absoluto em api/engineering-runner), tem precedência; sem ela,
// mantém o comportamento atual (dev/Jest, processo rodando direto no host).
const ROOT = process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT
  ? path.resolve(process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT)
  : path.resolve(__dirname, '..', '..', '..');
const DEFAULT_MAX_TOTAL_BYTES = Number(process.env.ENGINEERING_ROUTER_CONTEXT_MAX_BYTES || 60 * 1024);
const DEFAULT_MAX_FILES = Number(process.env.ENGINEERING_ROUTER_CONTEXT_MAX_FILES || 20);
const MAX_DIR_ENTRIES_WALKED = 5000;

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'reports']);

function baseDirOf(glob) {
  const g = normalize(glob);
  const idx = g.search(/[*]/);
  if (idx === -1) return g;
  const prefix = g.slice(0, idx);
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash === -1 ? '' : prefix.slice(0, lastSlash);
}

/** Caminha uma subárvore real do repositório coletando arquivos (bounded). */
function walkFiles(startRelDir, { maxEntries = MAX_DIR_ENTRIES_WALKED } = {}) {
  const startAbs = path.join(ROOT, startRelDir || '.');
  const out = [];
  let visited = 0;
  const stack = [startAbs];
  while (stack.length > 0 && visited < maxEntries) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited >= maxEntries) break;
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(normalize(path.relative(ROOT, abs)));
      }
    }
  }
  return out;
}

/** Resolve globs de `allowedPaths` para caminhos de arquivo reais existentes na FONTE da task. */
function expandGlobsToFiles(globs, reader = null) {
  const source = reader || createSourceReader({});
  const matched = new Set();
  for (const glob of globs || []) {
    const g = normalize(glob);
    if (!g.includes('*')) {
      // Caminho literal: só entra se existir NA FONTE (commit da missão ou checkout).
      if (source.isFile(g)) matched.add(g);
      continue;
    }
    const base = baseDirOf(g);
    const re = globToRegExp(g);
    const listing = source.listFiles();
    const candidates = listing === null ? walkFiles(base) : listing.filter((p) => p === base || p.startsWith(`${base}/`) || base === '');
    for (const filePath of candidates) {
      if (re.test(filePath)) matched.add(filePath);
    }
  }
  return [...matched];
}

function readFileSafe(relPath) {
  try {
    const stat = fs.statSync(path.join(ROOT, relPath));
    if (!stat.isFile()) return null;
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch (_) {
    return null;
  }
}

/** Executa git no checkout principal (ROOT). Nunca lança: devolve null em falha. */
function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return null;
  }
}

/**
 * MOTIVO DE FALHA ESTÁVEL para fonte de contexto não materializável.
 *
 * Deliberadamente compartilha o vocabulário de `patchApplyService.resolveTaskBaseCommit`
 * (`MISSION_SOURCE_NOT_INHERITED`, `MISSION_SOURCE_COMMIT_UNRESOLVABLE`): o mesmo fato — "a base
 * declarada não existe" — recebe o mesmo nome nos dois lados do fluxo (contexto e workspace).
 */
const CONTEXT_SOURCE_REASONS = Object.freeze({
  MISSION_SOURCE_NOT_INHERITED: 'MISSION_SOURCE_NOT_INHERITED',
  MISSION_SOURCE_COMMIT_UNRESOLVABLE: 'MISSION_SOURCE_COMMIT_UNRESOLVABLE',
});

function contextSourceError({ task, commit, reason, message }) {
  const err = new Error(message);
  err.code = 'CONTEXT_SOURCE_UNRESOLVABLE';
  err.reason = reason;
  err.failureClass = 'SOURCE_IDENTITY';
  err.taskId = task && task.id ? task.id : null;
  err.sourceCommit = commit || null;
  return err;
}

/**
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — COERÊNCIA CONTEXTO↔WORKSPACE.
 *
 * Defeito real medido: o workspace onde o patch é aplicado é materializado do `source_commit` da
 * task (fonte da Engineering Mission), mas este construtor lia os arquivos do CHECKOUT PRINCIPAL
 * (main). Em qualquer incremento cujo arquivo-alvo tenha sido alterado por um incremento anterior
 * da MESMA missão, o CODER recebia o conteúdo ANTIGO — e o patch não aplicava
 * (`PATCH_APPLY_FAILED`) ou, pior, aplicava sobre premissas erradas. Medido no INC-2B: 155 linhas
 * existiam na fonte e não no main (`missionReplanService.js`, `missionStoreService.js`).
 *
 * L-1 (2026-10-20) — FALHA EXPLÍCITA, NUNCA DEGRADAÇÃO SILENCIOSA.
 * O resolvedor anterior lia do checkout principal quando o `source_commit` declarado era
 * irresolvível (só um `logger.warn`). Isso é o mesmo defeito de origem, um nível acima: o CODER
 * era alimentado com a base ERRADA e o workspace onde o patch seria aplicado nem existiria
 * (`patchApplyService` já falhava fechado com `MISSION_SOURCE_COMMIT_UNRESOLVABLE`). Regra agora:
 *   - `MISSION_SOURCE` quando a task declara `source_commit` VÁLIDO (`git ls-tree`/`git show`);
 *   - `ROOT` somente para task avulsa que NÃO declara base alguma (compatibilidade);
 *   - DECLAROU base ⇒ ela precisa existir. Task de missão sem `source_commit` também falha
 *     (materializar da main reintroduziria o fix que nunca entra na fonte da missão).
 *
 * @returns {{kind:'MISSION_SOURCE'|'ROOT', commit:string|null, listFiles:()=>string[], readFile:(p:string)=>string|null, isFile:(p:string) => boolean}}
 * @throws {Error} code=`CONTEXT_SOURCE_UNRESOLVABLE` quando a base declarada não pode ser lida.
 */
function createSourceReader(task = {}) {
  const commit = String(task.source_commit || task.sourceCommit || '').trim();
  const missionId = task.mission_id || task.missionId || null;
  const rootReader = {
    kind: 'ROOT',
    commit: null,
    listFiles: () => null,
    readFile: readFileSafe,
    isFile: (relPath) => {
      try { return fs.statSync(path.join(ROOT, relPath)).isFile(); } catch (_) { return false; }
    },
  };
  if (commit === '') {
    if (missionId) {
      throw contextSourceError({
        task,
        commit: null,
        reason: CONTEXT_SOURCE_REASONS.MISSION_SOURCE_NOT_INHERITED,
        message: `task ${task.id} pertence à missão ${missionId} mas não declara \`source_commit\` — `
          + 'ler do checkout principal produziria contexto de outra base (incoerente com o workspace)',
      });
    }
    return rootReader;
  }
  if (runGit(['cat-file', '-e', `${commit}^{commit}`]) === null) {
    throw contextSourceError({
      task,
      commit,
      reason: CONTEXT_SOURCE_REASONS.MISSION_SOURCE_COMMIT_UNRESOLVABLE,
      message: `\`source_commit\` ${commit.slice(0, 12)} declarado pela task ${task.id} não existe neste `
        + 'repositório — o contexto NÃO é lido do checkout principal (a base declarada é a única válida)',
    });
  }

  let cachedListing = null;
  const listFiles = () => {
    if (cachedListing === null) {
      const out = runGit(['ls-tree', '-r', '--name-only', commit]);
      cachedListing = out === null ? [] : out.split('\n').map((l) => l.trim()).filter((l) => l !== '').map(normalize);
    }
    return cachedListing;
  };

  return {
    kind: 'MISSION_SOURCE',
    commit,
    listFiles,
    readFile: (relPath) => runGit(['show', `${commit}:${relPath}`]),
    isFile: (relPath) => listFiles().includes(normalize(relPath)),
  };
}

/**
 * Monta o contexto real para uma EngineeringTask/tentativa.
 *
 * @param {Object} task - EngineeringTask (linha do banco, plain)
 * @param {Object} [options]
 * @param {Object|null} [options.failureBundle] - {failedCommand, failedTests[], stderr, diff}
 * @param {Object|null} [options.previousAttempt]
 * @returns {{task:Object, files:Object[], failureBundle:Object|null, includedFiles:string[], blockedFiles:Object[], skippedFiles:Object[], budget:Object}}
 */
function buildContext(task, { failureBundle = null, previousAttempt = null } = {}) {
  const allowedPaths = Array.isArray(task.allowed_paths) ? task.allowed_paths : (task.allowedPaths || []);
  const failingTestPaths = Array.isArray(failureBundle?.failedTests) ? failureBundle.failedTests : [];
  // FONTE DE LEITURA: commit da missão quando a task declara source_commit (coerência com o
  // workspace onde o patch será aplicado); checkout principal caso contrário.
  const reader = createSourceReader(task);

  // Prioridade: arquivos de teste que falharam (mais relevantes para diagnóstico) primeiro,
  // depois o escopo autorizado pelo Task Contract.
  const priorityCandidates = failingTestPaths.map(normalize).filter((p) => reader.isFile(p));
  const scopeCandidates = expandGlobsToFiles(allowedPaths, reader);

  const orderedCandidates = [...new Set([...priorityCandidates, ...scopeCandidates])];

  const includedFiles = [];
  const skippedFiles = [];
  const rawFiles = [];
  let usedBytes = 0;

  for (const relPath of orderedCandidates) {
    if (includedFiles.length >= DEFAULT_MAX_FILES) {
      skippedFiles.push({ path: relPath, reason: 'MAX_FILES_REACHED' });
      continue;
    }
    const content = reader.readFile(relPath);
    if (content == null) {
      skippedFiles.push({ path: relPath, reason: 'UNREADABLE_OR_BINARY' });
      continue;
    }
    const size = Buffer.byteLength(content, 'utf8');
    if (usedBytes + size > DEFAULT_MAX_TOTAL_BYTES) {
      skippedFiles.push({ path: relPath, reason: 'BUDGET_EXCEEDED' });
      continue;
    }
    rawFiles.push({ path: relPath, content });
    includedFiles.push(relPath);
    usedBytes += size;
  }

  const { files: safeFiles, blocked } = applySecretPolicy(rawFiles);
  const totalRedactedLines = safeFiles.reduce((acc, f) => acc + (f.redactedLineCount || 0), 0);
  if (totalRedactedLines > 0) {
    logger.warn('[engineeringContextBuilder] segredo(s) redigido(s) do contexto', { taskId: task.id, totalRedactedLines });
  }

  return {
    task: {
      id: task.id,
      title: task.title,
      objective: task.objective,
      taskType: task.task_type || task.taskType,
      risk: task.risk,
      scope: task.scope,
      acceptanceCriteria: task.acceptance_criteria || task.acceptanceCriteria || [],
      allowedPaths,
      forbiddenPaths: task.forbidden_paths || task.forbiddenPaths || [],
    },
    files: safeFiles.map((f) => ({ path: f.path, content: f.content })),
    failureBundle: failureBundle || null,
    previousAttemptSummary: previousAttempt
      ? { attemptNumber: previousAttempt.attempt_number, status: previousAttempt.status, patchValidation: previousAttempt.patch_validation }
      : null,
    includedFiles: safeFiles.map((f) => f.path),
    blockedFiles: blocked,
    skippedFiles,
    // Auditoria da FONTE usada (coerência contexto↔workspace): fica registrado no attempt.
    sourceOrigin: { kind: reader.kind, commit: reader.commit },
    budget: { maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES, usedBytes, maxFiles: DEFAULT_MAX_FILES },
  };
}

module.exports = {
  ROOT,
  CONTEXT_SOURCE_REASONS,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_FILES,
  createSourceReader,
  expandGlobsToFiles,
  buildContext,
};
