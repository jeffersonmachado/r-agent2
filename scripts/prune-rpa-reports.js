'use strict';

/**
 * Expurgo por RETENÇÃO das evidências de RPA em `tests/rpa/reports`.
 *
 * MOTIVAÇÃO (medida em 2026-10-02, não presumida)
 * -----------------------------------------------
 * O diretório acumulava 1,4 GB / 25.420 arquivos (10.784 json, 10.748 md,
 * 3.888 png), crescendo de forma contínua (~70-350 arquivos/dia) desde
 * 2026-08-19, sem nenhuma política de retenção.
 *
 * O expurgo que já existia (`scripts/reset-all.sh`) apaga apenas `*.json` e
 * `*.txt`, e só roda como parte de um reset completo do ambiente — ou seja,
 * `.md` e `.png` nunca eram recolhidos, e nada roda de forma periódica.
 *
 * Ainda assim, este diretório NÃO é lixo:
 *   - é a evidência por bug do loop autônomo (json + relatório legível + print);
 *   - é referenciado por `evidenceArtifacts.jsonPath/markdownPath` nos replays.
 * Por isso a rotina é de RETENÇÃO, não de wipe.
 *
 * GARANTIAS (fail-closed)
 * -----------------------
 * 1. DRY-RUN POR PADRÃO. Nada é removido sem `--execute`.
 * 2. Preserva os ponteiros vivos que o runtime lê:
 *    `*-latest.json`, `*-latest.md`, `demo-relatorio.json`.
 *    (`tests/rpa/business/reporting.js` lê `business-qa-latest.json`.)
 * 3. Preserva `bug-memory.json` — é a memória do bug loop autônomo
 *    (`core/rpa/bugResolution/bugMemoryStore.js`).
 * 4. Só considera arquivos cujo NOME casa um padrão de evidência conhecido.
 *    Qualquer nome não reconhecido é PRESERVADO (nunca apagamos o que não
 *    sabemos classificar).
 * 5. Não segue symlinks e não sai de `tests/rpa/reports`.
 * 6. Retenção inválida (NaN, <= 0) aborta em vez de virar "apaga tudo".
 *
 * USO
 * ---
 *   node scripts/prune-rpa-reports.js                   # dry-run (default)
 *   node scripts/prune-rpa-reports.js --execute         # remove de fato
 *   node scripts/prune-rpa-reports.js --execute --days=7 # janela de retenção
 *   RPA_REPORTS_RETENTION_DAYS=15 node scripts/prune-rpa-reports.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const TARGET_REL = path.join('tests', 'rpa', 'reports');
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Basenames que o runtime lê e que nunca podem ser removidos. */
const PRESERVED_BASENAMES = new Set(['demo-relatorio.json', 'bug-memory.json']);

/**
 * Padrões de evidência elegíveis ao expurgo. Deliberadamente estreitos: um
 * arquivo com nome não reconhecido é preservado.
 */
const PRUNABLE_PATTERNS = Object.freeze([
  /^business-qa-.*\.(json|md)$/,
  /^bug-\d+-[a-z0-9]+\.(json|md)$/i,
  /^bug-state-\d+-[a-z0-9]+\.png$/i,
  /^rpa-report-.*\.(json|md)$/,
  /^rpa-detail-.*\.(json|md)$/,
]);

/** Extraído para teste puro: o nome nunca pode ser removido? */
function isPreservedName(name) {
  const base = String(name || '');
  if (PRESERVED_BASENAMES.has(base)) return true;
  // ponteiros vivos: business-qa-latest.json / .md
  if (/-latest\.(json|md)$/i.test(base)) return true;
  return false;
}

/** Extraído para teste puro: o nome é uma evidência elegível ao expurgo? */
function isPrunableName(name) {
  const base = String(name || '');
  if (!base || isPreservedName(base)) return false;
  return PRUNABLE_PATTERNS.some((pattern) => pattern.test(base));
}

/** Extraído para teste puro: o arquivo já venceu a janela de retenção? */
function isExpired({ mtimeMs, nowMs, retentionMs }) {
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(nowMs) || !Number.isFinite(retentionMs)) {
    return false; // fail-closed: sem dado confiável, não expira
  }
  return nowMs - mtimeMs > retentionMs;
}

