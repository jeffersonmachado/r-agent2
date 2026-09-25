#!/usr/bin/env node
'use strict';

/**
 * generate-v2-requirements-matrix.js — MATRIZ DE REQUISITOS V2 DERIVADA.
 *
 * Requisito da missão: a matriz deve ser machine-readable (`requirement`, `test`, `evidence`,
 * `status`) e o relatório de status NÃO pode ser autoridade — ele é DERIVADO. O achado que
 * originou isto: contagens escritas à mão divergiam entre artefatos (o mesmo conjunto aparecia
 * como "17 suítes / 202 testes" num lugar e "19 suítes / 215 testes" em outro), porque cada
 * documento repetia um número que ninguém recalculava.
 *
 * Aqui TODO número é recalculado a partir das fontes reais:
 *   - `reports/release-suite-execution.json` (execução canônica das suítes do manifesto);
 *   - `reports/anti-greenwashing-report.json` (ausência de mecanismos de pulo);
 *   - `reports/engineering-router-v2-seal-report.json` (decisão do selo, quando existir).
 *
 * O mapeamento eixo → suítes é DECLARADO em `config/v2-requirements-axes.json` (auditável), não
 * inferido por heurística de nome de arquivo.
 *
 * Fail-closed: eixo OBRIGATÓRIO sem suíte executada é violação — nunca "sem evidência, então
 * presumo OK". E o status GLOBAL nunca é GO quando algum eixo obrigatório não estiver comprovado.
 *
 * Uso:
 *   node scripts/governance/generate-v2-requirements-matrix.js
 */

const fs = require('fs');
const path = require('path');
const { ROOT, writeReport } = require('./common');

const AXES_CONFIG = path.join(ROOT, 'config', 'v2-requirements-axes.json');
const SUITE_EXECUTION_REPORT = path.join(ROOT, 'reports', 'release-suite-execution.json');
const ANTI_GREENWASHING_REPORT = path.join(ROOT, 'reports', 'anti-greenwashing-report.json');
const SEAL_REPORT = path.join(ROOT, 'reports', 'engineering-router-v2-seal-report.json');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Eixos que NÃO dependem de execução de suíte (o veredito vem de outro gate/relatório). */
const NON_SUITE_AXES = new Set(['ANTI_GREENWASHING', 'ENGINEERING_ROUTER_V2_SEAL']);

function deriveAxisStatus({ axisId, definition, suiteExecution, antiGreenwashing, sealReport }) {
  const suites = Array.isArray(definition.suites) ? definition.suites : [];
  const states = suiteExecution?.suites || {};

  const suiteStates = suites.map((suite) => ({
    suite,
    state: states[suite]?.state || 'NOT_EXECUTED',
    testsExecuted: states[suite]?.testsExecuted ?? 0,
  }));

  const failingSuites = suiteStates.filter((s) => s.state !== 'PASS');
  const testsExecuted = suiteStates.reduce((acc, s) => acc + Number(s.testsExecuted || 0), 0);

  if (NON_SUITE_AXES.has(axisId)) {
    if (axisId === 'ANTI_GREENWASHING') {
      const status = antiGreenwashing?.status === 'PASS' ? 'GO' : 'NO_GO';
      return {
        status,
        testsExecuted: 0,
        suiteStates,
        reason: antiGreenwashing
          ? `anti-greenwashing status=${antiGreenwashing.status} suites=${antiGreenwashing.authoritativeSuites ?? '?'} violações=${antiGreenwashing.violationCount ?? '?'}`
          : 'relatório anti-greenwashing ausente — sem prova, não é GO',
      };
    }
    const status = sealReport?.status === 'GO' ? 'GO' : 'NO_GO';
    return {
      status,
      testsExecuted: 0,
      suiteStates,
      reason: sealReport ? `selo V2 status=${sealReport.status}` : 'relatório de selo ausente — o selo não pode ser presumido',
    };
  }

  if (suites.length === 0) {
    return { status: 'NO_GO', testsExecuted: 0, suiteStates, reason: 'eixo obrigatório sem suíte declarada — nada o comprova' };
  }

  if (!suiteExecution) {
    return { status: 'NO_GO', testsExecuted: 0, suiteStates, reason: 'relatório de execução de suítes ausente — sem prova de execução, nenhum eixo é GO' };
  }

  if (failingSuites.length > 0) {
    return {
      status: 'NO_GO',
      testsExecuted,
      suiteStates,
      reason: `suítes não PASS: ${failingSuites.map((s) => `${s.suite}(${s.state})`).join(', ')}`,
    };
  }

  return {
    status: 'GO',
    testsExecuted,
    suiteStates,
    reason: `${suiteStates.length} suíte(s) PASS, ${testsExecuted} teste(s) executados`,
  };
}

/**
 * Os caminhos são injetáveis para que a matriz seja TESTÁVEL: sem isso, só seria possível provar
 * o comportamento reescrevendo relatórios reais no disco.
 */
