#!/usr/bin/env node
'use strict';

/**
 * benchmarkPhaseModel — fase MEDIDA de cada vertical de benchmark.
 *
 * Por que existe: o gate de suficiência respondia uma pergunta só ("esta
 * vertical está completa?") e tratava `holdout_not_preregistered` como falha de
 * ENGINE. Medido em 2026-09-19: 5 verticais (bakery, clinic, food, market,
 * services) falhavam por holdout ausente — mas elas nem começaram a pesquisar
 * (`SAMPLE_NOT_RESEARCHED`). Isso mistura duas coisas muito diferentes:
 *
 *   - o MOTOR está correto?      -> BENCHMARK_ENGINE_GOVERNANCE
 *   - TODAS as verticais estão
 *     certificadas?              -> CERTIFIED_VERTICALS
 *
 * Sem separar, um projeto com 1 de 7 verticais prontas fica "FAIL" de um jeito
 * que não diz se o motor está errado ou se o trabalho não terminou. E o
 * contrário também engana: um PASS de motor não significa 7/7.
 *
 * Aqui a fase é DERIVADA de evidência (runs, achados, saturação, holdout) —
 * nunca declarada. Uma fase declarada seria uma afirmação sobre o que existe,
 * que é exatamente o que este modelo precisa MEDIR.
 */

const PHASES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  MARKET_DISCOVERY: 'MARKET_DISCOVERY',
  DISCOVERY_SET_READY: 'DISCOVERY_SET_READY',
  RESEARCHING: 'RESEARCHING',
  APPARENT_SATURATION: 'APPARENT_SATURATION',
  HOLDOUT: 'HOLDOUT',
  SAMPLE_SUFFICIENT: 'SAMPLE_SUFFICIENT',
  CERTIFIED: 'CERTIFIED',
});

/** Ordem canônica — permite comparar fases (`>=`). */
const PHASE_ORDER = Object.freeze([
  PHASES.NOT_STARTED,
  PHASES.MARKET_DISCOVERY,
  PHASES.DISCOVERY_SET_READY,
  PHASES.RESEARCHING,
  PHASES.APPARENT_SATURATION,
  PHASES.HOLDOUT,
  PHASES.SAMPLE_SUFFICIENT,
  PHASES.CERTIFIED,
]);

const CERTIFICATION_CLAIM = 'SAMPLE_SUFFICIENT';

function phaseIndex(phase) {
  const index = PHASE_ORDER.indexOf(phase);
  return index === -1 ? -1 : index;
}

function isAtLeast(phase, minimum) {
  return phaseIndex(phase) >= phaseIndex(minimum);
}

/**
 * Id do holdout declarado no sample.
 *
 * O campo é `holdout.benchmarkId` (medido em 2026-09-19). Ler `holdout.id`
 * devolvia null e fazia o gate concluir "holdout não pré-registrado" para
 * verticais que TÊM holdout (fitness/wellable.co, beauty/fresha.com) — a mesma
 * classe de defeito de contrato de campo que já apareceu no binding de
 * evidência. O fallback em `id` fica para robustez, mas o canônico é o primeiro.
 */
