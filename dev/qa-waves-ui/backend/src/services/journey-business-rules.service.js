/**
 * Journey Business Rules Service — Integra o pipeline de regras de negócio
 * com as jornadas QA do qa-waves/journey-coverage/.
 *
 * Para cada vertical, carrega o businessModel (entidades + relacionamentos),
 * executa inferência e avalia cobertura, depois cruza os gaps com os cenários QA.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { infer } from './business-rules/flow-inferencer.js';
import { evaluate } from './business-rules/coverage-evaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../../../..');
const JOURNEY_DIR = path.join(ROOT, 'qa-waves', 'journey-coverage');
const MODELS_PATH = path.join(__dirname, '../data/business-models.json');

function loadModels() {
  const raw = fs.readFileSync(MODELS_PATH, 'utf8');
  return JSON.parse(raw).verticals;
}

function loadJourneyFile(vertical) {
  const filePath = path.join(JOURNEY_DIR, `${vertical}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Extrai todas as backendEntity únicas referenciadas nos cenários QA da jornada.
 */
function extractQaEntities(journeyData) {
  const entities = new Set();
  for (const journey of (journeyData.journeys || [])) {
    for (const scenario of (journey.scenarios || [])) {
      for (const assertion of (scenario.operationalAssertions || [])) {
        const backendEntity = assertion.expected?.backendEntity;
        if (backendEntity) entities.add(backendEntity.toLowerCase());
      }
    }
  }
  return entities;
}

/**
 * Cruza gaps de negócio com cenários QA:
 * - matchedGaps: gaps cuja entidade é referenciada por cenários QA
 * - unmatchedGaps: gaps sem cenário QA associado
 * - scenariosAtRisk: cenários QA que referenciam entidades com gap
 */
function crossReference(gaps, journeyData, qaEntityMap) {
  const qaEntities = extractQaEntities(journeyData);
  const matchedGaps = [];
  const unmatchedGaps = [];
  const scenariosAtRisk = [];

  for (const gap of gaps) {
    const businessEntity = gap.missingEntity.toLowerCase();
    let matched = false;

    // Verifica se alguma QA entity mapeia para esta entidade de negócio
    for (const qaEntity of qaEntities) {
      const mapped = (qaEntityMap || {})[qaEntity];
      if (mapped && mapped.toLowerCase() === businessEntity) {
        matched = true;
        break;
      }
      // Também verifica match direto
      if (qaEntity === businessEntity) {
        matched = true;
        break;
      }
    }

    if (matched) {
      matchedGaps.push({ ...gap, qaRelevant: true });
    } else {
      unmatchedGaps.push({ ...gap, qaRelevant: false });
    }
  }

  // Encontra cenários QA em risco
  for (const journey of (journeyData.journeys || [])) {
    for (const scenario of (journey.scenarios || [])) {
      for (const assertion of (scenario.operationalAssertions || [])) {
        const backendEntity = (assertion.expected?.backendEntity || '').toLowerCase();
        if (!backendEntity) continue;

        const mapped = (qaEntityMap || {})[backendEntity] || backendEntity;
        const hasGap = gaps.some((g) => g.missingEntity.toLowerCase() === mapped.toLowerCase());

        if (hasGap) {
          scenariosAtRisk.push({
            scenarioId: scenario.scenarioId,
            scenario: scenario.scenario,
            journey: journey.journey,
            entity: backendEntity,
            businessEntity: mapped,
            status: scenario.status
          });
        }
      }
    }
  }

  return { matchedGaps, unmatchedGaps, scenariosAtRisk };
}

/**
 * Interface principal: para cada vertical com businessModel, executa o pipeline
 * e retorna resultados combinados com dados QA.
 */
export function analyzeAllVerticals() {
  const models = loadModels();
  const results = [];

  for (const [verticalId, model] of Object.entries(models)) {
    const journeyData = loadJourneyFile(verticalId);

    // Executa pipeline de regras de negócio
    const { rules, flows } = infer(model.entities, model.relationships);
    const { flowsWithCoverage, gaps } = evaluate(flows, model.sourceFiles || {});

    // Cruza com QA
    let crossRef = { matchedGaps: [], unmatchedGaps: [], scenariosAtRisk: [] };
    if (journeyData) {
      crossRef = crossReference(gaps, journeyData, model.qaEntityMap);
    }

    const totalScenarios = journeyData
      ? (journeyData.journeys || []).reduce((sum, j) => sum + (j.scenarios || []).length, 0)
      : 0;

    const approvedScenarios = journeyData
      ? (journeyData.journeys || []).reduce(
          (sum, j) => sum + (j.scenarios || []).filter((s) => s.status === 'approved').length, 0
        )
      : 0;

    const overallCoverage = flowsWithCoverage.length > 0
      ? Math.round(
          flowsWithCoverage.reduce((sum, f) => sum + f.coverage, 0) / flowsWithCoverage.length
        )
      : 0;

    results.push({
      verticalId,
      label: model.label,
      summary: {
        rulesEvaluated: rules.length,
        rulesOk: rules.length - gaps.length,
        rulesBroken: gaps.length,
        flowsCount: flowsWithCoverage.length,
        gapsCount: gaps.length,
        overallCoverage,
        totalScenarios,
        approvedScenarios,
        scenariosAtRiskCount: crossRef.scenariosAtRisk.length
      },
      flows: flowsWithCoverage,
      gaps,
      qaCrossReference: crossRef,
      sourceInfo: `${model.entities.length} entidades, ${model.relationships.length} relacoes`
    });
  }

  return {
    verticals: results,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Analisa uma vertical específica.
 */
export function analyzeVertical(verticalId) {
  const all = analyzeAllVerticals();
  const result = all.verticals.find((v) => v.verticalId === verticalId);
  if (!result) throw new Error(`Vertical "${verticalId}" nao encontrada`);
  return result;
}

export default { analyzeAllVerticals, analyzeVertical };
