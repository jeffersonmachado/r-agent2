'use strict';

/**
 * Runner de validação L1 por impacto — MISSÃO A.
 *
 * Encadeia o que o RAP já tinha, sem criar infraestrutura paralela:
 *   git diff → grafo de impacto (artefato) → seleção (qa/coverage/impactSelection)
 *   → execução Jest no MESMO padrão do `run-release-suites.js`
 *     (`--runInBand --no-coverage --bail=0 --json`).
 *
 * Regra de ouro: fail-closed. Se a seleção não cobrir todos os arquivos de
 * produção alterados, o runner NÃO inventa uma suíte: devolve ESCALATE e o
 * orquestrador sobe para o nível seguinte.
 *
 * Exit codes:
 *   0 = L1 executado e verde
 *   1 = L1 executado e VERMELHO (teste falhou de verdade)
 *   2 = ESCALATE (não é falha: é insuficiência de evidência para decidir)
 *   3 = erro de infraestrutura (artefato ausente, git indisponível)
 *   4 = NOT_EXECUTED (dry-run: simulou a seleção e NÃO executou nada — nunca
 *       reportar isto como verde; P0-5, medido 2026-10-16)
 *
 * Uso:
 *   node scripts/governance/run-impact-validation.js [--base <ref>] [--files a,b]
 *        [--dry-run] [--out <caminho>]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const { collectDependents, normalizar } = require('../../qa/coverage/impactGraph');
const { selectValidation, NIVEIS } = require('../../qa/coverage/impactSelection');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

const RAIZ = path.resolve(__dirname, '..', '..');
const GRAFO = path.join(RAIZ, 'reports', 'impact-graph.json');
const MESH = path.join(RAIZ, 'qa-mesh', 'meshRegistry.json');
const VIZINHANCA = path.join(RAIZ, 'config', 'impact-neighborhood.json');
const SAIDA = path.join(RAIZ, 'reports', 'impact-validation-report.json');

const EXIT = Object.freeze({ GREEN: 0, RED: 1, ESCALATE: 2, INFRA: 3, NOT_EXECUTED: 4 });

/**
 * Lê um JSON com falha explícita (nunca silenciosa).
 * @param {string} caminho
 * @param {string} rotulo
 * @returns {object}
 */
