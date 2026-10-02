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
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, writeReport } = require('./common');
const { resolveManifest, evaluateExecution, MANIFEST_VIOLATION_CODES } = require('./lib/releaseSuiteManifest');
// Fonte única da carga do `.env` (mesmo módulo usado por
// `collect-engineering-router-runtime-evidence.js`, que tinha o MESMO defeito: o veredito
// dependia de quem invocava o coletor).
const { loadEnvFile: loadEnvFileFromLib } = require('./lib/loadEnvFile');

/**
 * Carrega o `.env` do repositório (se existir) SEM sobrescrever o que já veio do ambiente.
 *
 * DEFEITO REAL medido em 2026-09-29: o regime autoritativo não era determinístico. O
 * `seal-release.sh` exporta o `.env` no shell antes de chamar o runner; um
 * `node scripts/governance/run-release-suites.js` manual, não. Como o spawn do Jest herda
 * `process.env`, o RESULTADO das suítes dependia de quem invocava o runner — e nada registrava
 * qual dos dois regimes rodou. O caso concreto: o probe live do Qwen resolvia credencial pelo
 * ambiente (ou não) conforme a invocação, e a classificação do requisito acabava sendo um texto
 * declarado em vez de medição.
 *
 * Os scripts de governança do projeto usam `--env-file-if-exists=.env` pelo mesmo motivo. Aqui a
 * leitura é explícita para que o runner seja o mesmo objeto independentemente da invocação.
 */
function loadEnvFile() {
  return loadEnvFileFromLib(ROOT);
}

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
/**
 * DIRETÓRIO DO RELATÓRIO POR LOTE — artefato de TRANSPORTE, fora de `reports/`.
 *
 * DEFEITO REAL medido em 2026-10-02 (duas execuções seguidas): o JSON do lote era gravado em
 * `reports/` e CHEGAVA AUSENTE na leitura do runner (lote 2: `exit=1`, `json=NULL`), embora o
 * mesmo comando, rodado à mão com o mesmo `--outputFile`, escrevesse o arquivo normalmente. A
 * consequência era pior que a falha: o runner degradava as SEIS suítes do lote para
 * `MANIFEST_SUITE_NOT_EXECUTED` e o erro real — `RUNTIME-EVIDENCE_UNAVAILABLE`, que nomeia o
 * requisito e o remédio — desaparecia do relatório agregado. Uma falha real disfarçada de "não
 * executada" esconde causa e resultado ao mesmo tempo.
 *
 * `reports/` é diretório GOVERNADO: outros componentes (higiene de release, runtime:clean)
 * podam estado transitório ali, e este transporte não pode competir com quem limpa. Em
 * `os.tmpdir()` ele é o que sempre foi — canal entre dois processos.
 *
 * `RELEASE_SUITE_BATCH_DIR` permite apontar para diretório persistente quando se quer a retomada
 * por `RELEASE_SUITES_REUSE_BATCHES=1` entre invocações distintas.
 */
function batchReportDir() {
  const override = String(process.env.RELEASE_SUITE_BATCH_DIR || '').trim();
  return override || path.join(os.tmpdir(), 'r-agent2-release-suites');
}

function batchReportPath(batchIndex) {
  return path.join(batchReportDir(), `batch-${batchIndex}.json`);
}

function runJestBatch(suites, batchIndex) {
  const outputFile = batchReportPath(batchIndex);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
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
    reportPath: outputFile,
    reportPresent: raw !== null,
    reportBytes: raw === null ? 0 : Buffer.byteLength(raw, 'utf8'),
    // O stdout do Jest carrega o resumo (`Test Suites:`/`Tests:`) mesmo quando o JSON não chega;
    // preservá-lo é o que permite distinguir "falhou" de "não rodou" sem adivinhação.
    stdoutTail: (result.stdout || '').split('\n').slice(-40).join('\n'),
    stderrTail: (result.stderr || '').split('\n').slice(-40).join('\n'),
  };
}

