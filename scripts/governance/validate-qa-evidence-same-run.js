#!/usr/bin/env node
'use strict';

/**
 * validate-qa-evidence-same-run.js — gate QA_EVIDENCE_SAME_RUN.
 *
 * DEFEITO REPRODUZIDO (2026-09-19): `qa-mesh/go-no-go-report.json` estava na
 * lista de `scripts/governance/stamp-report-lineage.js` (stamp genérico). O
 * script PRESERVA o `generatedAt` original e anexa `runId`/`sourceFingerprint`
 * do run mais recente — então um relatório produzido às 10:46 passou a
 * carregar o runId do run criado às 20:18. Isso NÃO é evidência same-run: é
 * ADOÇÃO RETROATIVA de lineage, e o efeito é pior que não ter lineage, porque
 * o engine de certificação passa a aceitar como prova de um run algo que
 * aquele run nunca executou.
 *
 * O script já reconhece a regra para um artefato (comentário explícito sobre
 * `delivered-release-verification-report.json`); este gate a aplica a TODOS os
 * artefatos declarados como RUNTIME_EVIDENCE em
 * `config/runtime-evidence-artifacts.json`.
 *
 * Invariantes verificados (cada um vira violação tipada):
 *   QA_EVIDENCE_LINEAGE_MISSING   — artefato sem runId ou sourceFingerprint;
 *   QA_EVIDENCE_RUN_UNKNOWN       — runId ausente no banco de runs;
 *   QA_EVIDENCE_SAME_RUN_VIOLATION— generatedAt < run.started_at (produzido
 *                                   ANTES do run: não pode ser prova dele);
 *   QA_EVIDENCE_SOURCE_MISMATCH   — sourceFingerprint difere do run;
 *   QA_EVIDENCE_NO_TIMESTAMP      — sem generatedAt não há prova temporal.
 *
 * Saída: reports/qa-evidence-same-run-report.json
 * Uso: node scripts/governance/validate-qa-evidence-same-run.js
 */

const fs = require('fs');
const path = require('path');

// Fonte UNICA da classificacao por modo de producao. O mesmo modulo e usado
// pela guarda do produtor (scripts/governance/stamp-report-lineage.js), para
// que "recusar estampar" e "reprovar no gate" nunca divirjam.
const {
  MODES,
  CONFIG_PATH,
  normalizeArtifactPath,
  loadConfig,
} = require('./lib/runtime-evidence-artifacts');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'qa-evidence-same-run-report.json');

const CODES = Object.freeze({
  LINEAGE_MISSING: 'QA_EVIDENCE_LINEAGE_MISSING',
  RUN_UNKNOWN: 'QA_EVIDENCE_RUN_UNKNOWN',
  SAME_RUN_VIOLATION: 'QA_EVIDENCE_SAME_RUN_VIOLATION',
  SOURCE_MISMATCH: 'QA_EVIDENCE_SOURCE_MISMATCH',
  NO_TIMESTAMP: 'QA_EVIDENCE_NO_TIMESTAMP',
  INVALID_TIMESTAMP: 'QA_EVIDENCE_TIMESTAMP_INVALID',
});

