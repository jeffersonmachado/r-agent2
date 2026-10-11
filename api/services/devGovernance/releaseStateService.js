'use strict';

/**
 * Estado do release (leitura) para a superfície de engenharia.
 *
 * FATOS, não narrativa. Este serviço lê o que já foi produzido pelos artefatos
 * canônicos (run corrente, dist/, relatórios de gate) e entrega ao modelo puro
 * `engine/governance/releaseStateModel` para decidir o veredito e a
 * disponibilidade das ações.
 *
 * Nada aqui executa o pipeline: ações são responsabilidade de
 * `releaseActionService` (allowlist explícita, execução governada).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const logger = require('../../utils/logger');
const { deriveReleaseState } = require('../../../engine/governance/releaseStateModel');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', '..');

/**
 * Relatórios canônicos de decisão.
 *
 * Cada um declara o PRÓPRIO predicado de "está ok" — o vocabulário de decisão
 * NÃO é uniforme neste repo (`final-consistency` usa `pass`/`allChecksPass` com
 * `finalDecision = AUTONOMOUS_READY_GO`; o QA Mesh usa `status = GO`). Inferir
 * bloqueio a partir do token da decisão produzia FALSO BLOQUEIO — medido em
 * 2026-10-11: `final-consistency-report.json` (pass=true) aparecia como bloqueio
 * porque `AUTONOMOUS_READY_GO` não casa com `^(GO|PASS|OK)$`.
 *
 * Regra cardinal: DESCONHECIDO NÃO É BLOQUEIO. Só vira bloqueio o que o próprio
 * relatório declara como não-ok.
 */
const DECISION_REPORTS = Object.freeze([
  {
    code: 'final_consistency',
    title: 'Final Consistency Gate',
    file: path.join('dist', 'governance', 'final-consistency-report.json'),
    decisionOf: (report) => report.finalDecision || report.decision || null,
    isOk: (report) => report.pass === true || report.allChecksPass === true,
    whyOf: (report) => {
      const failing = Array.isArray(report.failedChecks) ? report.failedChecks : [];
      if (failing.length > 0) return `${failing.length} verificação(ões) falha(s)`;
      return `consistência final não aprovada (score ${report.overallConsistencyScore ?? 'n/d'})`;
    },
  },
  {
    code: 'delivered_release',
    title: 'Verificação do release entregue',
    file: path.join('reports', 'delivered-release-verification-report.json'),
    decisionOf: (report) => report.delivered || report.finalDecision || report.status || null,
    isOk: (report) => /VERIFIED/i.test(String(report.delivered || report.finalDecision || '')),
    whyOf: (report) => {
      const failed = Array.isArray(report.failedGates) ? report.failedGates : [];
      return failed.length > 0
        ? `${failed.length} gate(s) falho(s): ${failed.slice(0, 4).map((gate) => (typeof gate === 'string' ? gate : gate.name || gate.code || '?')).join(', ')}`
        : 'o release entregue não foi verificado';
    },
  },
  {
    code: 'qa_mesh',
    title: 'QA Mesh Go/No-Go',
    file: path.join('qa-mesh', 'go-no-go-report.json'),
    decisionOf: (report) => report.status || report.decision || null,
    isOk: (report) => /^(GO|PASS)$/i.test(String(report.status || report.decision || '')),
    whyOf: (report) => (Array.isArray(report.reasons) && report.reasons.length > 0
      ? `motivos: ${report.reasons.slice(0, 3).join(', ')}`
      : 'QA Mesh não está em GO'),
  },
]);

/**
 * Bloqueios a partir dos relatórios canônicos. Relatório ausente/ilegível entra
 * em `unavailable` (evidência faltante, declarada) — nunca vira bloqueio
 * inventado nem silêncio.
 */
function collectReleaseBlockers(rootDir) {
  const blockers = [];
  const unavailable = [];
  for (const entry of DECISION_REPORTS) {
    const relPath = entry.file.replace(/\\/g, '/');
    const report = readJsonSafe(path.join(rootDir, entry.file));
    if (!report) {
      unavailable.push({ code: entry.code, title: entry.title, path: relPath, reason: 'relatório ausente ou ilegível' });
      continue;
    }
    if (entry.isOk(report)) continue;
    blockers.push({
      code: entry.code,
      title: entry.title,
      decision: entry.decisionOf(report) ? String(entry.decisionOf(report)) : 'UNKNOWN',
      severity: 'high',
      blocked: true,
      why: entry.whyOf(report),
      evidence: relPath,
    });
  }
  return { blockers, unavailable };
}

function readJsonSafe(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    logger.warn(`[dev-governance] JSON ilegível em ${path.relative(DEFAULT_ROOT, absPath)}: ${error.message}`);
    return null;
  }
}

