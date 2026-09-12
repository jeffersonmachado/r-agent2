#!/usr/bin/env node
'use strict';

/**
 * validate-manual-sanitization.js — GATE §A1–A6 (bloqueante).
 *
 * Varre as superfícies de conhecimento classificadas como **PRODUCTION** pela
 * taxonomia canônica (`api/services/rag/knowledgeSurfaceClassification.js`,
 * a MESMA usada pelo `scripts/rag-sync.js`) e falha se qualquer uma expuser
 * detalhe interno: replay, seletor/alvo técnico, QA wave/mesh, cenário, seed,
 * passo de RPA, caminho de artefato de QA, endpoint interno de QA/RPA, comando
 * de gate ou ferramenta de automação de browser.
 *
 * Por que superfície PRODUCTION e não "tudo": a missão (§A2) permite que a
 * proveniência técnica viva em SUPPORT/DEVELOPMENT. `docs/roteiros/manual-*` e
 * `docs/roteiros/treinamento-*` são OPERATIONAL/**SUPPORT** — internals ali são
 * legítimos e auditáveis. Exigir limpeza deles destruiria prova sem proteger o
 * operador.
 *
 * A varredura usa o CLASSIFICADOR, não uma lista de pastas escrita à mão: se a
 * taxonomia mudar, o gate acompanha.
 *
 * Saída: `reports/manual-sanitization-report.json`
 * Uso: node scripts/governance/validate-manual-sanitization.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  detectProductionLeaks,
} = require('../../api/services/learning/manualSanitizer');
const {
  isProductionSurface, resolveDomainClassification,
} = require('../../api/services/rag/knowledgeSurfaceClassification');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'manual-sanitization-report.json');

/** Raízes varridas: superfícies de conhecimento que podem ser PRODUCTION. */
const SCAN_ROOTS = Object.freeze(['docs']);
const SCAN_EXTENSIONS = Object.freeze(['.md', '.html']);
const SKIP_DIRS = Object.freeze(new Set(['img', 'node_modules', '.git']));

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) acc.push(abs);
  }
  return acc;
}

function main() {
  const scanned = [];
  const productionFiles = [];
  const leaks = [];

  for (const root of SCAN_ROOTS) {
    for (const abs of walk(path.join(ROOT_DIR, root))) {
      const rel = path.relative(ROOT_DIR, abs).split(path.sep).join('/');
      scanned.push(rel);
      if (!isProductionSurface(rel)) continue;
      productionFiles.push(rel);
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (_) {
        continue;
      }
      for (const leak of detectProductionLeaks(content)) {
        leaks.push({
          file: rel,
          ruleId: leak.ruleId,
          description: leak.description,
          match: leak.match,
          index: leak.index,
        });
      }
    }
  }

  const report = {
    reportType: 'manual-sanitization',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: leaks.length === 0 ? 'PASS' : 'FAIL',
    decision: leaks.length === 0 ? 'PRODUCTION_CONTENT_CLEAN' : 'PRODUCTION_CONTENT_LEAK',
    taxonomySource: 'api/services/rag/knowledgeSurfaceClassification.js',
    filesScanned: scanned.length,
    productionFilesScanned: productionFiles.length,
    productionSurfaces: productionFiles.sort(),
    leaks,
    leakCount: leaks.length,
    // Amostra explícita de que SUPPORT é intencionalmente excluído (§A2).
    supportExamplesExcluded: scanned
      .filter((rel) => resolveDomainClassification(rel).classification === 'SUPPORT')
      .slice(0, 10),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[manual-sanitization] status=${report.status} supervisionados=${productionFiles.length} `
      + `varridos=${scanned.length} vazamentos=${leaks.length}\n`,
    );
    for (const leak of leaks.slice(0, 40)) {
      process.stdout.write(`  ! ${leak.file}: ${leak.ruleId}("${leak.match}")\n`);
    }
  }

  process.exit(leaks.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main, REPORT_PATH, SCAN_ROOTS };
