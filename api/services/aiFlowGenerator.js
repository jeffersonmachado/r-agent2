/**
 * Módulo reutilizável: geração de fluxo por IA (chatbot).
 *
 * Objetivo:
 * - Ser importável por API, scripts e testes
 * - Centralizar a geração (inclui contexto RAG/scraping via flowGeneratorService)
 * - Retornar formato padronizado com validationWarnings + envelope
 *
 * Observação:
 * - Este módulo NÃO persiste automaticamente.
 */

const logger = require('../utils/logger');
const { validateFlow } = require('../../engine/validator');
const { buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../../engine/ai/aiEnvelope');
const { generateFlowFromDescription: generateFlowDefinitionFromDescription } = require('./flowGeneratorService');

function toValidationWarnings(flowValidation) {
  const valid = flowValidation?.valid === true;
  const errors = Array.isArray(flowValidation?.errors) ? flowValidation.errors : [];
  return {
    valid,
    errors: valid ? [] : errors,
    codes: valid ? [] : errors.map((e) => e && e.code).filter(Boolean),
  };
}

/**
 * Gera fluxo por IA a partir de descrição.
 *
 * @param {string} description
 * @param {object} options
 * @returns {Promise<{
 *   success: boolean,
 *   flowDefinition?: any,
 *   validationWarnings?: { valid: boolean, errors: any[], codes: string[] },
 *   envelope?: any,
 *   ragUsed?: boolean,
 *   ragExecutionId?: string|null,
 *   ragSources?: string[],
 *   metadata?: any,
 * }>}
 */
async function generateFlowFromDescription(description, options = {}) {
  const tenantId = options?.tenantId || null;

  const flow = await generateFlowDefinitionFromDescription(description, options);
  const flowValidation = validateFlow(flow);
  const validationWarnings = toValidationWarnings(flowValidation);

  // Best-effort: informações de RAG para observabilidade
  const ragExecutionId =
    options?.ragContext?.executionId ||
    options?.executionId ||
    null;
  const ragSources = Array.isArray(options?.ragSources) ? options.ragSources : [];
  const ragUsed = options?.useRag === true;

  const envelope = (() => {
    try {
      return validateAiEnvelopeOrThrow(buildAiEnvelope(
        'chatbot_flow',
        flow,
        {
          valid: validationWarnings.valid,
          errors: validationWarnings.errors,
          warnings: [],
          qualityScore: validationWarnings.valid ? 100 : 0,
          riskFlags: [],
        },
        {
          provider: { name: null, model: null, temperature: null },
          input: {
            prompt_summary: 'chatbot.generator.prompt.md',
            user_goal: typeof description === 'string' ? description.slice(0, 4000) : null,
            context: {
              tenantId,
              useRag: options?.useRag === true,
              ragSources,
              useWebScraping: options?.useWebScraping === true,
              scrapingTargetsCount: Array.isArray(options?.scrapingTargets) ? options.scrapingTargets.length : 0,
            },
          },
          audit: {
            request_id: null,
            seed: null,
            tenant_id: tenantId,
            user_id: null,
          },
        }
      ));
    } catch (err) {
      logger.debug('[aiFlowGenerator] Falha ao construir envelope (best-effort)', {
        error: err?.message || String(err),
      });
      return null;
    }
  })();

  // Propaga score (best-effort) para o metadata do fluxo, para o frontend exibir após reload.
  // Mantém compatibilidade caso o envelope não exista.
  try {
    const qualityScore = envelope?.validation?.qualityScore;
    if (typeof qualityScore === 'number' && Number.isFinite(qualityScore)) {
      flow.metadata = flow.metadata || {};
      flow.metadata.aiGeneration = flow.metadata.aiGeneration || {};
      flow.metadata.aiGeneration.qualityScore = qualityScore;
    }
  } catch (_) {}

  return {
    success: true,
    flowDefinition: flow,
    validationWarnings,
    envelope,
    ragUsed,
    ragExecutionId,
    ragSources,
    metadata: {
      generatedAt: new Date().toISOString(),
      module: 'api/services/aiFlowGenerator',
    },
  };
}

module.exports = {
  generateFlowFromDescription,
};

