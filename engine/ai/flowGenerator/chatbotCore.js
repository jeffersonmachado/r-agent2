const envPort = require('../../shared/runtimeEnv');
const clock = require('../../shared/clock');
const path = require('path');
const { loadPromptFile, safeJsonParse, toValidationWarnings, defaultLogger } = require('./utils');
const { normalizeFlow } = require('../../flowNormalizer');

const DEFAULT_PROMPT_PATH = path.resolve(envPort.cwd(), 'prompts/chatbot.generator.prompt.md');

/**
 * Core injetável: gera FlowDefinition (chatbot) a partir de descrição.
 *
 * Dependências (deps):
 * - callModel(prompt, meta) -> { text, usage? } | string
 * - validateGeneratedPlan(plan, 'chatbot') -> { valid, errors, warnings, qualityScore, riskFlags }
 * - validateByContract(schemaPath, data) -> { valid, errors }
 * - buildAiEnvelope(domain, data, validationResult, meta) -> any
 * - validateAiEnvelopeOrThrow(envelope) -> any
 * - validateFlow(flowDefinition) -> { valid, errors }
 * - validateFlowDraft(flowDefinition) -> void (lança FLOW_* quando inválido)
 * - buildKnowledgeContext?(description, options) -> { text, ragUsed, ragExecutionId, ragSources }
 *
 * Observação:
 * - Este core não persiste nada e não importa módulos da API.
 */
async function generateChatbotFlowCore({ description, tenantId, options = {}, deps = {} }) {
  const logger = deps.logger || defaultLogger();
  if (!description || typeof description !== 'string' || description.trim() === '') {
    throw new Error('description é obrigatório');
  }
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId é obrigatório');
  }

  const prompt = deps.loadPrompt
    ? await deps.loadPrompt('chatbot_flow')
    : loadPromptFile(DEFAULT_PROMPT_PATH, { logger });

  const knowledge = deps.buildKnowledgeContext
    ? await deps.buildKnowledgeContext(description, options)
    : { text: '', ragUsed: false, ragExecutionId: null, ragSources: [] };

  const finalPrompt = [
    '## Indicador de Prompt',
    'summarized=false',
    'reason=NONE',
    '',
    prompt,
    '',
    knowledge?.text ? String(knowledge.text).trim() : '',
    '',
    '## Descrição do Usuário',
    description.trim(),
  ].filter(Boolean).join('\n');

  const callModel = deps.callModel || (async () => {
    // fallback determinístico mínimo (para testes/uso sem provider)
    return JSON.stringify({
      action: 'create_flow',
      metadata: { name: 'Fluxo Gerado', description: 'Fluxo gerado (fallback)' },
      nodes: [
        { id: 'start', type: 'start', next: 'end' },
        { id: 'end', type: 'end' },
      ],
      edges: [],
    });
  });

  const modelRes = await callModel(finalPrompt, {
    tenantId,
    domain: 'chatbot_flow',
    promptSummary: 'chatbot.generator.prompt.md',
  });
  const text = typeof modelRes === 'string' ? modelRes : (modelRes?.text || '');

  const parsed = safeJsonParse(text);
  const plan = (parsed && typeof parsed === 'object') ? parsed : {};

  // Esperado do prompt: wrapper com { action, metadata, nodes, edges? }
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const flowDefinition = {
    tenantId,
    id: options.flowId || options.id || `flow-${clock.nowMs()}`,
    name: (plan.metadata && plan.metadata.name) || options.flowName || options.name || 'Fluxo Gerado',
    version: 1,
    nodes,
    metadata: {
      ...(plan.metadata && typeof plan.metadata === 'object' ? plan.metadata : {}),
      generatedBy: 'ai',
      status: 'draft',
      requiresReview: true,
      generatedAt: clock.nowIso(),
    },
  };

  // ------------------------------------------------------------
  // FlowPreValidator (hard fail) — DEPOIS do LLM e ANTES do normalizer.
  // O normalizer NÃO deve receber fluxos com ciclos / fan-in proibido / reuso indevido.
  // ------------------------------------------------------------
  if (typeof deps.validateFlowDraft !== 'function') {
    throw new Error('deps.validateFlowDraft é obrigatório para geração de chatbot (FlowPreValidator).');
  }
  deps.validateFlowDraft(flowDefinition);

  // Normalização determinística pós-IA (STRICT).
  // Regra: não remenda; se detectar problema estrutural, lança erro.
  const normalizedFlowDefinition = normalizeFlow(flowDefinition);

  // ------------------------------------------------------------
  // FlowPreValidator (hard fail) — DEPOIS do normalizer (assert defensivo).
  // ------------------------------------------------------------
  deps.validateFlowDraft(normalizedFlowDefinition);

  // Gate/contract/validator: injetáveis
  const gate = deps.validateGeneratedPlan
    // Importante: o gate de chatbot valida um "fluxo" completo (com id/tenantId),
    // não apenas o wrapper bruto retornado pela IA ({ action, metadata, nodes, ... }).
    // Passar o wrapper causa erros como INVALID_FLOW_ID.
    ? await deps.validateGeneratedPlan(normalizedFlowDefinition, 'chatbot')
    : { valid: true, errors: [], warnings: [], qualityScore: 100, riskFlags: [] };

  const contract = deps.validateByContract
    ? await deps.validateByContract('api/data/rag/chatbot/schema/flow.schema.json', normalizedFlowDefinition)
    : { valid: true, errors: [] };

  const engineValidation = deps.validateFlow
    ? await deps.validateFlow(normalizedFlowDefinition)
    : { valid: true, errors: [] };

  const validation = {
    valid: gate.valid === true && contract.valid === true && engineValidation.valid === true,
    errors: [
      ...(Array.isArray(gate.errors) ? gate.errors : []),
      ...(contract.valid ? [] : [{
        type: 'AJV_CONTRACT_VALIDATION_FAILED',
        message: 'FlowDefinition não passou no contrato AJV',
        details: contract.errors || [],
      }]),
      ...(engineValidation.valid ? [] : (engineValidation.errors || [])),
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
        'chatbot_flow',
        flowDefinition,
        validation,
        aiMeta
      ));
    } catch (err) {
      logger.debug?.('[chatbotFlowCore] envelope falhou (best-effort)', { error: err.message });
      return null;
    }
  })();

  return {
    success: validation.valid === true,
    flowDefinition: normalizedFlowDefinition,
    validation,
    validationWarnings,
    envelope,
    ragUsed: knowledge?.ragUsed === true,
    ragExecutionId: knowledge?.ragExecutionId || null,
    ragSources: Array.isArray(knowledge?.ragSources) ? knowledge.ragSources : [],
  };
}

module.exports = {
  generateChatbotFlowCore,
};

