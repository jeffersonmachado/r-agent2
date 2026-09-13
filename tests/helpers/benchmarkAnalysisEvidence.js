'use strict';

/**
 * Fixture de ANÁLISE COMPLETA — exclusiva de TESTES.
 *
 * O critério de `markAnalyzed` ficou mais forte na missão corretiva de
 * 2026-09-13 (TAREFA 20): antes bastava "1 achado verificado + arquétipo", o
 * que transformava "achei uma página" em benchmark ANALISADO. Agora exige, do
 * estado PERSISTIDO, os três eixos pesquisados, inspeção de documentação e de
 * API, e evidência ligada ao conteúdo (hash + locator).
 *
 * Este helper monta esse estado LEGÍTIMO — sem atalho e sem burlar o critério:
 * ele passa exatamente pelas APIs públicas do serviço (`setAxisState`,
 * `recordInspections`, `recordFinding`). Um teste que precise de "análise
 * aceita" usa este helper; um teste que precise de RECUSA simplesmente não o
 * chama.
 *
 * Nunca importe este módulo de dentro de `api/`.
 */

const {
  RESEARCH_AXES,
  AXIS_STATES,
} = require('../../api/services/benchmark/benchmarkResearchSemantics');

const FIXTURE_CONTENT_HASH = 'sha256:conteudo-analisado-fixture';
const FIXTURE_LOCATOR = 'section:Recursos#1';

const FIXTURE_SOURCE = Object.freeze({
  url: 'https://docs.example-vendor.com/features/membership-management',
  tier: 5,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
  contentHash: FIXTURE_CONTENT_HASH,
});

/**
 * Registra um achado VERIFICADO e LIGADO ao conteúdo analisado.
 * Passa `analyzedContentHash` igual ao hash da fonte: é isso que faz a
 * evidência valer (hash binding, TAREFA 11).
 */
async function recordVerifiedFinding(service, {
  tenantId,
  vertical,
  benchmarkId,
  kind = 'capability',
  externalName = 'Gestão de matrículas',
  canonicalId = null,
  archetype = null,
  locator = FIXTURE_LOCATOR,
  contentHash = FIXTURE_CONTENT_HASH,
  evidenceRef = `ev-${benchmarkId}-${externalName}`,
  source = null,
} = {}) {
  return service.recordFinding({
    tenantId,
    vertical,
    benchmarkId,
    kind,
    externalName,
    canonicalId,
    archetype,
    source: source || { ...FIXTURE_SOURCE, contentHash },
    evidenceRef,
    locator,
    analyzedContentHash: contentHash,
    benchmark: { id: benchmarkId },
  });
}

/**
 * Deixa o benchmark no estado que o critério forte considera ANALISÁVEL:
 * três eixos pesquisados, documentação e API inspecionadas e um achado
 * verificado com evidência ligada.
 */
async function completeAnalysisEvidence(service, {
  tenantId,
  vertical,
  benchmarkId,
  withFinding = true,
  axisStates = {
    [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_WITH_FINDINGS,
    [RESEARCH_AXES.JOURNEY]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
    [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
  },
  externalName = 'Gestão de matrículas',
  canonicalId = null,
  contentHash = FIXTURE_CONTENT_HASH,
  locator = FIXTURE_LOCATOR,
} = {}) {
  for (const [axis, state] of Object.entries(axisStates)) {
    await service.setAxisState({ tenantId, vertical, benchmarkId, axis, state });
  }
  await service.recordInspections({
    tenantId,
    vertical,
    benchmarkId,
    inspections: { documentation: true, api: true, apiApplicable: true },
  });

  if (withFinding) {
    await recordVerifiedFinding(service, {
      tenantId,
      vertical,
      benchmarkId,
      externalName,
      canonicalId,
      contentHash,
      locator,
    });
  }

  return { contentHash, locator };
}

module.exports = {
  FIXTURE_CONTENT_HASH,
  FIXTURE_LOCATOR,
  FIXTURE_SOURCE,
  recordVerifiedFinding,
  completeAnalysisEvidence,
};