/**
 * AGRUPAMENTO EM LOTES COM EXCLUSIVIDADE DECLARADA.
 *
 * DEFEITO REAL medido em 2026-10-02: `tests/helpers/purgeTestFindings.js` fundamenta sua segurança
 * numa premissa escrita em comentário — "as suítes do laço NÃO podem rodar em paralelo entre si" —
 * mas o agrupamento por tamanho fixo colocava TRÊS suítes de bug loop no MESMO lote. Como
 * `runBugLoopSweep` é GLOBAL e a posse por finding é um LEASE, um sweep vizinho reivindica o finding
 * e, ao terminar, deixa o lease preso até o TTL; o worker da suíte que ESPERA (a que prova autonomia)
 * só pula (`leaseSkipped`). Medido: `cycles: 115` sem retomada em 187 s, e depois 900 s sem fechar —
 * com a mesma suíte passando em 35-68 s isolada.
 *
 * A exclusividade passa a ser DECLARADA no manifesto (`execution.exclusiveGroups`), não presumida por
 * um comentário. O agrupamento continua sendo o mais cheio possível (não serializa tudo), mas nunca
 * coloca duas suítes do mesmo grupo no mesmo lote. Uma suíte pode pertencer a mais de um grupo.
 */
function buildExclusiveIndex(exclusiveGroups = []) {
  const groupsOf = new Map(); // suite -> Set(groupId)
  const groups = [];
  for (const group of Array.isArray(exclusiveGroups) ? exclusiveGroups : []) {
    const id = String((group && group.id) || '').trim();
    const suites = Array.isArray(group && group.suites) ? group.suites.filter(Boolean) : [];
    if (id === '' || suites.length < 2) continue; // um grupo de 1 não restringe nada
    const reason = String((group && group.reason) || '').trim();
    if (reason.length < 20) {
      throw new Error(`exclusiveGroups: o grupo "${id}" precisa de motivo com pelo menos 20 caracteres — restrição de concorrência sem justificativa é decisão invisível`);
    }
    groups.push({ id, suites, reason });
    for (const suite of suites) {
      if (!groupsOf.has(suite)) groupsOf.set(suite, new Set());
      groupsOf.get(suite).add(id);
    }
  }
  return { groups, groupsOf };
}

function batchPaths(suites, { exclusiveGroups = [] } = {}) {
  const batchSize = Math.max(1, Number(process.env.RELEASE_SUITE_BATCH_SIZE || 6));
  const { groups, groupsOf } = buildExclusiveIndex(exclusiveGroups);
  const batches = [];

  const groupsInBatch = (batch) => {
    const set = new Set();
    for (const suite of batch.suites) {
      for (const g of groupsOf.get(suite) || []) set.add(g);
    }
    return set;
  };

  for (const suite of suites) {
    const mine = groupsOf.get(suite) || new Set();
    // Primeiro lote com vaga e SEM conflito de grupo; senão, um lote novo.
    let target = null;
    for (const batch of batches) {
      if (batch.suites.length >= batchSize) continue;
      const taken = groupsInBatch(batch);
      let conflict = false;
      for (const g of mine) { if (taken.has(g)) { conflict = true; break; } }
      if (!conflict) { target = batch; break; }
    }
    if (!target) {
      target = { index: batches.length, suites: [] };
      batches.push(target);
    }
    target.suites.push(suite);
  }
  return { batches, groups };
}

/**
 * RETOMADA DECLARADA: com RELEASE_SUITES_REUSE_BATCHES=1 e os relatórios de lote já presentes, a
 * execução é REUSADA em vez de repetida. Existe porque uma execução real do manifesto leva ~25
 * minutos (suítes de crash/resume reais) e uma falha na MONTAGEM do relatório não pode obrigar a
 * reexecutar tudo. O relatório final registra `reusedBatches: true` — nunca é apresentado como
 * execução nova.
 */
