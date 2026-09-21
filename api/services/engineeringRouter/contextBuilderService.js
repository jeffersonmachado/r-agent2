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
const { applySecretPolicy } = require('../../../engine/engineeringRouter/secretRedaction');
const { globToRegExp, normalize } = require('../../../engine/engineeringRouter/pathBoundary');
const logger = require('../../utils/logger');

const ROOT = path.resolve(__dirname, '..', '..', '..');
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

/** Resolve globs de `allowedPaths` para caminhos de arquivo reais existentes no repositório. */
function expandGlobsToFiles(globs) {
  const matched = new Set();
  for (const glob of globs || []) {
    const g = normalize(glob);
    const abs = path.join(ROOT, g);
    // Caminho literal (sem wildcard) apontando para um arquivo existente.
    if (!g.includes('*')) {
      try {
        if (fs.statSync(abs).isFile()) {
          matched.add(g);
          continue;
        }
      } catch (_) { /* não é arquivo direto — tenta como diretório abaixo */ }
    }
    const base = baseDirOf(g);
    const re = globToRegExp(g);
    for (const filePath of walkFiles(base)) {
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

  // Prioridade: arquivos de teste que falharam (mais relevantes para diagnóstico) primeiro,
  // depois o escopo autorizado pelo Task Contract.
  const priorityCandidates = failingTestPaths.map(normalize).filter((p) => {
    try { return fs.statSync(path.join(ROOT, p)).isFile(); } catch (_) { return false; }
  });
  const scopeCandidates = expandGlobsToFiles(allowedPaths);

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
    const content = readFileSafe(relPath);
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
    budget: { maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES, usedBytes, maxFiles: DEFAULT_MAX_FILES },
  };
}

module.exports = {
  ROOT,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_FILES,
  expandGlobsToFiles,
  buildContext,
};
