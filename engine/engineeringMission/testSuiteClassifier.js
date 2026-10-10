'use strict';

/**
 * engine/engineeringMission/testSuiteClassifier.js
 *
 * Classificação de COMANDO DE TESTE por categoria de cobertura.
 *
 * DEFEITO MEDIDO (auditoria 2026-10-10): em `missionReviewService.deriveGates`, os
 * gates `unit` e `integration` eram alimentados pela MESMA condição
 * (`testsAllPass`), sem qualquer classificação do comando executado. Um único
 * `engineering_test_runs` verde marcava as duas categorias como `PASS` — ou seja,
 * a missão afirmava ter cobertura de integração com base em evidência genérica.
 *
 * Este módulo é PURO (sem I/O, sem clock) e faz apenas a parte que pode ser feita
 * sem arbitrar política: dizer a que categoria um comando pertence, com
 * `UNKNOWN` explícito quando não é possível concluir. NÃO decide o que é
 * obrigatório — essa é uma decisão de política de execução (ver
 * `policyNote` abaixo), e por isso o resultado é REPORTADO no gate em vez de
 * inferido em silêncio.
 *
 * policyNote: exigir integração como requisito de GREEN sem garantir que toda
 * missão EXECUTE integração transforma correções legítimas em BLOCKED. Enquanto a
 * política de execução não for decidida (rodar `tests/flow` por missão?), o
 * classificador reporta a cobertura por categoria para que a lacuna seja VISÍVEL
 * em vez de maquiada.
 */

const CATEGORIES = Object.freeze({
  UNIT: 'unit',
  INTEGRATION: 'integration',
  E2E: 'e2e',
  UNKNOWN: 'unknown',
});

const TOKEN = ' ';

/** Normaliza o comando para casar padrões sem se perder em espaços/quebras. */
function normalizeCommand(command) {
  return String(command === null || command === undefined ? '' : command)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasPath(command, ...needles) {
  return needles.some((needle) => command.includes(needle));
}

/**
 * Classifica o comando. A ordem importa: e2e/integração primeiro, porque um
 * comando de integração pode MENCIONAR a pasta de testes do projeto.
 *
 * @returns {'unit'|'integration'|'e2e'|'unknown'}
 */
function classifyTestCommand(command) {
  const normalized = normalizeCommand(command);
  if (normalized === '') return CATEGORIES.UNKNOWN;

  // E2E (Playwright/browser) — distinto de integração de API.
  if (hasPath(normalized, 'test:e2e', 'playwright', 'frontend-e2e', 'tests/e2e')) {
    return CATEGORIES.E2E;
  }

  // Integração: suítes que exercitam o sistema ponta a ponta (fluxo, integração
  // de API, banco real).
  if (hasPath(
    normalized,
    'tests/integration',
    'tests/flow',
    'test:flow',
    'test:system',
    'integration.test',
    '--testpathpattern=tests/integration',
  )) {
    return CATEGORIES.INTEGRATION;
  }

  // Unitárias: suítes isoladas do domínio.
  if (hasPath(
    normalized,
    'tests/unit',
    'test:unit',
    '--testpathpattern=tests/unit',
    '/__tests__/',
    '.test.js',
    '.test.mjs',
  )) {
    return CATEGORIES.UNIT;
  }

  return CATEGORIES.UNKNOWN;
}

/**
 * Agrega a cobertura por categoria sobre os runs persistidos.
 *
 * @param {Array<{command?:string,status?:string,exit_code?:number,exitCode?:number}>} runs
 * @returns {{byCategory:Object<string,{commands:string[],passed:number,failed:number}>, categories:string[], hasIntegrationEvidence:boolean, unknownCommands:string[]}}
 */
function summarizeTestCoverage(runs) {
  const byCategory = {};
  for (const category of Object.values(CATEGORIES)) {
    byCategory[category] = { commands: [], passed: 0, failed: 0 };
  }

  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run !== 'object') continue;
    const category = classifyTestCommand(run.command);
    const status = String(run.status || '').toUpperCase();
    const exitCode = run.exit_code === undefined || run.exit_code === null
      ? (run.exitCode === undefined || run.exitCode === null ? null : Number(run.exitCode))
      : Number(run.exit_code);
    const passed = status === 'PASS' && (exitCode === null || exitCode === 0);
    byCategory[category].commands.push(String(run.command || ''));
    if (passed) byCategory[category].passed += 1;
    else byCategory[category].failed += 1;
  }

  const categories = Object.values(CATEGORIES).filter(
    (category) => byCategory[category].commands.length > 0,
  );

  return {
    byCategory,
    categories,
    // Evidência de integração EXISTE quando há run executado de integração ou e2e
    // (não basta o comando estar no contrato: precisa ter rodado).
    hasIntegrationEvidence: byCategory[CATEGORIES.INTEGRATION].commands.length > 0
      || byCategory[CATEGORIES.E2E].commands.length > 0,
    unknownCommands: byCategory[CATEGORIES.UNKNOWN].commands,
  };
}

module.exports = {
  CATEGORIES,
  classifyTestCommand,
  summarizeTestCoverage,
};