/** git com argumentos FIXOS (sem shell) — nunca interpola entrada de usuário. */
function git(cwd, args, { timeout = 10000 } = {}) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout }).toString('utf8').trim();
  } catch (_) {
    return null;
  }
}

function readHead(rootDir) {
  const commit = git(rootDir, ['rev-parse', 'HEAD']);
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) return null;
  const tree = git(rootDir, ['rev-parse', 'HEAD^{tree}']);
  const status = git(rootDir, ['status', '--porcelain']);
  const dirtyFiles = status ? status.split('\n').filter((line) => line.trim().length > 0) : [];
  return {
    commit,
    tree: tree && /^[0-9a-f]{40}$/.test(tree) ? tree : null,
    clean: dirtyFiles.length === 0,
    dirtyCount: dirtyFiles.length,
  };
}

function readCurrentRun(rootDir) {
  return readJsonSafe(path.join(rootDir, 'governance', '.current-run.json'));
}

function listArtifacts(rootDir) {
  const list = (rel) => {
    const abs = path.join(rootDir, rel);
    try {
      if (!fs.existsSync(abs)) return [];
      return fs.readdirSync(abs)
        .filter((name) => !name.startsWith('.'))
        .map((name) => {
          const stat = fs.statSync(path.join(abs, name));
          return { name, bytes: stat.size, path: path.posix.join(rel.replace(/\\/g, '/'), name) };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) {
      return [];
    }
  };
  return {
    delivered: list(path.join('dist', 'release')),
    candidate: list(path.join('dist', 'candidate')),
    archive: list(path.join('dist', 'archive')),
  };
}

/** Nome do release derivado dos artefatos entregues (nunca de entrada do usuário). */
function deriveReleaseName(artifacts) {
  const manifest = artifacts.delivered.find((file) => file.name.endsWith('.delivered.identity.json'));
  if (manifest) return manifest.name.replace(/\.delivered\.identity\.json$/, '');
  const zip = artifacts.delivered.find((file) => file.name.endsWith('.zip') && !file.name.endsWith('.payload.zip'));
  if (zip) return zip.name.replace(/\.zip$/, '');
  return null;
}

/**
 * Guard local de push. Se existir um hook que recusa `refs/tags/*`, a publicação
 * de tag NÃO é oferecida — e o motivo do guard é exibido VERBATIM. A UI informa;
 * ela não contorna (nem remove hook, nem usa `--no-verify`).
 */
function readPushGuard(rootDir) {
  const hookPath = path.join(rootDir, '.git', 'hooks', 'pre-push');
  const relPath = '.git/hooks/pre-push';
  if (!fs.existsSync(hookPath)) return { blocksTagPush: false, reason: null, path: null };
  let content = '';
  try {
    content = fs.readFileSync(hookPath, 'utf8');
  } catch (_) {
    return { blocksTagPush: false, reason: null, path: null };
  }
  const blocksTagPush = /refs\/tags\//.test(content);
  if (!blocksTagPush) return { blocksTagPush: false, reason: null, path: relPath };
  const echoLine = content.split('\n').map((line) => line.trim()).find((line) => /echo\s+".*TAG/i.test(line));
  const reason = echoLine
    ? echoLine.replace(/^echo\s+"/, '').replace(/"\s*>.*$/, '').replace(/\\n$/, '')
    : 'hook local recusa push de refs/tags/*';
  return { blocksTagPush: true, reason, path: relPath };
}

async function getReleaseState({ rootDir = DEFAULT_ROOT } = {}) {
  const run = readCurrentRun(rootDir);
  const head = readHead(rootDir);
  const artifacts = listArtifacts(rootDir);
  const guard = readPushGuard(rootDir);
  const releaseName = deriveReleaseName(artifacts);
  const deliveredReport = readJsonSafe(path.join(rootDir, 'reports', 'delivered-release-verification-report.json'));
  const deliveredVerdict = deliveredReport
    ? (deliveredReport.delivered || deliveredReport.finalDecision || deliveredReport.status || null)
    : null;
  const { blockers, unavailable } = collectReleaseBlockers(rootDir);

  return deriveReleaseState({
    run,
    head,
    artifacts,
    guard,
    blockers,
    releaseName,
    deliveredVerdict: deliveredVerdict ? String(deliveredVerdict) : null,
    evidenceUnavailable: unavailable,
  });
}

module.exports = {
  DECISION_REPORTS,
  DEFAULT_ROOT,
  getReleaseState,
  collectReleaseBlockers,
  deriveReleaseName,
  readPushGuard,
  readHead,
  readCurrentRun,
  listArtifacts,
};
