'use strict';

/**
 * Seleção de validação por impacto — MISSÃO A / L1.
 *
 * Módulo PURO (zero I/O). Recebe os dados já carregados e devolve uma decisão
 * estruturada e rastreável sobre o que reexecutar.
 *
 * Camadas (aplicadas em ordem, união dos resultados):
 *   [1] TRANSITIVA  — fecho reverso do grafo de imports (73,6% dos arquivos);
 *   [2] JORNADA     — itens de inventário ligados à jornada → cenários do mesh
 *                     (o único elo com vocabulário compartilhado: 88/95);
 *   [3] VIZINHANÇA  — regras declaradas por prefixo, conservadoras, para o que
 *                     as camadas 1-2 não alcançam.
 *
 * Fail-closed: um arquivo de produção alterado que NENHUMA camada classifica
 * eleva a decisão para `escalate` — "na dúvida, valide mais", nunca menos. O
 * defeito histórico é o oposto: `qa/impact-map.json` cobre 1,13% dos arquivos e
 * degrada em silêncio para "nenhum teste afetado".
 */

const { normalizar, isTestFile } = require('./impactGraph');

/** Níveis de validação, do mais barato ao mais caro. */
const NIVEIS = Object.freeze({ L1: 'L1', L2: 'L2', L3: 'L3' });

/**
 * Cria o resultado vazio de uma seleção.
 * @returns {object}
 */
function selecaoVazia() {
  return {
    tests: new Set(),
    journeys: new Set(),
    meshScenarios: new Set(),
    layers: { transitiva: new Set(), jornada: new Set(), vizinhanca: new Set() },
    classified: new Set(),
  };
}

/**
 * Camada 1 — fecho transitivo reverso do grafo de imports.
 * @param {object} input
 * @param {string[]} input.changed arquivos alterados (produção + testes)
 * @param {Object<string,string[]>} input.reverse grafo reverso
 * @param {object} acc acumulador
 * @param {Function} collectDependents injetado (mantém o módulo testável)
 */
function camadaTransitiva({ changed, reverse }, acc, collectDependents) {
  const { tests, dependents } = collectDependents({ reverse, targets: changed });

  for (const t of tests) {
    acc.tests.add(t);
    acc.layers.transitiva.add(t);
  }

  // Um arquivo alterado é dado por "classificado" pela camada transitiva quando o
  // fecho reverso A PARTIR DELE alcança pelo menos um arquivo de TESTE.
  //
  // P0-5 (medido 2026-10-16): a regra anterior classificava o arquivo quando
  // `reverse[n]` tinha QUALQUER entrada — inclusive dependentes de produção que
  // nenhum teste alcança. TER DEPENDENTES NÃO É TER TESTES. Consequência medida: com
  // outra alteração qualquer produzindo testes, a seleção ficava não-vazia, o nível
  // ficava L1 e este arquivo era dado como coberto por NADA — o `L1 GREEN` escondia
  // que ele não foi exercitado por suíte alguma. Agora, sem teste alcançável, ele
  // permanece `unclassified` e a decisão escala (fail-closed); quem quiser fechá-lo
  // declara a cobertura na camada de vizinhança, com `reason` explícito.
  //
  // Arquivo de TESTE alterado executa a si mesmo: ninguém o "importa", então o fecho
  // reverso nunca o traria, e a alteração no próprio teste ficaria sem validação.
  // Medido em 2026-10-14: alterar um arquivo de teste devolvia seleção vazia para ele.
  for (const c of changed) {
    const n = normalizar(c);
    if (isTestFile(n)) {
      acc.classified.add(n);
      acc.tests.add(n);
      acc.layers.transitiva.add(n);
      continue;
    }
    const alcancados = collectDependents({ reverse, targets: [n] });
    if ((alcancados.tests || []).length > 0) acc.classified.add(n);
  }

  return { tests, dependents };
}

/**
 * Camada 2 — jornadas do inventário e cenários do mesh.
 *
 * `journeysByFile` mapeia caminho → jornadas (derivado do inventário).
 * `scenariosByJourney` mapeia jornada → cenários do mesh.
 *
 * @param {object} input
 * @param {string[]} input.changed
 * @param {Object<string,string[]>} input.journeysByFile
 * @param {Object<string,string[]>} input.scenariosByJourney
 * @param {object} acc acumulador
 */
function camadaJornada({ changed, journeysByFile = {}, scenariosByJourney = {} }, acc) {
  const jornadas = new Set();
  for (const c of changed) {
    const n = normalizar(c);
    const doArquivo = journeysByFile[n] || [];
    if (doArquivo.length > 0) acc.classified.add(n);
    for (const j of doArquivo) jornadas.add(j);
  }
  for (const j of jornadas) {
    acc.journeys.add(j);
    acc.layers.jornada.add(j);
    for (const s of scenariosByJourney[j] || []) acc.meshScenarios.add(s);
  }
  return { journeys: [...jornadas].sort() };
}

