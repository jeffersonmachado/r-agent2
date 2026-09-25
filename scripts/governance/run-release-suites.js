'use strict';

/**
 * scripts/governance/run-release-suites.js — EXECUÇÃO CANÔNICA das suítes autoritativas.
 *
 * Substitui `jest <globs manuais>` por execução DERIVADA do manifesto canônico
 * (`config/canonical-release-suites.json`, resolvido por `lib/releaseSuiteManifest`).
 *
 * Por que existe (achado real de 2026-09-25): o comando de execução usava globs e o validador
 * anti-greenwashing usava uma LISTA À MÃO. Consequências medidas:
 *   - os dois conjuntos divergiam (o gate verificava menos do que se executava);
 *   - suítes autoritativas fora da lista pulavam infraestrutura em SILÊNCIO com `console.warn`,
 *     sem aparecer em nenhum relatório (uma delas foi encontrada assim que o manifesto passou a
 *     ser derivado);
 *   - suíte nova exigia edição manual em dois lugares, e esquecer isso produzia PASS com cobertura
 *     incompleta.
 *
 * Este runner produz `reports/release-suite-execution.json` com o estado REAL de cada suíte do
 * manifesto — incluindo NOT_EXECUTED e a contagem de testes — e falha se:
 *   - alguma suíte do manifesto não aparecer na execução (NOT_EXECUTED);
 *   - alguma suíte "passar" executando ZERO testes;
 *   - alguma suíte falhar.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, writeReport } = require('./common');
const { resolveManifest, evaluateExecution, MANIFEST_VIOLATION_CODES } = require('./lib/releaseSuiteManifest');

const JEST_JSON = path.join(ROOT, 'reports', '.release-suite-jest.json');

/** Traduz o resultado do Jest para os estados canônicos do manifesto. */
function mapSuiteResult(testResult) {
  // DEFEITO REAL medido em 2026-09-25: a primeira versão lia `numTotalTests` NO NÍVEL DA SUÍTE.
  // No relatório JSON do Jest esse campo existe apenas na RAIZ (`json.numTotalTests`); por suíte o
  // que existe é `assertionResults[]`. Resultado do erro: TODAS as 24 suítes apareciam como
  // "executou ZERO testes" — ou seja, o gate teria reprovado uma execução 100% verde (falso
  // negativo) e, com a checagem invertida, poderia ter aprovado suítes vazias (falso positivo).
  const assertionResults = Array.isArray(testResult.assertionResults) ? testResult.assertionResults : [];
  const testsExecuted = assertionResults.length || Number(testResult.numTotalTests || 0);
  const failed = assertionResults.filter((a) => a.status === 'failed').length
    + Number(testResult.numRuntimeErrorTestSuites || 0)
    + (assertionResults.length === 0 && testResult.status === 'failed' ? 1 : 0);
  // FALSO POSITIVO REAL corrigido em 2026-09-25: a detecção varria `JSON.stringify(assertionResults)`,
  // que inclui o TÍTULO de cada teste. A própria suíte que testa este mapeador tem casos com a
  // palavra "INFRA_ERROR" no título — e a suíte inteira passou a ser classificada como
  // INFRA_ERROR, reprovando uma execução verde. É a mesma classe de defeito que o
  // anti-greenwashing já resolve com `isFixtureOrStringLine`: dado não é mecanismo.
  // Correção: olhar apenas MENSAGENS DE FALHA (estrutura), nunca o texto do título.
  const failureText = [
    testResult.status === 'failed' ? (testResult.message || '') : '',
    ...assertionResults.flatMap((a) => (Array.isArray(a.failureMessages) ? a.failureMessages : [])),
  ].join('\n');
  const infraError = /INFRA_ERROR/.test(failureText);
  const skipped = assertionResults.filter((a) => a.status === 'pending' || a.status === 'todo').length;
  const onlySkipped = testsExecuted > 0 && skipped === testsExecuted;

  let state;
  let reason = null;
  if (infraError) {
    state = 'INFRA_ERROR';
    reason = 'infraestrutura obrigatória ausente (RELEASE_AUTHORITATIVE exige falha explícita)';
  } else if (failed > 0 || testResult.status === 'failed') {
    state = 'FAIL';
    reason = `${failed} teste(s) falharam`;
  } else if (testsExecuted === 0) {
    state = 'FAIL';
    reason = 'suíte executou ZERO testes';
  } else if (onlySkipped) {
    state = 'NOT_EXECUTED';
    reason = `todos os ${testsExecuted} teste(s) foram pulados — não conta como cobertura`;
  } else {
    state = 'PASS';
  }

  return { state, testsExecuted, failed, skipped, reason };
}

