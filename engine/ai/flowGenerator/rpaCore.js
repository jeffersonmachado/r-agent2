const envPort = require('../../shared/runtimeEnv');
const clock = require('../../shared/clock');
const path = require('path');
const { loadPromptFile, safeJsonParse, toValidationWarnings, defaultLogger } = require('./utils');

const DEFAULT_PROMPT_PATH = path.resolve(envPort.cwd(), 'prompts/rpa.generator.prompt.md');

/**
 * Core injetável: gera um plano/teste RPA a partir de descrição.
 *
 * Dependências (deps):
 * - callModel(prompt, meta) -> { text, usage? } | string
 * - validateGeneratedPlan(plan, 'rpa') -> { valid, errors, warnings, qualityScore, riskFlags }
 * - validateByContract(schemaPath, data) -> { valid, errors }
 * - buildAiEnvelope(domain, data, validationResult, meta) -> any
 * - validateAiEnvelopeOrThrow(envelope) -> any
 */
async function generateRpaTestCore({ description, tenantId, options = {}, deps = {} }) {
  const logger = deps.logger || defaultLogger();
  if (!description || typeof description !== 'string' || description.trim() === '') {
    throw new Error('description é obrigatório');
  }
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId é obrigatório');
  }

  const prompt = deps.loadPrompt
    ? await deps.loadPrompt('rpa_test')
    : loadPromptFile(DEFAULT_PROMPT_PATH, { logger });

  const finalPrompt = [
    prompt,
    '',
    '## Descrição do Usuário',
    description.trim(),
  ].join('\n');

  const callModel = deps.callModel || (async () => {
    // fallback determinístico mínimo (para testes/uso sem provider)
    return JSON.stringify({
      id: `test-${clock.nowMs()}`,
      name: 'IA - Teste RPA (fallback)',
      version: '1.0',
      type: 'rpa_test_plan',
      metadata: { generatedBy: 'ai', status: 'draft', requiresReview: true },
      context: { application: 'chatbot', mode: 'test-only' },
      steps: [{ action: 'navigate', target: 'http://localhost:3000', value: '', timeout: 15000 }],
      assertions: [{ type: 'visible', selector: 'body', value: 'true' }],
    });
  });

  const modelRes = await callModel(finalPrompt, {
    tenantId,
    domain: 'rpa_test',
    promptSummary: 'rpa.generator.prompt.md',
  });
  const text = typeof modelRes === 'string' ? modelRes : (modelRes?.text || '');

  const plan = safeJsonParse(text);

  const gate = deps.validateGeneratedPlan
    ? await deps.validateGeneratedPlan(plan, 'rpa')
    : { valid: true, errors: [], warnings: [], qualityScore: 100, riskFlags: [] };

  const contract = deps.validateByContract
    ? await deps.validateByContract('api/data/rag/rpa/rpa.schema.json', plan)
    : { valid: true, errors: [] };

  const validation = {
    valid: gate.valid === true && contract.valid === true,
    errors: [
      ...(Array.isArray(gate.errors) ? gate.errors : []),
      ...(contract.valid ? [] : [{
        type: 'AJV_CONTRACT_VALIDATION_FAILED',
        message: 'Plano RPA não passou no contrato AJV',
        details: contract.errors || [],
      }]),
    ],
    warnings: Array.isArray(gate.warnings) ? gate.warnings : [],
    qualityScore: typeof gate.qualityScore === 'number' ? gate.qualityScore : (gate.valid ? 100 : 0),
    riskFlags: Array.isArray(gate.riskFlags) ? gate.riskFlags : [],
  };

  const validationWarnings = toValidationWarnings(validation);
  const aiMeta = options?._aiMeta || {};
  const envelope = (() => {
    try {
      if (!deps.buildAiEnvelope || !deps.validateAiEnvelopeOrThrow) return null;
      return deps.validateAiEnvelopeOrThrow(deps.buildAiEnvelope(
        'rpa_test',
        plan,
        validation,
        aiMeta
      ));
    } catch (err) {
      logger.debug?.('[rpaTestCore] envelope falhou (best-effort)', { error: err.message });
      return null;
    }
  })();

  return {
    success: validation.valid === true,
    rpaTest: plan,
    validation,
    validationWarnings,
    envelope,
  };
}

module.exports = {
  generateRpaTestCore,
};