function runJest(suites, { exclusiveGroups = [] } = {}) {
  const { batches, groups } = batchPaths(suites, { exclusiveGroups });
  const reuse = ['1', 'true'].includes(String(process.env.RELEASE_SUITES_REUSE_BATCHES || ''));
  return batches.map(({ index, suites: batch }) => {
    const outputFile = batchReportPath(index);
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
        reportPath: run.reportPath || null,
        reportPresent: run.reportPresent === true,
        reportBytes: run.reportBytes || 0,
        stdoutTail: run.stdoutTail || '',
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
  // Determinismo do ambiente: o `.env` é carregado ANTES de qualquer suíte (ver `loadEnvFile`).
  const envFile = loadEnvFile();
  // LINEAGE NA ORIGEM: a execução autoritativa é a prova de RUNTIME que os demais gates consomem.
  // Sem runId/sourceFingerprint gravados AQUI, um relatório de outro run (ou de outro código) era
  // aceito como prova deste — gap medido em 2026-09-30 pelo binding do ciclo de bug
  // (EVIDENCE_LINEAGE_MISSING em reports/release-suite-execution.json).
  const { applyOriginLineage, resolveRunLineage } = require('./lib/resolve-run-lineage');
  const lineage = resolveRunLineage({ rootDir: ROOT });
  const report = applyOriginLineage({
    artifactType: 'release-suite-execution-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    manifestVersion: manifest.manifestVersion,
    manifestConfig: 'config/canonical-release-suites.json',
    authoritativeMode: process.env.RELEASE_AUTHORITATIVE === '1' || process.env.RELEASE_AUTHORITATIVE === 'true',
    environment: { envFileLoaded: envFile.loaded, envFileKeys: envFile.keys, envFileNote: envFile.reason },
    status: 'FAIL',
    manifestViolations: manifest.violations,
    manifestViolationCount: manifest.violations.length,
    discovered: manifest.discovered.length,
    excluded: manifest.excluded.map((e) => ({ path: e.path, glob: e.glob, reason: e.reason })),
    suites: {},
    results: [],
    violations: [],
    violationCount: 0,
  }, lineage);

  if (!manifest.ok) {
    // Manifesto inconsistente = nada a executar com confiança. Fail-closed.
    report.violations = manifest.violations.map((v) => ({ code: v.code, suite: v.suite || null, detail: v.detail }));
    report.violationCount = report.violations.length;
    writeReport('release-suite-execution.json', report);
    console.error(`[release-suites] MANIFESTO INCONSISTENTE — ${report.violationCount} violação(ões)`);
    for (const v of report.violations) console.error(`  - ${v.code} :: ${v.suite || '(global)'} — ${v.detail}`);
    process.exit(1);
  }

  const batchRuns = runJest(manifest.authoritative, {
    // EXCLUSIVIDADE DECLARADA: suítes que compartilham runner/lease global (o laço de bugs) nunca
    // caem no mesmo lote. A restrição vem do MANIFESTO, com motivo — não de uma frase de comentário
    // num helper, que foi exatamente como o defeito passou despercebido.
    exclusiveGroups: (manifest.execution && manifest.execution.exclusiveGroups) || [],
  });
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
      detail: `lote não produziu relatório do Jest (exit=${failure.exitCode}, signal=${failure.signal || 'null'}${failure.spawnError ? `, spawn=${failure.spawnError}` : ''}${failure.parseError ? `, parse=${failure.parseError}` : ''}; transporte=${failure.reportPath || 'desconhecido'}, presente=${failure.reportPresent === true}, bytes=${failure.reportBytes || 0}) — suítes marcadas NOT_EXECUTED; o stdout do Jest abaixo diz se o lote ROU ou se falhou: ${(failure.stdoutTail || '').trim().split('\n').slice(-3).join(' | ') || '(vazio)'}`,
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

module.exports = { mapSuiteResult, batchPaths, buildExclusiveIndex };
