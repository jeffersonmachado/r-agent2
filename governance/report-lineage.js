#!/usr/bin/env node
'use strict';

/**
 * Report Lineage — lineage canônico de artefatos de governança no produtor.
 *
 * Todo relatório de governança deve nascer COM lineage completo. Depender de
 * um stamp posterior (scripts/governance/stamp-report-lineage.js) cria uma
 * janela em que o artefato existe sem runId — e qualquer avaliação nessa
 * janela reprova com ARTIFACT_RUN_ID_MISSING (root cause de RAP-052/RAP-054
 * caírem para 6/10 no release r-agent2-20260903-134904). O stamp permanece
 * como backstop, mas os produtores passam a emitir lineage na origem.
 *
 * Fonte do lineage: governance/.current-run.json (run governado atual).
 * Fail-open controlado: se não houver run governado, retorna campos null —
 * os consumidores (scorecard/verifiers) tratam ausência como INVALID, então
 * emitir null explicitamente é equivalente ao comportamento anterior, mas a
 * emissão acontece sempre que o run existe.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CURRENT_RUN_PATH = path.join(ROOT, 'governance', '.current-run.json');

/**
 * Fingerprint do AMBIENTE — onde a evidência foi produzida.
 *
 * DEFEITO MEDIDO (2026-10-11): o contrato único de evidência exige
 * `environmentFingerprint` e ele NÃO existia em lugar nenhum — 0 de 24 artefatos
 * eram conformes. Sem ele, duas evidências do mesmo run em ambientes diferentes
 * (estação vs container) são indistinguíveis, e "passou aqui" não diz onde.
 *
 * Derivado de fatos do processo (runtime root, versão do Node, plataforma e alvo do
 * banco). É determinístico para o mesmo ambiente e não carrega segredo algum.
 */
function environmentFingerprint(rootDir = ROOT) {
  const { resolveRuntimePath } = (() => {
    try { return require(path.join(rootDir, 'api', 'utils', 'runtimePaths')); } catch (_) { return {}; }
  })();
  let runtimeRoot = null;
  try { runtimeRoot = typeof resolveRuntimePath === 'function' ? resolveRuntimePath() : null; } catch (_) { runtimeRoot = null; }
  let dbAlvo = null;
  try {
    const dsn = process.env.DATABASE_URL || '';
    if (dsn) {
      const url = new URL(dsn);
      dbAlvo = `${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`;
    }
  } catch (_) { dbAlvo = null; }
  const fatos = {
    runtimeRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    dbAlvo,
  };
  return crypto.createHash('sha256').update(JSON.stringify(fatos)).digest('hex');
}

/**
 * Hash da CONFIGURAÇÃO sob a qual a evidência foi produzida: conteúdo do
 * `api/data/config.json` (quando existe) + fingerprint de política do run.
 * Ausente NÃO é inventado: sem fonte, devolve null (o consumidor trata como
 * incompleto, em vez de aceitar um hash de conveniência).
 */
function configurationHash(rootDir = ROOT, run = null) {
  const partes = [];
  try {
    const cfg = path.join(rootDir, 'api', 'data', 'config.json');
    if (fs.existsSync(cfg)) partes.push(fs.readFileSync(cfg, 'utf8'));
  } catch (_) { /* sem config legível */ }
  const policyFingerprint = (run && run.policyFingerprint) || (run && run.policy && run.policy.policyFingerprint) || null;
  if (policyFingerprint) partes.push(String(policyFingerprint));
  if (partes.length === 0) return null;
  return crypto.createHash('sha256').update(partes.join('\u0000')).digest('hex');
}

/** Identidade do PRODUTOR: qual script gerou o artefato (caminho relativo). */
function producerIdentity(rootDir = ROOT) {
  const declarado = String(process.env.GOVERNED_PRODUCER || '').trim();
  if (declarado) return declarado;
  const argv = process.argv[1] ? path.relative(rootDir, process.argv[1]) : null;
  return argv && argv !== '' && !argv.startsWith('..') ? argv : null;
}