function resolveHoldoutId(sample) {
  if (!sample || !sample.holdout || typeof sample.holdout !== 'object') return null;
  for (const key of ['benchmarkId', 'id']) {
    const value = sample.holdout[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Fase só pelo ciclo de PESQUISA (sem declaração).
 *
 * @param {object} input
 * @param {Array}  input.runs          runs da vertical, ordem cronológica ASC
 * @param {object} input.counts        { findings, analyzedBenchmarks }
 * @param {string} input.holdoutId     id do holdout declarado (ou null)
 * @param {boolean} input.holdoutAnalyzed
 * @returns {{ phase: string, evidence: object }}
 */
function resolveResearchPhase({ runs = [], counts = {}, holdoutId = null, holdoutAnalyzed = false, holdoutInspected = false }) {
  const evidence = {
    runs: runs.length,
    runsWithDiscoverySet: runs.filter((run) => run.hasDiscoverySet === true).length,
    findings: counts.findings || 0,
    analyzedBenchmarks: counts.analyzedBenchmarks || 0,
    latestSaturated: runs.length > 0 ? runs[runs.length - 1].saturated === true : false,
    holdoutId: holdoutId || null,
    holdoutAnalyzed: holdoutAnalyzed === true,
    holdoutInspected: holdoutInspected === true,
  };

  if (runs.length === 0) return { phase: PHASES.NOT_STARTED, evidence };
  if (evidence.runsWithDiscoverySet === 0) return { phase: PHASES.MARKET_DISCOVERY, evidence };
  if (evidence.findings === 0) return { phase: PHASES.DISCOVERY_SET_READY, evidence };
  if (!evidence.latestSaturated) return { phase: PHASES.RESEARCHING, evidence };
  // O holdout RESPONDEU quando foi inspecionado — inclusive quando a resposta é
  // "nenhum achado". Medido em 2026-09-19: `wellable.co` tem 5 inspeções
  // terminais com RESEARCHED_NO_FINDINGS e 0 achados. Exigir achados para
  // avançar criaria um incentivo perverso: o holdout que legitimamente nada
  // encontra (sinal de que o inventário é específico) ficaria preso para sempre.
  if (holdoutId && (holdoutAnalyzed || holdoutInspected)) return { phase: PHASES.HOLDOUT, evidence };
  return { phase: PHASES.APPARENT_SATURATION, evidence };
}

/**
 * Fase COMPLETA, incluindo a parte DECLARADA.
 *
 * `SAMPLE_SUFFICIENT` é declaração (`claim`) e `CERTIFIED` exige, além dela, a
 * versão semântica atual — o corpus em si é auditado pelo gate
 * BENCHMARK_PERSISTED_CORPUS_CURRENT, que é a autoridade das dimensões de
 * evidência/identidade.
 */
function resolvePhase({ sample = null, runs = [], counts = {}, holdoutAnalyzed = false, holdoutInspected = false, currentSemanticVersion = null }) {
  const holdoutId = resolveHoldoutId(sample);
  const research = resolveResearchPhase({ runs, counts, holdoutId, holdoutAnalyzed, holdoutInspected });

  const declared = sample !== null && sample.claim === CERTIFICATION_CLAIM;
  if (!declared) return research;

  const versionCurrent = currentSemanticVersion !== null
    && sample.semanticPipelineVersion === currentSemanticVersion;

  return {
    phase: versionCurrent ? PHASES.CERTIFIED : PHASES.SAMPLE_SUFFICIENT,
    evidence: {
      ...research.evidence,
      declaredClaim: sample.claim,
      semanticPipelineVersion: sample.semanticPipelineVersion || null,
      semanticVersionCurrent: versionCurrent,
    },
  };
}

/**
 * Exigências que dependem da FASE — a parte que o gate de suficiência tratava
 * sem contexto.
 *
 * Duas classes com consequências opostas:
 *
 *   BLOCKER  — impede AVANÇAR, mas o motor está correto. Uma vertical que ainda
 *              não começou e não pré-registrou o holdout não cometeu erro
 *              nenhum; ela só não pode iniciar a pesquisa assim.
 *
 *   VIOLATION— a pesquisa JÁ começou sem pré-registro do holdout. Isso é
 *              contaminação: o holdout deixou de medir generalização no momento
 *              em que foi escolhido com o resultado à vista, e isso não tem
 *              conserto retroativo. Falha dura.
 *
 * Antes, as duas eram a mesma coisa, e por isso 5 verticais paradas apareciam
 * como falha de governança do motor.
 */
function evaluatePhaseRequirements({ phase, holdoutPreregistered, sample = null }) {
  const blockers = [];
  const violations = [];
  const researchStarted = isAtLeast(phase, PHASES.RESEARCHING);

  if (!holdoutPreregistered) {
    if (researchStarted) {
      violations.push({
        code: 'holdout_not_preregistered',
        detail: 'pesquisa iniciada sem holdout pré-registrado — a medição de generalização está contaminada e não tem conserto retroativo',
      });
    } else if (sample !== null) {
      blockers.push({
        code: 'holdout_preregistration_required_before_research',
        detail: 'vertical ainda não iniciou pesquisa: o holdout precisa ser pré-registrado ANTES de qualquer análise',
      });
    }
  }

  return { blockers, violations, researchStarted };
}

module.exports = {
  PHASES,
  PHASE_ORDER,
  CERTIFICATION_CLAIM,
  phaseIndex,
  isAtLeast,
  resolveHoldoutId,
  resolveResearchPhase,
  resolvePhase,
  evaluatePhaseRequirements,
};
