#!/usr/bin/env node
'use strict';

/**
 * Preflight de evidencia de wave por RUN (fail-fast) — exigido pela vinculacao
 * por runId introduzida no P1-11 (validate-coverage-gate).
 *
 * POR QUE ISSO EXISTE (medido): o `seal-release.sh` cria um run governado novo
 * quando detecta RUN_SOURCE_DRIFT e depois reexecuta a converge. A partir do
 * P1-11, as 3 waves tecnicas passam a ser conferidas contra o run corrente:
 * waves carimbadas com o run ANTERIOR sao degradadas para STALE e o gate de
 * cobertura pode reprovar. Sem preflight, isso so apareceria DEPOIS de ~35 min
 * de QA Mesh + converge — desperdicio exatamente do tipo que ja custou um ciclo
 * inteiro no caso do Ask-AI TTL (H17-PREFLIGHT-ASK-AI-TTL).
 *
 * Regra:
 *   - wave com runId IGUAL ao run corrente  -> SAME_RUN (ok);
 *   - wave com runId DIFERENTE               -> WAVE_EVIDENCE_FOREIGN_RUN;
 *   - wave SEM runId                          -> WAVE_EVIDENCE_NO_LINEAGE;
 *   - wave ausente                            -> ignorada aqui (quem trata e o
 *     coverage gate, que tem caminho proprio de fonte 'missing').
 *
 * Remedio (nao ha laco): regenerar as 3 waves DENTRO do run corrente. Os
 * produtores carimbam o run de agora e `reports/` NAO participa de
 * SOURCE_ROOTS (medido), portanto regenerar nao cria drift governado.
 *
 * Uso:
 *   node scripts/governance/check-wave-evidence-same-run.js
 *   node scripts/governance/check-wave-evidence-same-run.js --json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const WAVES = [
  { wave: 'db-integrity', rel: 'reports/db-integrity-report.json', produtor: 'npm run wave:db-integrity' },
  { wave: 'api-surface', rel: 'reports/api-surface-report.json', produtor: 'npm run wave:api-surface' },
  { wave: 'page-surface', rel: 'reports/page-surface-report.json', produtor: 'npm run wave:page-surface' },
];

const MOTIVO = {
  FOREIGN_RUN: 'WAVE_EVIDENCE_FOREIGN_RUN',
  NO_LINEAGE: 'WAVE_EVIDENCE_NO_LINEAGE',
};

function lerJson(caminho) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Decisao pura (sem I/O de rede): recebe os relatorios ja lidos.
 * @param {object} entrada
 * @param {object|null} entrada.currentRun  conteudo de governance/.current-run.json
 * @param {Array<{wave:string, rel:string, produtor:string, report:object|null}>} entrada.waves
 */
function avaliar({ currentRun = null, waves = [] } = {}) {
  const runId = (currentRun && (currentRun.runId || currentRun.id)) || null;
  const violacoes = [];
  const resultados = [];

  for (const item of waves) {
    const { wave, produtor, report } = item;

    if (!report) {
      resultados.push({ wave, status: 'AUSENTE' });
      continue;
    }

    const runDaEvidencia = report.runId || null;

    if (!runId) {
      // Sem run corrente nao ha o que comparar; nao inventamos violacao.
      resultados.push({ wave, status: 'SEM_RUN_CORRENTE', runIdEvidencia: runDaEvidencia });
      continue;
    }

    if (!runDaEvidencia) {
      violacoes.push({
        wave,
        motivo: MOTIVO.NO_LINEAGE,
        runEsperado: runId,
        remedio: produtor,
        detalhe: `${item.rel} nao declara runId (evidencia sem lineage de run)`,
      });
      continue;
    }

    if (runDaEvidencia !== runId) {
      violacoes.push({
        wave,
        motivo: MOTIVO.FOREIGN_RUN,
        runEsperado: runId,
        runEncontrado: runDaEvidencia,
        remedio: produtor,
        detalhe: `${item.rel} pertence a outro run governado`,
      });
      continue;
    }

    resultados.push({ wave, status: 'SAME_RUN', runIdEvidencia: runDaEvidencia });
  }

  return {
    runId,
    ok: violacoes.length === 0,
    violacoes,
    resultados,
    remedio: [...new Set(violacoes.map((v) => v.remedio))],
  };
}

function coletar(rootDir = ROOT) {
  const waves = WAVES.map((w) => ({
    ...w,
    report: lerJson(path.join(rootDir, w.rel)),
  }));
  const currentRun = lerJson(path.join(rootDir, 'governance', '.current-run.json'));
  return avaliar({ currentRun, waves });
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const resultado = coletar(ROOT);

  if (json) {
    console.log(JSON.stringify(resultado, null, 2));
    return resultado.ok ? 0 : 1;
  }

  if (resultado.ok) {
    const resumo = resultado.resultados.map((r) => `${r.wave}:${r.status}`).join(' ');
    console.log(`[wave-same-run] status=PASS run=${resultado.runId || 'n/d'} ${resumo}`);
    return 0;
  }

  console.log(`[wave-same-run] status=FAIL run=${resultado.runId || 'n/d'} violacoes=${resultado.violacoes.length}`);
  for (const v of resultado.violacoes) {
    console.log(`  - ${v.motivo}: ${v.detalhe} (esperado=${v.runEsperado} encontrado=${v.runEncontrado || 'nulo'})`);
  }
  console.log('[wave-same-run] remedio (regenera DENTRO do run corrente; nao cria drift):');
  for (const r of resultado.remedio) console.log(`    ${r}`);
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`[wave-same-run] erro fatal: ${err && err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { WAVES, MOTIVO, avaliar, coletar, main, ROOT };