function readJson(absOrRel) {
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(ROOT_DIR, absOrRel);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
}

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function parseTime(value) {
  if (!isNonEmptyString(value)) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

async function loadRunsByIds(runIds) {
  const { connect, close } = require('../../api/db/sequelize');
  const getRun = require('../../api/db/models/GovernanceRun');
  await connect();
  try {
    const rows = await getRun().findAll({ where: { run_id: runIds } });
    const map = new Map();
    for (const row of rows) {
      const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
      map.set(plain.run_id, plain);
    }
    return map;
  } finally {
    await close().catch(() => {});
  }
}

function evaluateArtifact(relPath, doc, run) {
  const violations = [];
  const mode = 'RUNTIME_EVIDENCE';
  const runId = doc?.runId || null;
  const fingerprint = doc?.sourceFingerprint || null;
  const generatedAt = parseTime(doc?.generatedAt);

  if (!isNonEmptyString(runId) || !isNonEmptyString(fingerprint)) {
    violations.push({ code: CODES.LINEAGE_MISSING, artifact: relPath, runId, fingerprint });
  }
  if (!isNonEmptyString(doc?.generatedAt)) {
    violations.push({ code: CODES.NO_TIMESTAMP, artifact: relPath });
  } else if (generatedAt === null) {
    violations.push({ code: CODES.INVALID_TIMESTAMP, artifact: relPath, generatedAt: doc.generatedAt });
  }
  if (!run) {
    if (isNonEmptyString(runId)) violations.push({ code: CODES.RUN_UNKNOWN, artifact: relPath, runId });
    return { artifact: relPath, mode, runId, fingerprint, generatedAt: doc?.generatedAt || null, sameRun: false, violations };
  }

  const startedAt = parseTime(run.started_at instanceof Date ? run.started_at.toISOString() : run.started_at);
  const completedAt = parseTime(run.completed_at instanceof Date ? run.completed_at.toISOString() : run.completed_at);

  // PROVA TEMPORAL: o artefato tem de ter sido produzido DEPOIS do início do
  // run que o reivindica. Antes disso é adotação retroativa.
  let sameRun = true;
  if (generatedAt !== null && startedAt !== null && generatedAt < startedAt) {
    sameRun = false;
    violations.push({
      code: CODES.SAME_RUN_VIOLATION,
      artifact: relPath,
      generatedAt: doc.generatedAt,
      runStartedAt: new Date(startedAt).toISOString(),
      deltaSeconds: Math.round((startedAt - generatedAt) / 1000),
      detail: 'artefato produzido ANTES do run que o reivindica: adoção retroativa de lineage',
    });
  }
  if (generatedAt !== null && completedAt !== null && generatedAt > completedAt) {
    // Produzido depois do fim do run: também não é prova DESTE run.
    sameRun = false;
    violations.push({
      code: CODES.SAME_RUN_VIOLATION,
      artifact: relPath,
      generatedAt: doc.generatedAt,
      runCompletedAt: new Date(completedAt).toISOString(),
      detail: 'artefato produzido DEPOIS do run que o reivindica',
    });
  }
  if (isNonEmptyString(fingerprint) && isNonEmptyString(run.source_fingerprint)
    && fingerprint !== run.source_fingerprint) {
    violations.push({
      code: CODES.SOURCE_MISMATCH,
      artifact: relPath,
      artifactFingerprint: fingerprint,
      runFingerprint: run.source_fingerprint,
    });
  }

  return {
    artifact: relPath,
    mode,
    runId,
    fingerprint,
    generatedAt: doc?.generatedAt || null,
    runStartedAt: startedAt !== null ? new Date(startedAt).toISOString() : null,
    sameRun,
    violations,
  };
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(
      `[qa-evidence-same-run] config ausente/inválido: ${path.relative(ROOT_DIR, CONFIG_PATH)} (${error.message})`
    );
    process.exitCode = 1;
    return;
  }
  const runtimeArtifacts = Object.entries(config.artifacts)
    .filter(([, mode]) => mode === MODES.RUNTIME_EVIDENCE)
    .map(([rel]) => rel)
    .sort();

  const docs = runtimeArtifacts.map((rel) => ({ rel, doc: readJson(rel) }));
  const runIds = [...new Set(docs.map((d) => d.doc?.runId).filter(isNonEmptyString))];
  const runs = await loadRunsByIds(runIds);

  const evaluations = docs.map(({ rel, doc }) => {
    if (!doc) return { artifact: rel, violations: [], missing: true, sameRun: false };
    return evaluateArtifact(rel, doc, runs.get(doc.runId) || null);
  });

  const violations = evaluations.flatMap((e) => (e.violations || []).map((v) => ({ ...v, mode: e.mode })));
  const present = evaluations.filter((e) => !e.missing);
  const sameRunOk = present.filter((e) => e.sameRun === true).length;

  const report = {
    validator: 'validate-qa-evidence-same-run',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    artifactsChecked: present.length,
    artifactsDeclared: runtimeArtifacts.length,
    sameRunOk,
    runIds: [...runs.keys()],
    evaluations: evaluations.map((e) => ({
      artifact: e.artifact,
      missing: e.missing === true,
      runId: e.runId || null,
      generatedAt: e.generatedAt || null,
      runStartedAt: e.runStartedAt || null,
      sameRun: e.sameRun === true,
    })),
    violations,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[qa-evidence-same-run] status=${report.status} artefatos=${present.length}/${runtimeArtifacts.length} same-run-ok=${sameRunOk} violacoes=${violations.length}`);
  for (const v of violations.slice(0, 12)) {
    console.log(`  - ${v.code}: ${v.artifact}${v.detail ? ` — ${v.detail}` : ''}`);
  }
  console.log(`[qa-evidence-same-run] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  if (violations.length > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