/**
 * Camada 3 — vizinhança declarada por prefixo (conservadora).
 *
 * Regras: `[{ prefix, tests: [...], reason }]`. Aplicada apenas a arquivos de
 * produção ainda não classificados, para não inflar seleções já resolvidas.
 *
 * @param {object} input
 * @param {string[]} input.changed
 * @param {string[]} input.pending arquivos ainda não classificados
 * @param {Array<{prefix: string, tests: string[], reason?: string}>} input.rules
 * @param {object} acc acumulador
 * @returns {{aplicadas: object[]}}
 */
function camadaVizinhanca({ pending = [], rules = [] }, acc) {
  const aplicadas = [];
  for (const alvo of pending) {
    const n = normalizar(alvo);
    for (const regra of rules) {
      if (!regra || !regra.prefix) continue;
      const prefixo = normalizar(regra.prefix);
      const casa = n === prefixo || n.startsWith(prefixo.endsWith('/') ? prefixo : prefixo + '/');
      if (!casa) continue;
      for (const t of regra.tests || []) {
        acc.tests.add(t);
        acc.layers.vizinhanca.add(t);
      }
      acc.classified.add(n);
      aplicadas.push({ alvo: n, prefix: prefixo, tests: [...(regra.tests || [])], reason: regra.reason });
      break;
    }
  }
  return { aplicadas };
}

/**
 * Seleciona a validação para um conjunto de arquivos alterados.
 *
 * @param {object} input
 * @param {string[]} input.changedFiles arquivos alterados (relativos à raiz)
 * @param {Object<string,string[]>} input.reverse grafo reverso (camada 1)
 * @param {Object<string,string[]>} [input.journeysByFile] (camada 2)
 * @param {Object<string,string[]>} [input.scenariosByJourney] (camada 2)
 * @param {Array<object>} [input.neighborhoodRules] (camada 3)
 * @param {number} [input.minTestsForL1] se a seleção tiver menos que isto, escala
 * @param {Function} [input.collectDependents] injeção para teste
 * @param {Function} [input.nowMs] injeção de relógio (determinismo)
 * @returns {object} decisão estruturada
 */
function selectValidation({
  changedFiles = [],
  reverse = {},
  journeysByFile = {},
  scenariosByJourney = {},
  neighborhoodRules = [],
  minTestsForL1 = 1,
  collectDependents,
  nowMs,
} = {}) {
  if (typeof collectDependents !== 'function') {
    throw new Error('selectValidation: collectDependents é obrigatório (injeção)');
  }

  const changed = [...new Set(changedFiles.map(normalizar))].sort();
  if (changed.length === 0) {
    return {
      level: NIVEIS.L3,
      escalate: true,
      escalateReason: 'NO_CHANGED_FILES',
      tests: [],
      journeys: [],
      meshScenarios: [],
      layers: { transitiva: [], jornada: [], vizinhanca: [] },
      unclassified: [],
      totalTests: 0,
      generatedAt: typeof nowMs === 'function' ? nowMs() : undefined,
    };
  }

  const acc = selecaoVazia();

  camadaTransitiva({ changed, reverse }, acc, collectDependents);
  camadaJornada({ changed, journeysByFile, scenariosByJourney }, acc);

  const unclassified = changed.filter((c) => !acc.classified.has(c) && !isTestFile(c));
  camadaVizinhanca({ pending: unclassified, rules: neighborhoodRules }, acc);

  const aindaSemClasse = changed.filter((c) => !acc.classified.has(c) && !isTestFile(c));
  const tests = [...acc.tests].sort();

  // Decisão: fail-closed — arquivo de produção sem classificação OU seleção
  // vazia/insuficiente escala o nível.
  let level = NIVEIS.L1;
  let escalate = false;
  let escalateReason;

  if (aindaSemClasse.length > 0) {
    level = NIVEIS.L2;
    escalate = true;
    escalateReason = 'UNCLASSIFIED_CHANGED_FILES';
  } else if (tests.length < minTestsForL1 && changed.some((c) => !isTestFile(c))) {
    level = NIVEIS.L2;
    escalate = true;
    escalateReason = 'INSUFFICIENT_SELECTION';
  }

  return {
    level,
    escalate,
    escalateReason,
    tests,
    journeys: [...acc.journeys].sort(),
    meshScenarios: [...acc.meshScenarios].sort(),
    layers: {
      transitiva: [...acc.layers.transitiva].sort(),
      jornada: [...acc.layers.jornada].sort(),
      vizinhanca: [...acc.layers.vizinhanca].sort(),
    },
    unclassified: aindaSemClasse,
    changedFiles: changed,
    totalTests: tests.length,
    generatedAt: typeof nowMs === 'function' ? nowMs() : undefined,
  };
}

module.exports = {
  NIVEIS,
  selectValidation,
  camadaTransitiva,
  camadaJornada,
  camadaVizinhanca,
};
