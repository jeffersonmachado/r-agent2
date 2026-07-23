'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../../../api/utils/logger');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'qa-waves-registry.json');
const DEFAULT_TEMPLATE_ID = 'customer_lifecycle_v1';

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`[journeyInferenceService] Falha ao carregar registry: ${error.message}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function getBaseTemplate(registry, templateId = DEFAULT_TEMPLATE_ID) {
  const templates = Array.isArray(registry.baseJourneyTemplates) ? registry.baseJourneyTemplates : [];
  return templates.find((item) => item.id === templateId) || templates[0] || {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Customer Lifecycle Base',
    steps: [],
  };
}

function getVerticalJourneyMap(registry, vertical) {
  const all = registry.verticalJourneys && typeof registry.verticalJourneys === 'object'
    ? registry.verticalJourneys
    : {};
  return all[String(vertical || '').toLowerCase()] || {};
}

function getJourneyDefinition(registry, { vertical, journeyId }) {
  const verticalMap = getVerticalJourneyMap(registry, vertical);
  if (journeyId && verticalMap[journeyId]) {
    return {
      journeyId,
      name: verticalMap[journeyId].name || journeyId,
      steps: Array.isArray(verticalMap[journeyId].steps) ? clone(verticalMap[journeyId].steps) : [],
    };
  }

  const legacyBlueprints = Array.isArray(registry.journeyBlueprints) ? registry.journeyBlueprints : [];
  const domain = legacyBlueprints.find((item) => item.id === String(vertical || '').toLowerCase());
  const journey = (domain?.journeys || []).find((item) => item.id === journeyId);
  if (journey) {
    const baseTemplate = getBaseTemplate(registry);
    return {
      journeyId,
      name: journey.name || journeyId,
      steps: clone(baseTemplate.steps || []),
    };
  }

  return null;
}

function buildCandidateJourneys(registry, vertical) {
  const verticalMap = getVerticalJourneyMap(registry, vertical);
  return Object.entries(verticalMap).map(([journeyId, definition]) => ({
    journeyId,
    name: definition?.name || journeyId,
    steps: Array.isArray(definition?.steps) ? definition.steps : [],
  }));
}

// Lookup estrito no registry — NÃO é inferência. Retorna null quando o
// journeyId não é informado ou não existe no registry: escolher uma jornada
// "mais parecida" por tokens era o fallback heurístico, removido (princípio
// AI-native: inferência de jornada é feita por inferJourneyWithAI).
function resolveJourneyFromRegistry(input = {}, registry = readRegistry()) {
  const vertical = String(input.vertical || '').toLowerCase().trim() || 'core';
  const explicitJourneyId = String(input.journeyId || input.journey || '').trim();
  if (!explicitJourneyId) {
    return null;
  }

  const definition = getJourneyDefinition(registry, { vertical, journeyId: explicitJourneyId });
  if (!definition) {
    return null;
  }

  return {
    journeyId: definition.journeyId,
    steps: definition.steps,
    journeySource: input.journeySource || 'manual',
    baseTemplateId: getBaseTemplate(registry, input.baseTemplateId).id,
    vertical,
  };
}

async function inferJourneyWithAI(input = {}) {
  const { generateAiResponse } = require('../../../api/services/aiProviderService');
  const registry = readRegistry();
  const tenantId = String(input.tenantId || 'system').trim() || 'system';
  const vertical = String(input.vertical || '').toLowerCase().trim() || 'core';
  const candidates = buildCandidateJourneys(registry, vertical);

  if (candidates.length === 0) {
    throw new Error(`[journeyInferenceService] Nenhuma jornada candidata encontrada para vertical: ${vertical}`);
  }

  const prompt = [
    'Voce e um resolvedor de jornadas QA Waves.',
    'Escolha a jornada mais adequada para o cenario usando APENAS as jornadas candidatas.',
    'Retorne APENAS JSON valido no formato {"journeyId":"...","steps":["..."]}.',
    `Vertical: ${vertical}`,
    `Scenario name: ${String(input.scenarioName || '')}`,
    `Description: ${String(input.description || '')}`,
    `Candidatas: ${JSON.stringify(candidates)}`,
  ].join('\n');

  try {
    const response = await generateAiResponse(prompt, tenantId, {
      source: 'qa_waves',
      caller: 'inferJourneyWithAI',
      tenantId,
    });
    const text = String(response?.text || '').trim();
    const match = text.match(/```(?:json)?\s*([\s\S]+?)```/) || text.match(/(\{[\s\S]*\})/);
    const parsed = JSON.parse((match?.[1] || match?.[0] || text).trim());
    const journeyId = String(parsed?.journeyId || '').trim();
    const definition = getJourneyDefinition(registry, { vertical, journeyId });
    if (!definition) {
      throw new Error(`Jornada retornada pela IA nao reconhecida: ${journeyId || '<vazia>'}`);
    }

    logger.info('[QA_JOURNEY_AI] Jornada inferida por IA', {
      tenantId,
      vertical,
      journeyId: definition.journeyId,
      stepCount: definition.steps.length,
    });

    return {
      journeyId: definition.journeyId,
      steps: definition.steps,
      journeySource: 'ai',
      baseTemplateId: getBaseTemplate(registry, input.baseTemplateId).id,
      vertical,
    };
  } catch (error) {
    logger.error('[QA_JOURNEY_AI] Falha na inferencia por IA', {
      tenantId,
      vertical,
      error: error.message,
    });
    const aiError = new Error(error.message);
    aiError.code = 'AI_UNAVAILABLE';
    aiError.cause = error;
    throw aiError;
  }
}

async function inferJourney(input = {}) {
  if (input.journeyId || input.journey) {
    const resolved = resolveJourneyFromRegistry({ ...input, journeySource: input.journeySource || 'manual' });
    if (!resolved) {
      const notFound = new Error(
        `[journeyInferenceService] Jornada explicita nao encontrada no registry: ${input.journeyId || input.journey}`,
      );
      notFound.code = 'JOURNEY_NOT_FOUND';
      throw notFound;
    }
    return resolved;
  }

  // Sem journeyId explicito a escolha da jornada e inferencia semantica:
  // sempre via IA (sem fallback heuristico por tokens).
  return inferJourneyWithAI(input);
}

module.exports = {
  inferJourney,
  inferJourneyWithAI,
  resolveJourneyFromRegistry,
  readRegistry,
  getJourneyDefinition,
  getBaseTemplate,
};