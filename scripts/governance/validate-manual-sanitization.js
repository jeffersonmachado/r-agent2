#!/usr/bin/env node
'use strict';

/**
 * validate-manual-sanitization.js — GATE de sanitização PRODUCTION (bloqueante).
 *
 * O gate EXECUTA e varre cada superfície que entrega conteúdo ao operador:
 *
 *   MANUAL_MARKDOWN  gera um manual real a partir de um replay de prova e lê o
 *                    `manual.md` escrito em disco;
 *   MANUAL_HTML      renderiza o HTML A4 impresso (o mesmo que vira PDF);
 *   MANUAL_PDF       imprime o PDF no Chromium (Playwright) e EXTRAI o texto do
 *                    artefato final — se o PDF não puder ser produzido/provado,
 *                    o gate FALHA (não existe "pular e passar");
 *   MANUAL_RAG       projeta o documento do índice OPERACIONAL;
 *   MANUAL_API       executa o handler real das rotas (GET/POST de manuais) com
 *                    autenticação e classificação de plataforma e varre o JSON;
 *   MANUAL_DOCS      varredura estática das fontes `docs/**` PRODUCTION pela
 *                    taxonomia canônica (`api/services/rag/knowledgeSurfaceClassification.js`,
 *                    a MESMA usada pelo `scripts/rag-sync.js`) + projeção real
 *                    de ingestão do rag-sync.
 *
 * Falha se qualquer saída expuser detalhe interno: replay, seletor/alvo
 * técnico, QA wave/mesh, cenário, seed, passo de RPA, caminho de artefato de
 * QA, endpoint interno de QA/RPA, comando de gate ou ferramenta de automação
 * de browser.
 *
 * Por que superfície PRODUCTION e não "tudo": a missão (§A2) permite que a
 * proveniência técnica viva em SUPPORT/DEVELOPMENT. `docs/roteiros/manual-*` e
 * `docs/roteiros/treinamento-*` são OPERATIONAL/**SUPPORT** — internals ali são
 * legítimos e auditáveis. Exigir limpeza deles destruiria prova sem proteger o
 * operador.
 *
 * Também roda CONTROLES NEGATIVOS (anti-falso-positivo: `Seletor de data` e
 * `# Título` NÃO podem acionar o detector) e POSITIVOS (o fail-closed tem de
 * lançar de verdade). Os executores vivem em
 * `scripts/governance/lib/manualSanitizationSurfaces.js`.
 *
 * Saída: `reports/manual-sanitization-report.json`
 * Uso: node scripts/governance/validate-manual-sanitization.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  runAllSurfaces, SCAN_ROOTS: SURFACE_SCAN_ROOTS, ROOT_DIR: SURFACE_ROOT_DIR,
} = require('./lib/manualSanitizationSurfaces');

const ROOT_DIR = SURFACE_ROOT_DIR;
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'manual-sanitization-report.json');

/** Raízes varridas: superfícies de conhecimento que podem ser PRODUCTION. */
const SCAN_ROOTS = SURFACE_SCAN_ROOTS;

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  const result = await runAllSurfaces();
  const { surfaces, controls, failClosedControls, static: staticResult, leaks } = result;

  const report = {
    reportType: 'manual-sanitization',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: result.status,
    decision: result.status === 'PASS' ? 'PRODUCTION_CONTENT_CLEAN' : 'PRODUCTION_CONTENT_LEAK',
    taxonomySource: 'api/services/rag/knowledgeSurfaceClassification.js',
    executionModel: 'executa e varre a SAÍDA (markdown/HTML/PDF/API/RAG) + varredura estática',
    surfaces: Object.fromEntries(surfaces.map((surface) => [surface.surface, {
      status: surface.status,
      executed: surface.executed,
      evidence: surface.evidence,
      leakCount: surface.leaks.length,
      mustContainViolations: surface.mustContainViolations,
      error: surface.error,
    }])),
    failedSurfaces: result.failedSurfaces,
    antiFalsePositiveControls: controls,
    failClosedControls,
    failedControls: result.failedControls,
    filesScanned: staticResult.scanned.length,
    productionFilesScanned: staticResult.productionFiles.length,
    productionSurfaces: staticResult.productionFiles.slice().sort(),
    supportExamplesExcluded: staticResult.supportExamplesExcluded,
    leaks,
    leakCount: leaks.length,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[manual-sanitization] status=${report.status} `
      + `superficies=${surfaces.map((s) => `${s.surface}:${s.status}`).join(' ')} `
      + `docs=${staticResult.productionFiles.length} vazamentos=${leaks.length}\n`,
    );
    for (const surface of surfaces) {
      if (surface.error) process.stdout.write(`  ! ${surface.surface}: ${surface.error}\n`);
      for (const violation of surface.mustContainViolations) {
        process.stdout.write(
          `  ! ${surface.surface}/${violation.artifact}: conteúdo operacional ausente "${violation.needle}"\n`,
        );
      }
    }
    for (const control of [...controls, ...failClosedControls]) {
      if (control.status !== 'PASS') {
        process.stdout.write(`  ! controle ${control.control}: ${JSON.stringify(control)}\n`);
      }
    }
    for (const leak of leaks.slice(0, 40)) {
      process.stdout.write(`  ! ${leak.surface || ''}/${leak.artifact || leak.file}: ${leak.ruleId}("${leak.match}")\n`);
    }
  }

  process.exit(result.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[manual-sanitization] FATAL: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { main, REPORT_PATH, SCAN_ROOTS, gitCommit };
