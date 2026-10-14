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

const RAIZ = path.resolve(__dirname, '..', '..');
const GRAFO = path.join(RAIZ, 'reports', 'impact-graph.json');
const INVENTARIO = path.join(RAIZ, 'config', 'system-inventory.json');
const MESH = path.join(RAIZ, 'qa-mesh', 'meshRegistry.json');
const VIZINHANCA = path.join(RAIZ, 'config', 'impact-neighborhood.json');
const SAIDA = path.join(RAIZ, 'reports', 'impact-validation-report.json');

const EXIT = Object.freeze({ GREEN: 0, RED: 1, ESCALATE: 2, INFRA: 3 });

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
 * jornadas por arquivo, derivadas do inventário (elo arquivo→jornada).
 * @returns {Object<string, string[]>}
 */
function jornadasPorArquivo() {
  const mapa = {};
  try {
    const inv = lerJsonObrigatorio(INVENTARIO, 'inventário');
    for (const item of inv.items || []) {
      const src = item.source ? normalizar(item.source) : null;
      if (!src) continue;
      const j = item.linkedJourneys || [];
      if (j.length === 0) continue;
      mapa[src] = [...new Set([...(mapa[src] || []), ...j])].sort();
    }
  } catch {
    /* inventário ilegível não bloqueia: a camada 2 fica vazia e o fail-closed cobre */
  }
  return mapa;
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
 * Executa o L1.
 * @param {string[]} argv
 * @returns {number} exit code
 */
function main(argv = process.argv.slice(2)) {
  const arg = (nome, padrao = null) => {
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const dryRun = argv.includes('--dry-run');
  const base = arg('--base', 'HEAD');
  const out = arg('--out', SAIDA);

  // 1. grafo
  if (!fs.existsSync(GRAFO)) {
    process.stderr.write(`[L1] ERRO: artefato do grafo ausente. Rode: node scripts/governance/build-impact-graph.js\n`);
    return EXIT.INFRA;
  }
  const grafo = JSON.parse(fs.readFileSync(GRAFO, 'utf8'));

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
    journeysByFile: jornadasPorArquivo(),
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
    relatorio.execution = { dryRun: true };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(relatorio, null, 1), 'utf8');
    process.stdout.write('[L1] dry-run: nenhuma suíte executada\n');
    return EXIT.GREEN;
  }

  // 4. execução
  const outJson = path.join(path.dirname(out), 'impact-jest.json');
  const run = executarJest(selecao.tests, outJson);
  relatorio.execution = {
    exitCode: run.exitCode,
    signal: run.signal,
    spawnError: run.spawnError,
    jestReport: fs.existsSync(outJson) ? path.relative(RAIZ, outJson) : null,
  };

  let falhas = 0;
  if (fs.existsSync(outJson)) {
    try {
      const j = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      falhas = j.numFailedTests || 0;
      relatorio.execution.numTotalTests = j.numTotalTests || 0;
      relatorio.execution.numFailedTestSuites = j.numFailedTestSuites || 0;
    } catch {
      /* relatório ilegível conta como falha de infraestrutura abaixo */
    }
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(relatorio, null, 1), 'utf8');

  if (run.spawnError || (run.exitCode !== 0 && falhas === 0 && !relatorio.execution.numTotalTests)) {
    process.stderr.write(`[L1] ERRO de execução: ${run.spawnError || `exit=${run.exitCode} sem relatório`}\n`);
    return EXIT.INFRA;
  }
  if (falhas > 0 || run.exitCode === 1) {
    process.stderr.write(`[L1] VERMELHO: ${falhas} teste(s) falharam\n`);
    return EXIT.RED;
  }
  process.stdout.write(`[L1] VERDE: ${relatorio.execution.numTotalTests} teste(s)\n`);
  return EXIT.GREEN;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, EXIT, arquivosAlterados, jornadasPorArquivo, cenariosPorJornada, executarJest };
