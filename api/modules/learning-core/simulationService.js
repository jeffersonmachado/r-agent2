'use strict';

/**
 * Learning Core — Simulation Service (Fase 3).
 *
 * Orquestra a geração de simulações: núcleo puro
 * (src/core/learning/simulation-engine) monta o cenário-base determinístico
 * (jornada × seedType × persona sintética — nunca dados reais) e a IA
 * enriquece objetivo/variações (AI-first). IA indisponível → cenário-base
 * permanece válido e `aiEnrichment` fica null com log explícito.
 *
 * Execução via engine/simulator.js fica para quando a jornada tiver um flow
 * compilado associado (v1: status 'generated' — cenário auditável).
 */

const simulationEngine = require('../../../src/core/learning/simulation-engine');
const { generateAiResponse } = require('../../services/aiProviderService');
const getLearningSimulationModel = require('../../db/models/LearningSimulation');
const logger = require('../../utils/logger');

async function enrichScenarioWithAi({ tenantId, scenario }) {
  const prompt = [
    'Voce e um designer de treinamentos operacionais.',
    'Dado o cenario de simulacao abaixo, escreva em portugues, em ate 4 frases:',
    '1) o objetivo de aprendizado do exercicio e 2) duas variacoes de entrada',
    'que tornem o exercicio mais realista (sem usar dados reais).',
    `Cenario: jornada=${scenario.journeyKey}, seedType=${scenario.seedType},`,
    `persona=${scenario.persona.nome}, passos=${scenario.steps.length},`,
    `falhaEsperada=${scenario.falhaEsperada}`,
  ].join('\n');

  try {
    const result = await generateAiResponse(prompt, tenantId, {
      caller: 'learning-core-simulation',
      source: 'learning-core',
    });
    const text = result && typeof result.text === 'string' ? result.text.trim() : null;
    if (!text) {
      logger.warn('[learning-core] IA sem resposta para enriquecer simulacao (ai_unavailable)', { tenantId });
      return null;
    }
    return { objetivoEVariacoes: text.slice(0, 1500) };
  } catch (error) {
    logger.warn('[learning-core] IA indisponivel para enriquecer simulacao (ai_unavailable)', {
      tenantId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Gera e persiste uma simulação.
 *
 * @returns {Promise<object>} registro persistido (plain)
 */
async function generateSimulation({ tenantId, journeyKey, seedType, personaKey, stepsTemplate, createdBy }) {
  const scenario = simulationEngine.buildSimulationScenario({
    journeyKey,
    seedType,
    personaKey,
    stepsTemplate,
  });

  const aiEnrichment = await enrichScenarioWithAi({ tenantId, scenario });

  const Model = getLearningSimulationModel();
  const record = await Model.create({
    tenant_id: String(tenantId),
    journeyKey,
    seedType,
    personaKey,
    scenario,
    aiEnrichment,
    status: 'generated',
    createdBy: createdBy ? String(createdBy) : null,
  });

  logger.info('[learning-core] Simulacao gerada', {
    tenantId,
    journeyKey,
    seedType,
    personaKey,
    aiEnriched: Boolean(aiEnrichment),
  });

  return record.toJSON ? record.toJSON() : record;
}

async function listSimulations({ tenantId, limit = 50 }) {
  const Model = getLearningSimulationModel();
  const rows = await Model.findAll({
    where: { tenant_id: String(tenantId) },
    order: [['created_at', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
  });
  return rows.map((row) => {
    const plain = row.toJSON ? row.toJSON() : row;
    return {
      id: plain.id,
      journeyKey: plain.journeyKey,
      seedType: plain.seedType,
      personaKey: plain.personaKey,
      status: plain.status,
      descricao: plain.scenario && plain.scenario.descricao,
      steps: plain.scenario && Array.isArray(plain.scenario.steps) ? plain.scenario.steps.length : 0,
      aiEnriched: Boolean(plain.aiEnrichment),
      createdAt: plain.createdAt,
    };
  });
}

module.exports = {
  generateSimulation,
  listSimulations,
  SEED_TYPES: simulationEngine.SEED_TYPES,
  PERSONAS: simulationEngine.PERSONAS,
};