/**
 * Executa o manifesto em LOTES.
 *
 * DEFEITO REAL medido em 2026-09-25: a primeira versão rodava TODAS as suítes numa única invocação
 * do Jest e caía em `EXECUTION_REPORT_MISSING` — o Jest saía com código 1 sem NUNCA escrever o
 * relatório JSON, e o erro real ficava invisível (o runner não preservava o stderr). Uma suíte capaz
 * de derrubar o processo (e o manifesto inclui suítes de crash real com SIGKILL) apaga a coleta
 * inteira.
 *
 * Em lotes: o que já foi coletado SOBREVIVE, o lote que falhou é identificado com a saída real do
 * Jest, e nenhuma suíte ausente é contada como PASS (vira NOT_EXECUTED explícito).
 */
function runJestBatch(suites, batchIndex) {
  const outputFile = path.join(ROOT, 'reports', `.release-suite-jest-${batchIndex}.json`);
  if (fs.existsSync(outputFile)) fs.rmSync(outputFile, { force: true });
  // Execução serial: as suítes autoritativas compartilham banco real e já se mostraram sensíveis a
  // contenção de recursos quando executadas em paralelo.
  const args = ['jest', ...suites, '--runInBand', '--no-coverage', '--json', `--outputFile=${outputFile}`];
  const result = spawnSync('npx', args, {
    cwd: ROOT,
    env: { ...process.env, RELEASE_AUTHORITATIVE: process.env.RELEASE_AUTHORITATIVE || '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  let json = null;
  let parseError = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch (err) {
      parseError = err.message;
    }
  }
  return {
    suites,
    exitCode: result.status,
    signal: result.signal || null,
    spawnError: result.error ? result.error.message : null,
    json,
    parseError,
    stderrTail: (result.stderr || '').split('\n').slice(-40).join('\n'),
  };
}

function batchPaths(suites) {
  const batchSize = Math.max(1, Number(process.env.RELEASE_SUITE_BATCH_SIZE || 6));
  const batches = [];
  for (let i = 0; i < suites.length; i += batchSize) {
    batches.push({ index: batches.length, suites: suites.slice(i, i + batchSize) });
  }
  return batches;
}

/**
 * RETOMADA DECLARADA: com RELEASE_SUITES_REUSE_BATCHES=1 e os relatórios de lote já presentes, a
 * execução é REUSADA em vez de repetida. Existe porque uma execução real do manifesto leva ~25
 * minutos (suítes de crash/resume reais) e uma falha na MONTAGEM do relatório não pode obrigar a
 * reexecutar tudo. O relatório final registra `reusedBatches: true` — nunca é apresentado como
 * execução nova.
 */
function runJest(suites) {
  const batches = batchPaths(suites);
  const reuse = ['1', 'true'].includes(String(process.env.RELEASE_SUITES_REUSE_BATCHES || ''));
  return batches.map(({ index, suites: batch }) => {
    const outputFile = path.join(ROOT, 'reports', `.release-suite-jest-${index}.json`);
    if (reuse && fs.existsSync(outputFile)) {
      try {
        return {
          suites: batch,
          exitCode: 0,
          signal: null,
          spawnError: null,
          json: JSON.parse(fs.readFileSync(outputFile, 'utf8')),
          parseError: null,
          stderrTail: '',
          reused: true,
        };
      } catch (_) { /* relatório de lote ilegível ⇒ executa de novo */ }
    }
    return { ...runJestBatch(batch, index), reused: false };
  });
}

function collectBatchResults(batchRuns) {
  const suites = {};
  const batchFailures = [];
  for (const [index, run] of batchRuns.entries()) {
    if (!run.json) {
      // Lote sem relatório: TODAS as suas suítes são NOT_EXECUTED (o loop seguinte marca cada uma)
      // e a causa real fica registrada — nunca um vazio mudo.
      batchFailures.push({
        batchIndex: index,
        suites: run.suites,
        exitCode: run.exitCode,
        signal: run.signal,
        spawnError: run.spawnError,
        parseError: run.parseError,
        stderrTail: run.stderrTail,
      });
      continue;
    }
    for (const testResult of run.json.testResults || []) {
      const relative = path.relative(ROOT, testResult.name).split(path.sep).join('/');
      suites[relative] = mapSuiteResult(testResult);
    }
  }
  return { suites, batchFailures };
}

function main() {
  const manifest = resolveManifest();
  const report = {
    artifactType: 'release-suite-execution-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    manifestVersion: manifest.manifestVersion,
    manifestConfig: 'config/canonical-release-suites.json',
    authoritativeMode: process.env.RELEASE_AUTHORITATIVE === '1' || process.env.RELEASE_AUTHORITATIVE === 'true',
    status: 'FAIL',
    manifestViolations: manifest.violations,
    manifestViolationCount: manifest.violations.length,
    discovered: manifest.discovered.length,
    excluded: manifest.excluded.map((e) => ({ path: e.path, glob: e.glob, reason: e.reason })),
    suites: {},
    results: [],
    violations: [],
    violationCount: 0,
  };

  if (!manifest.ok) {
    // Manifesto inconsistente = nada a executar com confiança. Fail-closed.
    report.violations = manifest.violations.map((v) => ({ code: v.code, suite: v.suite || null, detail: v.detail }));
    report.violationCount = report.violations.length;
    writeReport('release-suite-execution.json', report);
    console.error(`[release-suites] MANIFESTO INCONSISTENTE — ${report.violationCount} violação(ões)`);
    for (const v of report.violations) console.error(`  - ${v.code} :: ${v.suite || '(global)'} — ${v.detail}`);
    process.exit(1);
  }

  const batchRuns = runJest(manifest.authoritative);
  const collected = collectBatchResults(batchRuns);
  report.suites = collected.suites;
  report.batchFailures = collected.batchFailures;
  report.batches = batchRuns.map((b) => ({ suites: b.suites.length, exitCode: b.exitCode, producedReport: Boolean(b.json), reused: Boolean(b.reused) }));
  report.reusedBatches = batchRuns.some((b) => b.reused);

  for (const failure of collected.batchFailures) {
    report.violations.push({
      code: 'BATCH_REPORT_MISSING',
      batchIndex: failure.batchIndex,
      suites: failure.suites,
      detail: `lote não produziu relatório do Jest (exit=${failure.exitCode}, signal=${failure.signal || 'null'}${failure.spawnError ? `, spawn=${failure.spawnError}` : ''}${failure.parseError ? `, parse=${failure.parseError}` : ''}) — suítes marcadas NOT_EXECUTED`,
    });
  }

  const evaluation = evaluateExecution(manifest, { suites: report.suites });
  report.results = evaluation.results;
  report.coverage = { covered: evaluation.covered, total: evaluation.total, ratio: evaluation.coverageRatio };
  report.states = evaluation.states;
  report.totals = {
    testsExecuted: Object.values(report.suites).reduce((acc, s) => acc + s.testsExecuted, 0),
    failedSuites: Object.values(report.suites).filter((s) => s.state === 'FAIL').length,
  };
  report.violations = [...report.violations, ...evaluation.violations];
  report.violationCount = report.violations.length;
  report.batchExitCodes = batchRuns.map((b) => b.exitCode);
  report.status = report.violationCount === 0 ? 'PASS' : 'FAIL';

  writeReport('release-suite-execution.json', report);

  console.log(`[release-suites] status=${report.status} suites=${evaluation.covered}/${evaluation.total} testes=${report.totals.testsExecuted}`);
  if (report.status !== 'PASS') {
    for (const v of report.violations.slice(0, 25)) console.error(`  - ${v.code} :: ${v.suite || '(global)'}${v.detail ? ` — ${v.detail}` : ''}`);
    if (report.violations.some((v) => v.code === MANIFEST_VIOLATION_CODES.SUITE_NOT_IN_MANIFEST)) {
      console.error('  verifique config/canonical-release-suites.json (descoberta × manifesto)');
    }
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { mapSuiteResult };
