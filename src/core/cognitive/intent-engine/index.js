'use strict';

/**
 * Intent Engine do Cognitive Core.
 *
 * Identifica a intenção de negócio de uma mensagem/evento.
 *
 * Contrato (AI-native, prioridade: atendimento e cobertura das necessidades
 * de negócio):
 *  1. Intent explícito no payload do evento — dado declarado, confiança 1.
 *  2. LLM (aiProviderService) — classificador único de intenção. O prompt
 *     instrui a IA a priorizar atendimento ao cliente e cobertura das
 *     necessidades de negócio dentro da taxonomia.
 *  3. Degradação segura (regra de negócio, NÃO heurística):
 *     - LLM indisponível/falha → `transferir_humano` (source 'ai_unavailable');
 *     - confiança abaixo do limiar ou intent fora da taxonomia →
 *       `transferir_humano` (source 'fallback').
 *
 * A classificação heurística por keywords/regex foi REMOVIDA: inferência de
 * intenção é responsabilidade exclusiva da IA. Entidades (telefone, e-mail,
 * data, hora) seguem com extração determinística — é parsing de dados
 * estruturados, não inferência semântica.
 *
 * Saída: { intent, confidence, entities, source, rationale }
 * A justificativa (`rationale`) é sempre registrada.
 */

const CONFIDENCE_THRESHOLD = 0.55;

const INTENTS = Object.freeze([
  'criar_lead',
  'qualificar_lead',
  'agendar',
  'remarcar_agendamento',
  'cancelar_agendamento',
  'consultar_status',
  'abrir_ticket',
  'transferir_humano',
  'enviar_proposta',
  'iniciar_campanha',
  'consultar_metricas',
]);

const ENTITY_EXTRACTORS = [
  { name: 'phone', pattern: /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/ },
  { name: 'email', pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  // Sem \b no fim: \b falha após caracteres acentuados (ex.: "amanhã").
  { name: 'date', pattern: /(?:^|[\s,.;])(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|depois de amanh[aã]|amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?=$|[\s,.;:!?])/i, group: 1 },
  { name: 'time', pattern: /\b([01]?\d|2[0-3])[:h]\s?([0-5]\d)?\b/ },
];

function extractEntities(message) {
  const entities = {};
  const text = String(message || '');
  for (const { name, pattern, group } of ENTITY_EXTRACTORS) {
    const match = text.match(pattern);
    if (match) entities[name] = String(match[group || 0]).trim();
  }
  return entities;
}

function buildLlmPrompt(message) {
  return [
    'Você é o classificador de intenção do núcleo cognitivo de uma plataforma de atendimento e operações de negócio.',
    'Prioridade máxima: atendimento ao cliente e cobertura das necessidades de negócio.',
    'Classifique a intenção da mensagem abaixo em UMA das categorias:',
    INTENTS.join(', '),
    '',
    'Responda APENAS com JSON: {"intent": "<categoria>", "confidence": <0..1>}',
    'Se nenhuma categoria couber com segurança, use "transferir_humano" com confidence baixa.',
    'Em caso de dúvida entre uma ação de negócio e atendimento humano, prefira "transferir_humano".',
    '',
    `Mensagem: ${String(message || '').slice(0, 1000)}`,
  ].join('\n');
}

function parseLlmResponse(text) {
  try {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!INTENTS.includes(parsed.intent)) return null;
    const confidence = Number(parsed.confidence);
    return {
      intent: parsed.intent,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    };
  } catch (_) {
    return null;
  }
}

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

/**
 * @param {object} [options]
 * @param {Function} [options.generateAiResponse] injeção para testes; default aiProviderService
 * @param {boolean} [options.llmEnabled] default true
 * @param {number} [options.confidenceThreshold]
 */
function createIntentEngine({ generateAiResponse, llmEnabled = true, confidenceThreshold = CONFIDENCE_THRESHOLD, logger } = {}) {
  const log = logger || defaultLogger();

  function buildHandoff({ entities, source, rationale, confidence = 0 }) {
    return {
      intent: 'transferir_humano',
      confidence,
      entities,
      source,
      rationale,
      fallback: true,
      humanHandoff: true,
    };
  }

  async function classify({ tenantId, message, eventType, payload } = {}) {
    const trimmedTenant = String(tenantId || '').trim();
    if (!trimmedTenant) throw new Error('cognitive_intent_tenant_required');

    const entities = extractEntities(message);

    // Eventos estruturados podem carregar intent explícito (ex.: automações internas)
    if (payload && typeof payload.intent === 'string' && INTENTS.includes(payload.intent)) {
      return {
        intent: payload.intent,
        confidence: 1,
        entities: { ...entities, ...(payload.entities || {}) },
        source: 'explicit',
        rationale: `intent explícito no payload do evento ${eventType || 'unknown'}`,
        fallback: false,
        humanHandoff: payload.intent === 'transferir_humano',
      };
    }

    if (!llmEnabled) {
      return buildHandoff({
        entities,
        source: 'ai_disabled',
        rationale: 'classificação por IA desabilitada (llmEnabled=false) → handoff humano',
      });
    }

    // Classificação de intenção é inferência semântica: sempre via IA.
    let parsed = null;
    try {
      const generate = generateAiResponse
        || require('../../../../api/services/aiProviderService').generateAiResponse;
      const ai = await generate(buildLlmPrompt(message), trimmedTenant, { caller: 'cognitive-intent-engine' });
      parsed = parseLlmResponse(ai?.text);
    } catch (error) {
      log.error('[CognitiveIntentEngine] LLM classification failed → handoff humano (sem fallback heurístico)', {
        tenantId: trimmedTenant,
        error: error.message,
      });
      return buildHandoff({
        entities,
        source: 'ai_unavailable',
        rationale: `falha na classificação por IA (${error.message}) → handoff humano`,
      });
    }

    if (!parsed) {
      return buildHandoff({
        entities,
        source: 'fallback',
        rationale: 'IA não retornou intent válida na taxonomia → handoff humano',
      });
    }

    // Degradação segura: baixa confiança → handoff humano
    if (parsed.confidence < confidenceThreshold) {
      return buildHandoff({
        entities,
        source: 'fallback',
        confidence: parsed.confidence,
        rationale: `confiança ${parsed.confidence.toFixed(2)} abaixo do limiar ${confidenceThreshold} (melhor candidato: ${parsed.intent}) → handoff humano`,
      });
    }

    return {
      intent: parsed.intent,
      confidence: parsed.confidence,
      entities,
      source: 'llm',
      rationale: 'classificação LLM (IA-first, prioridade atendimento)',
      fallback: false,
      humanHandoff: parsed.intent === 'transferir_humano',
    };
  }

  return { classify };
}

module.exports = { createIntentEngine, INTENTS, CONFIDENCE_THRESHOLD, _internal: { extractEntities, parseLlmResponse } };
