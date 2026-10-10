'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLineage } = require('../../governance/report-lineage');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports');

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(readText(relPath));
  } catch (_) {
    return fallback;
  }
}

/**
 * Escreve um relatório oficial de governança em `reports/`.
 *
 * LINEAGE NA ORIGEM (P2-2): este helper é o produtor comum de 36 validadores, e
 * apenas 5 deles chamavam `withLineage`. Medição de 2026-10-10: dos 154 relatórios
 * em `reports/`, **120 não tinham `runId`** — artefatos impossíveis de vincular ao
 * run que os produziu. O próprio `governance/report-lineage.js` documenta a classe
 * do defeito: depender de um stamp POSTERIOR cria uma janela em que o artefato
 * existe sem runId, e qualquer avaliação nessa janela reprova com
 * ARTIFACT_RUN_ID_MISSING (root cause de RAP-052/RAP-054 caírem para 6/10 no
 * release r-agent2-20260903-134904).
 *
 * Centralizar aqui corrige todos os produtores de uma vez, em vez de exigir que
 * cada script novo lembre de chamar o helper. `withLineage` é idempotente e não
 * sobrescreve campo já preenchido, então quem já emite lineage continua mandando.
 *
 * O `artifactType` é derivado do nome do arquivo quando o relatório não declara um
 * (convenção medida no repositório: em 42 dos 52 relatórios que declaram
 * `artifactType`, o valor é exatamente o nome do arquivo sem `.json`).
 */
function writeReport(name, report, opts = {}) {
  const rootDir = opts.rootDir || ROOT;
  const reportsDir = opts.rootDir ? path.join(opts.rootDir, 'reports') : REPORTS_DIR;
  if (!opts.rootDir) ensureReportsDir();
  else fs.mkdirSync(reportsDir, { recursive: true });
  const out = path.join(reportsDir, name);
  const artifactType = report && typeof report.artifactType === 'string' && report.artifactType.trim() !== ''
    ? report.artifactType
    : String(name).replace(/\.json$/, '');
  const payload = withLineage(
    {
      generatedAt: new Date().toISOString(),
      ...report,
    },
    artifactType,
    { rootDir },
  );
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  return out;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function listFiles(dirRel, predicate = () => true) {
  const start = path.join(ROOT, dirRel);
  if (!fs.existsSync(start)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (predicate(full)) {
        out.push(rel(full));
      }
    }
  };
  walk(start);
  return out.sort();
}

function statusFromIssues(issues) {
  return issues.length === 0 ? 'PASS' : 'FAIL';
}

function failIfNeeded(report) {
  if (report.status && report.status !== 'PASS') {
    console.error(`[governance] ${report.name || 'validator'}: ${report.status}`);
    for (const issue of report.issues || []) {
      console.error(` - ${issue.code || 'issue'}: ${issue.message || issue}`);
    }
    process.exit(1);
  }
}

function scoreFromStatus(status, passScore = 100, failScore = 0) {
  return status === 'PASS' ? passScore : failScore;
}

module.exports = {
  ROOT,
  REPORTS_DIR,
  ensureReportsDir,
  exists,
  failIfNeeded,
  listFiles,
  readJson,
  readText,
  rel,
  scoreFromStatus,
  sha256,
  statusFromIssues,
  writeReport,
};