function readCurrentRun(rootDir = ROOT) {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(rootDir, 'governance', '.current-run.json'), 'utf8'));
    return run && typeof run === 'object' ? run : null;
  } catch (_) {
    return null;
  }
}

function currentGitField(args, rootDir = ROOT) {
  try {
    const { execFileSync } = require('child_process');
    return String(execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }) || '').trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Lineage canônico para um artefato de governança.
 *
 * @param {string} artifactType  ex.: 'package-validation-report'
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.artifactVersion]
 * @param {boolean} [opts.includeGit]  inclui gitCommit/gitTree (custo de um git rev-parse)
 */
function currentLineage(artifactType, opts = {}) {
  const rootDir = opts.rootDir || ROOT;
  const run = readCurrentRun(rootDir);
  const agora = opts.now ? new Date(opts.now) : new Date();
  const lineage = {
    artifactType: artifactType || null,
    artifactVersion: opts.artifactVersion || '1.0.0',
    generatedAt: agora.toISOString(),
    runId: run?.runId || null,
    sourceFingerprint: run?.sourceFingerprint || null,
    // ── Campos do contrato único de evidência deriváveis na ORIGEM ──────────────
    // Antes o produtor emitia só runId/sourceFingerprint/generatedAt, e o contrato
    // reprovava 24 de 24 artefatos por campos que ninguém escrevia. Aqui entram os
    // que podem ser derivados com honestidade; os que dependem do que o produtor
    // EXECUTOU (testPlanHash/testResultHash/evidenceManifestHash/candidateCommit)
    // continuam vindo por `opts` — melhor ausentes do que inventados.
    sourceCommit: run?.sourceCommit || opts.sourceCommit || null,
    candidateCommit: opts.candidateCommit || null,
    environmentFingerprint: opts.environmentFingerprint || environmentFingerprint(rootDir),
    configurationHash: opts.configurationHash || configurationHash(rootDir, run),
    policyVersion: opts.policyVersion || run?.policyVersion || run?.policy?.policyVersion || null,
    testPlanHash: opts.testPlanHash || null,
    testResultHash: opts.testResultHash || null,
    evidenceManifestHash: opts.evidenceManifestHash || null,
    // Início REAL do processo produtor (não um carimbo do momento do merge): derivado
    // do uptime, então é verificável e não depende de o produtor lembrar de medir.
    startedAt: opts.startedAt
      || (typeof process.uptime === 'function'
        ? new Date(Date.now() - process.uptime() * 1000).toISOString()
        : null),
    finishedAt: opts.finishedAt || agora.toISOString(),
    producer: opts.producer || producerIdentity(rootDir),
  };
  if (opts.includeGit) {
    lineage.gitCommit = currentGitField(['rev-parse', 'HEAD'], rootDir);
    lineage.gitTree = currentGitField(['rev-parse', 'HEAD^{tree}'], rootDir);
  }
  return lineage;
}

/**
 * Aplica lineage a um objeto de relatório sem sobrescrever campos de decisão.
 * Campos de lineage existentes e válidos são preservados (idempotente).
 */
function withLineage(report, artifactType, opts = {}) {
  const lineage = currentLineage(artifactType, opts);
  const merged = { ...report };
  for (const [key, value] of Object.entries(lineage)) {
    if (merged[key] === undefined || merged[key] === null) merged[key] = value;
  }
  // `blockingFindings` é campo do contrato e o produtor quase sempre já tem a lista
  // com outro nome (`blocking`, `violations`). Normalizar aqui evita que a MESMA
  // informação conte como ausente só por vocabulário — lista vazia ≠ ausente.
  if (merged.blockingFindings === undefined || merged.blockingFindings === null) {
    const origem = merged.blocking || merged.violations || merged.blocking_findings;
    merged.blockingFindings = Array.isArray(origem) ? origem : [];
  }
  return merged;
}

module.exports = {
  CURRENT_RUN_PATH,
  readCurrentRun,
  currentLineage,
  withLineage,
  environmentFingerprint,
  configurationHash,
  producerIdentity,
};