function lerJsonObrigatorio(caminho, rotulo) {
  if (!fs.existsSync(caminho)) {
    throw new Error(`${rotulo} ausente em ${path.relative(RAIZ, caminho)}`);
  }
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

/**
 * Extrai o ÚLTIMO objeto JSON impresso por um subprocesso.
 *
 * O CLI do mesh (`qa-mesh/meshRunner.js`) imprime logs e, no fim, o resumo em JSON
 * indentado. Ler o arquivo de saída não serve: execução por `scenarioIds` é
 * NÃO-canônica de propósito (`isCanonicalRegistryExecution` exige o registry
 * completo), logo o runner não grava `go-no-go-report.json` — e não gravar é
 * exatamente o que impede esta execução de contaminar a evidência governada.
 *
 * @param {string} saida
 * @returns {object|null}
 */
function extrairUltimoJson(saida) {
  const texto = String(saida || '');
  const inicio = texto.lastIndexOf('\n{');
  const candidato = inicio >= 0 ? texto.slice(inicio + 1) : (texto.trim().startsWith('{') ? texto.trim() : null);
  if (!candidato) return null;
  try {
    return JSON.parse(candidato);
  } catch (_) {
    return null;
  }
}

/**
 * Arquivos alterados segundo o git.
 * @param {string} base
 * @returns {{files: string[], base: string, degraded: boolean, reason?: string}}
 */
function arquivosAlterados(base) {
  // Nunca degradar em silêncio: se o git falhar, o chamador ESCALA.
  try {
    const saida = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd: RAIZ,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const arquivos = saida.trim().split('\n').filter(Boolean).map(normalizar);
    if (arquivos.length === 0 && base === 'HEAD') {
      // sem alterações commitadas: considera o working tree
      const wt = execFileSync('git', ['status', '--porcelain'], { cwd: RAIZ, encoding: 'utf8' });
      const sujos = wt
        .split('\n')
        .filter(Boolean)
        .map((l) => normalizar(l.slice(3).trim().split(' -> ').pop()));
      return { files: sujos, base: 'WORKTREE', degraded: false };
    }
    return { files: arquivos, base, degraded: false };
  } catch (erro) {
    return { files: [], base, degraded: true, reason: `git diff falhou: ${erro.message.slice(0, 120)}` };
  }
}

/**
 * jornadas por arquivo, vindas do ARTEFATO do grafo.
 *
 * O runner NÃO lê `config/system-inventory.json`: o `build-impact-graph` é o
 * único ponto que toca o inventário e publica `journeysByFile` no artefato.
 * Fazer o runner ler o inventário criava um par (writeFileSync +
 * system-inventory.json) no mesmo arquivo, que o auditor de persistência
 * classifica como UNKNOWN_JSON_WRITE_TARGET — falso positivo que derrubou
 * `verify:no-mutable-json-state`, `audit:json-persistence` e, em cascata,
 * `validate:required-tests` (TEMPORAL-06).
 *
 * @param {object} grafo
 * @returns {Object<string, string[]>}
 */
function jornadasPorArquivo(grafo) {
  const doArtefato = grafo && grafo.journeysByFile;
  return doArtefato && typeof doArtefato === 'object' ? doArtefato : {};
}

/**
 * cenários do mesh por jornada.
 * @returns {Object<string, string[]>}
 */
function cenariosPorJornada() {
  const mapa = {};
  try {
    const reg = lerJsonObrigatorio(MESH, 'registry do mesh');
    for (const c of reg.scenarios || reg) {
      if (c.journeyId) (mapa[c.journeyId] = mapa[c.journeyId] || []).push(c.id);
    }
  } catch {
    /* idem */
  }
  return mapa;
}

/**
 * Regras de vizinhança declaradas (podem não existir: lista vazia é válida).
 * @returns {Array<object>}
 */
function regrasVizinhanca() {
  try {
    if (!fs.existsSync(VIZINHANCA)) return [];
    const j = JSON.parse(fs.readFileSync(VIZINHANCA, 'utf8'));
    return Array.isArray(j.rules) ? j.rules : [];
  } catch {
    return [];
  }
}

/**
 * Executa as suítes selecionadas no padrão canônico do runner de release.
 * @param {string[]} suites
 * @param {string} outJson
 * @returns {{exitCode: number|null, signal: string|null, spawnError: string|null}}
 */
function executarJest(suites, outJson) {
  const args = [
    'jest',
    ...suites,
    '--runInBand',
    '--no-coverage',
    '--bail=0',
    '--json',
    `--outputFile=${outJson}`,
    '--silent',
  ];
  const r = spawnSync('npx', args, { cwd: RAIZ, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  return {
    exitCode: r.status,
    signal: r.signal,
    spawnError: r.error ? r.error.message : null,
  };
}

/**
 * Separa a seleção pelo runner competente.
 *
 * DEFEITO REAL medido em 2026-10-14: `jest.config.cjs` tem
 * `roots = [engine, api, tests, qa, qa-mesh, lib]` — `frontend/` NÃO está lá.
 * Passar um teste de frontend ao Jest faz o L1 reportar "VERMELHO: 1 teste(s)
 * falharam" para um teste que passa (falso vermelho), porque o Jest simplesmente
 * não encontra o arquivo. O frontend roda em Vitest (`frontend/vitest.config.mjs`).
 *
 * @param {string[]} testes
 * @returns {{jest: string[], vitest: string[]}}
 */
function separarPorRunner(testes = []) {
  const jest = [];
  const vitest = [];
  for (const t of testes) {
    const n = normalizar(t);
    if (n.startsWith('frontend/') && !n.startsWith('frontend-e2e/')) vitest.push(n);
    else jest.push(n);
  }
  return { jest: jest.sort(), vitest: vitest.sort() };
}

/**
 * Executa os testes de frontend no Vitest (cwd em `frontend/`, paths relativos).
 * @param {string[]} suites caminhos a partir da raiz do repositório
 * @returns {{exitCode: number|null, signal: string|null, spawnError: string|null, totalTests: number|null, failedTests: number|null}}
 */
function executarVitest(suites) {
  const relativos = suites.map((s) => s.replace(/^frontend\//, ''));
  const args = ['vitest', 'run', '--config', 'vitest.config.mjs', ...relativos];
  const r = spawnSync('npx', args, {
    cwd: path.join(RAIZ, 'frontend'),
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, VITE_CACHE_DIR: process.env.VITE_CACHE_DIR || '/tmp/r-agent2-vite' },
  });
  const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
  const passa = saida.match(/Tests\s+(\d+)\s+passed/);
  const falha = saida.match(/Tests\s+(\d+)\s+failed/);
  const total = passa ? Number(passa[1]) : null;
  return {
    exitCode: r.status,
    signal: r.signal,
    spawnError: r.error ? r.error.message : null,
    totalTests: total === null ? null : total + (falha ? Number(falha[1]) : 0),
    failedTests: falha ? Number(falha[1]) : 0,
  };
}

/**
 * Executa o L1.
 * @param {string[]} argv
 * @returns {number} exit code
 */
function main(argv = process.argv.slice(2)) {
  // Aceita `--nome=valor` E `--nome valor`: o orquestrador e os demais gates do
  // RAP usam a forma com `=` (ex.: run-all-validators.js `--only=a,b`). Aceitar
  // só a forma separada fazia `--files=x` ser ignorado EM SILÊNCIO e o runner
  // cair no `git diff` do working tree — medido em 2026-10-14, produzia
  // escalação espúria com arquivos que o operador não pediu.
  const arg = (nome, padrao = null) => {
    // `nome` inclui os `--`. A chave é `nome.length + 1` (só o `=`); usar +3
    // cortava também os 2 primeiros caracteres do valor ("engine/utils.js" virava
    // "ine/utils.js"), o caminho não batia com nada e o `--files` era ignorado em
    // silêncio. Medido em 2026-10-14.
    const comIgual = argv.find((a) => a.startsWith(`${nome}=`));
    if (comIgual !== undefined) return comIgual.slice(nome.length + 1);
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : padrao;
  };
  const dryRun = argv.includes('--dry-run');
  const base = arg('--base', 'HEAD');
  const out = arg('--out', SAIDA);
  // Caminho do grafo injetável: permite exercitar o vínculo de identidade (P0-5) em
  // teste SEM tocar o artefato real de `reports/`.
  const grafoPath = arg('--graph', GRAFO);

  /**
   * REGISTRA A RECUSA NO PRÓPRIO ARTEFATO (medido 2026-10-21, checkout limpo).
   *
   * Todos os caminhos de escalação anteriores saíam SEM escrever `reports/impact-validation-report.json`.
   * Consequência real: o arquivo de uma execução ANTERIOR permanecia no disco e consumidores
   * (testes unitários e gates que leem o relatório) liam um resultado que não era desta execução —
   * evidência de outro momento apresentada como atual. Recusa também é resultado: sobrescreve.
   */
  const registrarRecusa = ({ base, changedFiles = [], motivo }) => {
    const relatorio = {
      schemaVersion: 1,
      kind: 'impact-validation',
      level: 'L1',
      base,
      changedFiles,
      decision: { escalate: true, escalateReason: motivo, unclassified: changedFiles },
      selection: {
        totalTests: 0,
        tests: [],
        journeys: [],
        meshScenarios: [],
        byLayer: { transitive: 0, journey: 0, neighborhood: 0 },
      },
      execution: null,
      refused: { reason: motivo, at: new Date().toISOString() },
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(relatorio, null, 1), 'utf8');
    process.stdout.write(`[L1] relatório em ${path.relative(RAIZ, out)} (recusa registrada)\n`);
  };

  // 1. grafo — existência, INTEGRIDADE e VÍNCULO com o source analisado (P0-5).
  if (!fs.existsSync(grafoPath)) {
    const motivo = 'artefato do grafo ausente (rode: node scripts/governance/build-impact-graph.js)';
    process.stderr.write(`[L1] ERRO: ${motivo}\n`);
    registrarRecusa({ base: 'GRAPH_ABSENT', motivo });
    return EXIT.INFRA;
  }
  let grafo;
  try {
    grafo = JSON.parse(fs.readFileSync(grafoPath, 'utf8'));
  } catch (err) {
    const motivo = `artefato do grafo ilegível (${err.message}) — rode: npm run impact:build`;
    process.stderr.write(`[L1] ESCALATE: ${motivo}\n`);
    registrarRecusa({ base: 'GRAPH_UNREADABLE', motivo });
    return EXIT.ESCALATE;
  }
  // DEFEITO CORRIGIDO (P0-5, medido 2026-10-16): o artefato era lido e usado sem
  // conferir se descrevia o source ATUAL. Um grafo de outro commit levava a seleção a
  // decidir sobre uma árvore que não é a analisada, em silêncio. Ausência de
  // vínculo, vínculo divergente ou artefato estruturalmente inútil ⇒ ESCALATE
  // (nunca "seleção vazia ⇒ verde").
  const problemasGrafo = [];
  if (!grafo || typeof grafo !== 'object') problemasGrafo.push('artefato não é objeto');
  if (grafo && (!grafo.reverse || typeof grafo.reverse !== 'object')) {
    problemasGrafo.push('artefato sem `reverse` (grafo inutilizável)');
  }
  if (grafo && grafo.kind !== 'impact-graph') problemasGrafo.push(`kind inesperado: ${String(grafo.kind)}`);
  let fingerprintAtual = null;
  try {
    fingerprintAtual = String(computeSourceFingerprint(RAIZ));
  } catch (err) {
    problemasGrafo.push(`não foi possível calcular o fingerprint do source: ${err.message}`);
  }
  if (grafo && !grafo.sourceFingerprint) {
    problemasGrafo.push('artefato sem `sourceFingerprint` (não declara de qual source foi construído)');
  } else if (grafo && fingerprintAtual && grafo.sourceFingerprint !== fingerprintAtual) {
    problemasGrafo.push(
      `grafo de OUTRO source (artefato=${String(grafo.sourceFingerprint).slice(0, 16)}… atual=${fingerprintAtual.slice(0, 16)}…)`,
    );
  }
  if (problemasGrafo.length > 0) {
    for (const p of problemasGrafo) process.stderr.write(`[L1] ESCALATE: ${p}\n`);
    process.stderr.write('[L1] o grafo precisa descrever o source ATUAL — rode: npm run impact:build\n');
    registrarRecusa({ base: 'GRAPH_STALE', motivo: problemasGrafo.join('; ') });
    return EXIT.ESCALATE;
  }

  // 2. arquivos alterados
  const explicitos = arg('--files');
  const deteccao = explicitos
    ? { files: explicitos.split(',').map(normalizar).filter(Boolean), base: 'EXPLICIT', degraded: false }
    : arquivosAlterados(base);

  if (deteccao.degraded) {
    process.stderr.write(`[L1] ESCALATE: ${deteccao.reason}\n`);
    return EXIT.ESCALATE;
  }

  // 3. seleção
  const selecao = selectValidation({
    changedFiles: deteccao.files,
    reverse: grafo.reverse || {},
    journeysByFile: jornadasPorArquivo(grafo),
    scenariosByJourney: cenariosPorJornada(),
    neighborhoodRules: regrasVizinhanca(),
    collectDependents,
  });

  const relatorio = {
    schemaVersion: 1,
    kind: 'impact-validation',
    level: selecao.level,
    base: deteccao.base,
    changedFiles: selecao.changedFiles,
    decision: {
      escalate: selecao.escalate,
      escalateReason: selecao.escalateReason || null,
      unclassified: selecao.unclassified,
    },
    selection: {
      totalTests: selecao.totalTests,
      tests: selecao.tests,
      journeys: selecao.journeys,
      meshScenarios: selecao.meshScenarios,
      byLayer: {
        transitive: selecao.layers.transitiva.length,
        journey: selecao.layers.jornada.length,
        neighborhood: selecao.layers.vizinhanca.length,
      },
    },
    execution: null,
  };

  process.stdout.write(
    `[L1] alterados=${selecao.changedFiles.length} testes=${selecao.totalTests} ` +
      `camadas(t/j/v)=${selecao.layers.transitiva.length}/${selecao.layers.jornada.length}/${selecao.layers.vizinhanca.length}`
  );
  if (selecao.escalate) process.stdout.write(` → ESCALATE (${selecao.escalateReason})`);
  process.stdout.write('\n');

  if (selecao.escalate) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(relatorio, null, 1), 'utf8');
    process.stdout.write(`[L1] relatório em ${path.relative(RAIZ, out)} — nível seguinte (L2) deve cobrir\n`);
    return EXIT.ESCALATE;
  }

  if (dryRun) {
    // DEFEITO CORRIGIDO (P0-5, medido 2026-10-16): a simulação devolvia `GREEN` (0).
    // Um chamador que olhasse só o exit code concluía "L1 validado" sem UMA suíte
    // executada — simulação representada como validação aprovada. Agora o estado é
    // explícito no relatório E o código de saída é próprio (4 = NOT_EXECUTED), que
    // nenhum consumidor pode confundir com verde.
    relatorio.execution = { dryRun: true, state: 'NOT_EXECUTED', testsExecuted: 0 };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(relatorio, null, 1), 'utf8');
    process.stdout.write('[L1] dry-run: NENHUMA suíte executada — estado NOT_EXECUTED (não é validação)\n');
    return EXIT.NOT_EXECUTED;
  }

  // 4. execução — cada grupo no runner competente
  const grupos = separarPorRunner(selecao.tests);
  relatorio.selection.byRunner = { jest: grupos.jest.length, vitest: grupos.vitest.length };

  let falhas = 0;
  let totalExecutado = 0;
  let erroExecucao = null;
  const execucoes = [];

  if (grupos.jest.length > 0) {
    const outJson = path.join(path.dirname(out), 'impact-jest.json');
    const run = executarJest(grupos.jest, outJson);
    let numTotal = 0;
    let numFalhas = 0;
    let numSuitesFalhas = 0;
    let temRelatorio = false;
    if (fs.existsSync(outJson)) {
      try {
        const j = JSON.parse(fs.readFileSync(outJson, 'utf8'));
        numTotal = j.numTotalTests || 0;
        numFalhas = j.numFailedTests || 0;
        numSuitesFalhas = j.numFailedTestSuites || 0;
        temRelatorio = true;
      } catch {
        /* relatório ilegível -> infra abaixo */
      }
    }
    execucoes.push({
      runner: 'jest',
      suites: grupos.jest.length,
      exitCode: run.exitCode,
      signal: run.signal,
      spawnError: run.spawnError,
      numTotalTests: numTotal,
      numFailedTests: numFalhas,
      numFailedTestSuites: numSuitesFalhas,
      report: temRelatorio ? path.relative(RAIZ, outJson) : null,
    });
    falhas += numFalhas;
    totalExecutado += numTotal;
    if (run.spawnError) erroExecucao = run.spawnError;
    else if (!temRelatorio) erroExecucao = `jest exit=${run.exitCode} sem relatório`;
    else if (run.exitCode !== 0 && numFalhas === 0) erroExecucao = `jest exit=${run.exitCode} com 0 falhas relatadas`;
  }

  if (grupos.vitest.length > 0) {
    const run = executarVitest(grupos.vitest);
    execucoes.push({
      runner: 'vitest',
      suites: grupos.vitest.length,
      exitCode: run.exitCode,
      signal: run.signal,
      spawnError: run.spawnError,
      numTotalTests: run.totalTests,
      numFailedTests: run.failedTests,
      report: null,
    });
    falhas += run.failedTests || 0;
    totalExecutado += run.totalTests || 0;
    if (run.spawnError) erroExecucao = run.spawnError;
    else if (run.exitCode !== 0 && !run.failedTests) erroExecucao = `vitest exit=${run.exitCode} sem falhas relatadas`;
  }

  // 4b. QA Mesh — os cenários PERTINENTES são EXECUTADOS e entram no gate (P0-5).
  //
  // DEFEITO CORRIGIDO (medido 2026-10-16): o relatório só REGISTRAVA
  // `selection.meshScenarios`. Os cenários eram listados e nunca executados, então um
  // `L1 VERDE` podia conviver com uma jornada quebrada — a jornada só é exercitada
  // pelo mesh, não por suíte Jest/Vitest alguma. Registrar identificador não é prova.
  // A execução usa a MESMA autoridade do pipeline (`qa-mesh/meshRunner.js`, CLI com
  // `--scenario-id=`), por subprocesso, como os demais runners daqui. Ela é
  // NÃO-canônica por construção (o runner exige o registry completo para escrever
  // `go-no-go-report.json`), logo a evidência governada do mesh NÃO é sobrescrita.
  // Cenário selecionado que não puder ser executado ⇒ ESCALATE explícito: nunca
  // verde por ausência de prova.
  const cenariosMesh = Array.isArray(selecao.meshScenarios) ? selecao.meshScenarios : [];
  let mesh = { selected: cenariosMesh.length, executed: false, goNoGo: null, scenarios: cenariosMesh };
  let meshIndisponivel = null;
  if (cenariosMesh.length > 0) {
    const runMeshProc = spawnSync(
      process.execPath,
      [path.join('qa-mesh', 'meshRunner.js'), ...cenariosMesh.map((id) => `--scenario-id=${id}`)],
      { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const resumo = extrairUltimoJson(runMeshProc.stdout);
    if (!resumo || !resumo.goNoGo) {
      const erro = String(runMeshProc.stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' | ');
      meshIndisponivel = `mesh não emitiu veredito (exit=${runMeshProc.status})${erro ? `: ${erro}` : ''}`;
    } else {
      mesh = {
        selected: cenariosMesh.length,
        executed: true,
        goNoGo: resumo.goNoGo,
        reasons: resumo.reasons || [],
        scenarios: cenariosMesh,
        exitCode: runMeshProc.status,
      };
      if (resumo.goNoGo === 'NO_GO') falhas += 1;
    }
  }

  relatorio.execution = {
    runners: execucoes,
    numTotalTests: totalExecutado,
    numFailedTests: falhas,
    byRunner: relatorio.selection.byRunner,
    mesh,
  };
  if (meshIndisponivel) {
    // Estado explícito no relatório ANTES de sair: quem ler a evidência vê que o
    // nível não decidiu, e por quê.
    relatorio.level = NIVEIS.L2;
    relatorio.decision.escalate = true;
    relatorio.decision.escalateReason = 'MESH_NOT_EXECUTED';
    relatorio.decision.meshDetail = meshIndisponivel;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(relatorio, null, 1), 'utf8');

  if (meshIndisponivel) {
    process.stderr.write(`[L1] ESCALATE: ${meshIndisponivel}\n`);
    process.stderr.write('[L1] cenário de mesh selecionado sem execução não sustenta L1 — nível seguinte deve cobrir\n');
    return EXIT.ESCALATE;
  }
  if (erroExecucao) {
    process.stderr.write(`[L1] ERRO de execução: ${erroExecucao}\n`);
    return EXIT.INFRA;
  }
  // Nada executado não é verde: significa que a seleção não produziu evidência.
  if (totalExecutado === 0 && selecao.tests.length > 0) {
    process.stderr.write(`[L1] ERRO: ${selecao.tests.length} suíte(s) selecionada(s) e 0 teste executado\n`);
    return EXIT.INFRA;
  }
  if (falhas > 0) {
    process.stderr.write(`[L1] VERMELHO: ${falhas} de ${totalExecutado} teste(s) falharam\n`);
    return EXIT.RED;
  }
  process.stdout.write(
    `[L1] VERDE: ${totalExecutado} teste(s) ` +
      `(jest=${grupos.jest.length} suíte(s), vitest=${grupos.vitest.length} suíte(s))` +
      `${mesh.executed ? `, mesh=${mesh.selected} cenário(s) ${mesh.goNoGo}` : ''}\n`
  );
  return EXIT.GREEN;
}

if (require.main === module) {
  process.exit(main());
}

// `extrairUltimoJson` exportado para teste: é a parte que decide se o nível
// EXECUTOU a jornada do mesh ou apenas a listou (P0-5).
module.exports = {
  main,
  EXIT,
  extrairUltimoJson,
  arquivosAlterados,
  jornadasPorArquivo,
  cenariosPorJornada,
  executarJest,
  executarVitest,
  separarPorRunner,
};
