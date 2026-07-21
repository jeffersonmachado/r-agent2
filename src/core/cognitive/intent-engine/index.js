'use strict';

/**
 * Intent Engine do Cognitive Core.
 *
 * Identifica a intenção de negócio de uma mensagem/evento.
 *
 * Ordem de decisão:
 *  1. Regras determinísticas (keywords/regex pt-BR) — sempre primeiro
 *  2. LLM opcional (aiProviderService) quando as regras não decidem
 *  3. Fallback seguro: baixa confiança → transferir_humano (handoff)
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

/**
 * Regras determinísticas. Avaliadas em ordem; padrões mais específicos primeiro.
 * `strong` decide sozinho (confiança alta); `weak` soma evidência.
 */
const RULES = [
  {
    intent: 'remarcar_agendamento',
    strong: [/\b(remarcar|reagendar|mudar (o |a )?(hor[aá]rio|data)|trocar (o )?hor[aá]rio|adiar (a |o )?(consulta|agendamento|hor[aá]rio|reuni[aã]o))\b/i],
    weak: [/\bagendamento\b/i, /\bhor[aá]rio\b/i],
  },
  {
    intent: 'cancelar_agendamento',
    strong: [/\b(cancelar|desmarcar)\b.*\b(consulta|agendamento|hor[aá]rio|reuni[aã]o|sess[aã]o)\b/i, /\bn[aã]o vou (poder )?(comparecer|ir)\b/i],
    weak: [/\bcancelar\b/i, /\bdesmarcar\b/i],
  },
  {
    intent: 'agendar',
    strong: [/\b(agendar|marcar)\b.*\b(consulta|hor[aá]rio|avalia[cç][aã]o|reuni[aã]o|sess[aã]o|visita)\b/i, /\bquero (marcar|agendar)\b/i],
    weak: [/\bagenda\b/i, /\bdispon[ií]vel\b/i, /\bvaga\b/i],
  },
  {
    intent: 'transferir_humano',
    strong: [/\b(falar|conversar) com (um |uma )?(humano|atendente|pessoa|gerente|respons[aá]vel)\b/i, /\batendimento humano\b/i],
    weak: [/\bhumano\b/i, /\batendente\b/i],
  },
  {
    intent: 'abrir_ticket',
    strong: [/\b(abrir|registrar) (um |uma )?(chamado|ticket|reclama[cç][aã]o|ocorr[eê]ncia)\b/i, /\b(problema|defeito|erro|reclama[cç][aã]o)\b.*\b(produto|servi[cç]o|sistema|pedido)\b/i],
    weak: [/\bproblema\b/i, /\bn[aã]o funciona\b/i, /\bsuporte\b/i],
  },
  {
    intent: 'enviar_proposta',
    strong: [/\b(enviar?|mandar?|quero|preciso de) (a |uma )?(proposta|or[cç]amento|cota[cç][aã]o)\b/i],
    weak: [/\bproposta\b/i, /\bor[cç]amento\b/i, /\bpre[cç]o\b/i, /\bquanto custa\b/i],
  },
  {
    intent: 'iniciar_campanha',
    strong: [/\b(iniciar|lan[cç]ar|disparar|criar) (a |uma )?campanha\b/i],
    weak: [/\bcampanha\b/i, /\bdisparo\b/i],
  },
  {
    intent: 'consultar_metricas',
    strong: [/\b(relat[oó]rio|m[eé]tricas|indicadores|kpis?|dashboard)\b/i, /\bcomo (est[aã]o|anda[m]?) (as vendas|os n[uú]meros|os resultados)\b/i],
    weak: [/\bresultados\b/i, /\bn[uú]meros\b/i],
  },
  {
    intent: 'consultar_status',
    strong: [/\b(status|andamento|situa[cç][aã]o) (do |da |de )?(meu |minha )?(pedido|chamado|ticket|solicita[cç][aã]o|atendimento|proposta)\b/i, /\bcad[eê] (meu|minha)\b/i],
    weak: [/\bstatus\b/i, /\bandamento\b/i],
  },
  {
    intent: 'qualificar_lead',
    strong: [/\b(qualificar|pontuar|score) (o |do )?lead\b/i],
    weak: [/\bqualifica[cç][aã]o\b/i],
  },
  {
    intent: 'criar_lead',
    strong: [/\b(cadastrar|criar|registrar|adicionar) (um |uma |o |a )?(lead|prospecto|contato|cliente)\b/i, /\btenho interesse\b/i, /\bquero (saber )?mais informa[cç][oõ]es\b/i],
    weak: [/\binteresse\b/i, /\bnovo cliente\b/i],
  },
];

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

function classifyByRules(message) {
  const text = String(message || '');
  if (!text.trim()) return null;

  let best = null;
  for (const rule of RULES) {
    const strongHit = rule.strong.find((p) => p.test(text));
    if (strongHit) {
      return {
        intent: rule.intent,
        confidence: 0.92,
        source: 'rules',
        rationale: `regra determinística forte: ${strongHit}`,
      };
    }
    const weakHits = (rule.weak || []).filter((p) => p.test(text));
    if (weakHits.length > 0) {
      const confidence = Math.min(0.4 + weakHits.length * 0.12, 0.7);
      if (!best || confidence > best.confidence) {
        best = {
          intent: rule.intent,
          confidence,
          source: 'rules',
          rationale: `regras fracas (${weakHits.length}): ${weakHits.join(' | ')}`,
        };
      }
    }
  }
  return best;
}

function buildLlmPrompt(message) {
  return [
    'Classifique a intenção da mensagem abaixo em UMA das categorias:',
    INTENTS.join(', '),
    '',
    'Responda APENAS com JSON: {"intent": "<categoria>", "confidence": <0..1>}',
    'Se nenhuma categoria couber com segurança, use "transferir_humano" com confidence baixa.',
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

    // 1) Regras determinísticas
    let result = classifyByRules(message);

    // 2) LLM opcional quando regras não decidem com confiança suficiente
    if ((!result || result.confidence < confidenceThreshold) && llmEnabled) {
      try {
        const generate = generateAiResponse
          || require('../../../../api/services/aiProviderService').generateAiResponse;
        const ai = await generate(buildLlmPrompt(message), trimmedTenant, { caller: 'cognitive-intent-engine' });
        const parsed = parseLlmResponse(ai?.text);
        if (parsed && (!result || parsed.confidence > result.confidence)) {
          result = {
            intent: parsed.intent,
            confidence: parsed.confidence,
            source: 'llm',
            rationale: 'classificação LLM (regras determinísticas inconclusivas)',
          };
        }
      } catch (error) {
        log.warn('[CognitiveIntentEngine] LLM classification failed (fallback to rules)', {
          tenantId: trimmedTenant,
          error: error.message,
        });
      }
    }

    // 3) Fallback seguro: baixa confiança → handoff humano
    if (!result || result.confidence < confidenceThreshold) {
      return {
        intent: 'transferir_humano',
        confidence: result ? result.confidence : 0,
        entities,
        source: 'fallback',
        rationale: result
          ? `confiança ${result.confidence.toFixed(2)} abaixo do limiar ${confidenceThreshold} (melhor candidato: ${result.intent}) → handoff humano`
          : 'nenhuma regra ou LLM classificou a mensagem → handoff humano',
        fallback: true,
        humanHandoff: true,
      };
    }

    return {
      ...result,
      entities,
      fallback: false,
      humanHandoff: result.intent === 'transferir_humano',
    };
  }

  return { classify };
}

module.exports = { createIntentEngine, INTENTS, CONFIDENCE_THRESHOLD, _internal: { classifyByRules, extractEntities, parseLlmResponse } };