/** Resolve a janela de retenção a partir de CLI/env, com validação. */
function resolveRetentionDays({ cliDays, envDays } = {}) {
  const raw = cliDays !== undefined && cliDays !== null ? cliDays : envDays;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`retencao_invalida: ${raw} (esperado numero > 0 de dias)`);
  }
  return parsed;
}

function parseArgs(argv) {
  const out = { execute: false, days: undefined };
  for (const arg of argv) {
    if (arg === '--execute') out.execute = true;
    else if (arg.startsWith('--days=')) out.days = arg.slice('--days='.length);
  }
  return out;
}

/** Percorre o alvo sem seguir symlinks e coleta os candidatos. */
function collectCandidates(targetDir, { nowMs, retentionMs }) {
  const selected = [];
  const preservedByPattern = [];
  const unrecognized = [];
  let scanned = 0;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // não seguir
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;

      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch (_) {
        continue;
      }

      if (isPreservedName(entry.name)) {
        preservedByPattern.push(full);
        continue;
      }
      if (!isPrunableName(entry.name)) {
        unrecognized.push(full);
        continue;
      }
      if (!isExpired({ mtimeMs: stat.mtimeMs, nowMs, retentionMs })) continue;

      selected.push({ full, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };

  walk(targetDir);
  return { selected, preservedByPattern, unrecognized, scanned };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let retentionDays;
  try {
    retentionDays = resolveRetentionDays({ cliDays: args.days, envDays: process.env.RPA_REPORTS_RETENTION_DAYS });
  } catch (error) {
    console.error(`[prune-rpa-reports] ABORTADO — ${error.message}`);
    return 2;
  }

  const targetDir = path.resolve(ROOT_DIR, TARGET_REL);
  const expectedSuffix = path.join('tests', 'rpa', 'reports');
  if (!targetDir.endsWith(expectedSuffix)) {
    console.error(`[prune-rpa-reports] ABORTADO — alvo inesperado: ${targetDir}`);
    return 2;
  }
  if (!fs.existsSync(targetDir)) {
    console.log(`[prune-rpa-reports] nada a fazer — ${TARGET_REL} nao existe`);
    return 0;
  }

  const nowMs = Date.now();
  const retentionMs = retentionDays * DAY_MS;
  const cutoffIso = new Date(nowMs - retentionMs).toISOString();

  const { selected, preservedByPattern, unrecognized, scanned } = collectCandidates(targetDir, {
    nowMs,
    retentionMs,
  });

  const totalBytes = selected.reduce((sum, item) => sum + item.size, 0);

  console.log('[prune-rpa-reports] ' + (args.execute ? 'MODO: EXECUTAR' : 'MODO: DRY-RUN (use --execute para remover)'));
  console.log(`  alvo            : ${TARGET_REL}`);
  console.log(`  retencao        : ${retentionDays} dia(s) — corta antes de ${cutoffIso}`);
  console.log(`  arquivos varridos: ${scanned}`);
  console.log(`  elegiveis a remocao: ${selected.length} (${formatBytes(totalBytes)})`);
  console.log(`  preservados (ponteiros/memoria): ${preservedByPattern.length}`);
  console.log(`  nao reconhecidos (preservados): ${unrecognized.length}`);

  if (!selected.length) {
    console.log('[prune-rpa-reports] nada vencido — nenhuma acao.');
    return 0;
  }

  if (!args.execute) {
    const preview = selected
      .slice()
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .slice(0, 5)
      .map((item) => `    ${path.relative(ROOT_DIR, item.full)}`);
    console.log(`  exemplos (mais antigos):\n${preview.join('\n')}`);
    console.log('[prune-rpa-reports] DRY-RUN: nada foi removido.');
    return 0;
  }

  let removed = 0;
  let freed = 0;
  let failed = 0;
  for (const item of selected) {
    try {
      fs.unlinkSync(item.full);
      removed += 1;
      freed += item.size;
    } catch (_) {
      failed += 1;
    }
  }

  console.log(`[prune-rpa-reports] removidos: ${removed} (${formatBytes(freed)}); falhas: ${failed}`);
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  PRESERVED_BASENAMES,
  PRUNABLE_PATTERNS,
  TARGET_REL,
  isPreservedName,
  isPrunableName,
  isExpired,
  resolveRetentionDays,
  parseArgs,
  collectCandidates,
  main,
};