function buildMatrix({
  axesConfigPath = AXES_CONFIG,
  suiteExecutionPath = SUITE_EXECUTION_REPORT,
  antiGreenwashingPath = ANTI_GREENWASHING_REPORT,
  sealReportPath = SEAL_REPORT,
} = {}) {
  const config = readJsonSafe(axesConfigPath);
  if (!config || !config.axes) {
    throw new Error(`config de eixos ausente/ilegível: ${axesConfigPath}`);
  }

  const suiteExecution = readJsonSafe(suiteExecutionPath);
  const antiGreenwashing = readJsonSafe(antiGreenwashingPath);
  const sealReport = readJsonSafe(sealReportPath);

  const axes = {};
  const violations = [];
  let totalTestsExecuted = 0;
  const suitesSeen = new Set();
  const suitesPassed = new Set();

  for (const [axisId, definition] of Object.entries(config.axes)) {
    const derived = deriveAxisStatus({ axisId, definition, suiteExecution, antiGreenwashing, sealReport });
    axes[axisId] = {
      requirement: definition.requirement,
      test: definition.suites,
      evidence: definition.evidence,
      gate: definition.gate || null,
      decision: derived.status,
      testsExecuted: derived.testsExecuted,
      suites: derived.suiteStates,
      reason: derived.reason,
    };
    // Vocabulário ÚNICO de eixo: GO/NO_GO. Não há "PASS de eixo" — PASS é estado de SUÍTE, e
    // misturar os dois foi o que permitiu, em outros documentos, um eixo parcial parecer aprovado.
    axes[axisId].status = derived.status === 'GO' ? 'GO' : 'NO_GO';

    totalTestsExecuted += derived.testsExecuted;
    for (const s of derived.suiteStates) {
      suitesSeen.add(s.suite);
      if (s.state === 'PASS') suitesPassed.add(s.suite);
    }
    // O eixo agregado NÃO entra nas violações individuais: o veredito dele é calculado depois, a
    // partir dos demais. Sem isso há CIRCULARIDADE REAL (o selo exigindo a si mesmo) — defeito
    // encontrado ao rodar o sealer pela primeira vez: a matriz reprovava por causa do eixo do selo
    // e o selo abortava por causa da matriz, sem que nada estivesse comprovadamente errado.
    if (derived.status !== 'GO' && definition.aggregate !== true) {
      violations.push({ axis: axisId, detail: derived.reason });
    }
  }

  // SEGUNDO PASSE: resolve os eixos agregados a partir dos demais.
  for (const [axisId, definition] of Object.entries(config.axes)) {
    if (definition.aggregate !== true) continue;
    const others = Object.entries(axes).filter(([id]) => id !== axisId);
    const notGo = others.filter(([, axis]) => axis.status !== 'GO').map(([id]) => id);
    const go = notGo.length === 0;
    axes[axisId].status = go ? 'GO' : 'NO_GO';
    axes[axisId].decision = axes[axisId].status;
    axes[axisId].testsExecuted = 0;
    axes[axisId].reason = go
      ? `agregado: todos os ${others.length} eixos avaliados estão GO`
      : `agregado: eixo(s) sem prova — ${notGo.join(', ')}`;
    if (!go) violations.push({ axis: axisId, detail: axes[axisId].reason });
  }

  const axesCount = Object.keys(axes).length;
  const goAxes = Object.values(axes).filter((a) => a.status === 'GO').length;

  return {
    artifactType: 'engineering-router-v2-requirements-matrix',
    artifactVersion: config.matrixVersion || '1.0.0',
    generatedAt: new Date().toISOString(),
    derivedFrom: {
      mapping: 'config/v2-requirements-axes.json',
      suiteExecution: fs.existsSync(suiteExecutionPath) ? 'reports/release-suite-execution.json' : null,
      antiGreenwashing: fs.existsSync(antiGreenwashingPath) ? 'reports/anti-greenwashing-report.json' : null,
      sealReport: fs.existsSync(sealReportPath) ? 'reports/engineering-router-v2-seal-report.json' : null,
      note: 'Nenhum número desta matriz é escrito à mão: todos são recalculados das fontes declaradas.',
    },
    // Contagens DERIVADAS — a origem do defeito que motivou este gerador era justamente um
    // "17 suítes / 202 testes" digitado num documento e "19 / 215" em outro.
    totals: {
      axes: axesCount,
      axesGo: goAxes,
      axesNoGo: axesCount - goAxes,
      suitesMapped: suitesSeen.size,
      suitesPass: suitesPassed.size,
      testsExecuted: totalTestsExecuted,
    },
    unmappedRequirementIds: config.unmappedRequirementIds || null,
    axes,
    violations,
    violationCount: violations.length,
    status: violations.length === 0 ? 'GO' : 'NO_GO',
  };
}

function main() {
  let matrix;
  try {
    matrix = buildMatrix();
  } catch (error) {
    console.error(`[v2-requirements-matrix] ${error.message}`);
    process.exit(1);
  }
  writeReport('engineering-router-v2-requirements-matrix.json', matrix);
  console.log(`[v2-requirements-matrix] status=${matrix.status} eixos=${matrix.totals.axesGo}/${matrix.totals.axes} suítes=${matrix.totals.suitesPass}/${matrix.totals.suitesMapped} testes=${matrix.totals.testsExecuted}`);
  if (matrix.status !== 'GO') {
    for (const v of matrix.violations) console.error(`  - ${v.axis} :: ${v.detail}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildMatrix, deriveAxisStatus };
