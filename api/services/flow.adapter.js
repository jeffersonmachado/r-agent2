function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

const KNOWLEDGE_NOT_FOUND_RESPONSE = 'Não encontrei essa informação na base de conhecimento do r-agent2.';

const STOPWORDS_PT = new Set([
  'a','o','os','as','um','uma','uns','umas',
  'de','do','da','dos','das','no','na','nos','nas',
  'e','ou','para','por','com','sem','sobre','em',
  'que','qual','quais','como','onde','quando','quanto','quantos','porquê','porque',
  'eu','me','minha','meu','meus','minhas','você','vocês','seu','sua','seus','suas',
  'é','ser','estar','tem','tenho','têm','há',
]);

function extractKeywordsFromExamples(examples, maxKeywords = 10) {
  const tokens = [];
  for (const ex of Array.isArray(examples) ? examples : []) {
    const t = safeString(ex)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => x.length >= 4)
      .filter((x) => !STOPWORDS_PT.has(x));
    tokens.push(...t);
    if (tokens.length > 200) break;
  }
  const uniq = [];
  const seen = new Set();
  for (const tok of tokens) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    uniq.push(tok);
    if (uniq.length >= maxKeywords) break;
  }
  return uniq;
}

/**
 * Constrói um fluxo inicial EXECUTÁVEL usando apenas tipos de nó existentes.
 *
 * Estratégia (sem loops, para passar validação):
 * start -> message(greeting) -> user_input -> ai_task(intent_classification) -> router -> message(answer) -> end
 * router.always -> message(fallback) -> end
 *
 * @param {Array<{id:string,question:string,examples:string[],answer:string}>} intents
 * @param {{ tenantId: string, flowId?: string, name?: string }} options
 * @returns {import('../../engine/flowTypes').FlowDefinition}
 */
function buildInitialFlowFromIntents(intents, options = {}) {
  const tenantId = safeString(options.tenantId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório para montar o fluxo');

  const items = (Array.isArray(intents) ? intents : [])
    .map((it) => ({
      id: safeString(it?.id).trim(),
      question: safeString(it?.question).trim(),
      examples: Array.isArray(it?.examples) ? it.examples.map((e) => safeString(e).trim()).filter(Boolean).slice(0, 5) : [],
      answer: safeString(it?.answer).trim(),
    }))
    .filter((it) => it.id)
    .slice(0, 40);

  const flowId = safeString(options.flowId).trim() || `auto-flow-${Date.now()}`;
  const flowName = safeString(options.name).trim() || 'Fluxo inicial (auto)';

  // IDs estáveis (string)
  const START = '1';
  const GREETING = '2';
  const USER_INPUT = '3';
  const AI_TASK = '4';
  const ROUTER = '5';

  let nextId = 6;
  const alloc = () => String(nextId++);

  const END = alloc();
  const FALLBACK = alloc();

  // Nós de resposta por intent
  const answerNodeByIntentId = new Map();
  for (const it of items) {
    answerNodeByIntentId.set(it.id, alloc());
  }

  // keywords map para ai_task (determinístico)
  const keywordMap = {};
  for (const it of items) {
    const kws = extractKeywordsFromExamples([it.question, ...(it.examples || [])], 10);
    if (kws.length > 0) keywordMap[it.id] = kws;
  }

  // Router rules
  const routerVar = `ai.${AI_TASK}.value`;
  const rules = items.map((it) => ({
    condition: { op: 'equals', var: routerVar, value: it.id },
    next: answerNodeByIntentId.get(it.id),
  }));
  // Fallback obrigatório (no router -> nó fallback)
  rules.push({
    condition: { op: 'always' },
    next: FALLBACK,
  });

  /** @type {import('../../engine/flowTypes').FlowNode[]} */
  const nodes = [
    {
      id: START,
      type: 'start',
      config: {},
      next: GREETING,
    },
    {
      id: GREETING,
      type: 'message',
      config: { text: 'Olá! Como posso ajudar?' },
      next: USER_INPUT,
    },
    {
      id: USER_INPUT,
      type: 'user_input',
      config: { variable: 'user_input' },
      next: AI_TASK,
    },
    {
      id: AI_TASK,
      type: 'ai_task',
      config: {
        task: 'intent_classification',
        allowedOutputs: items.map((it) => it.id),
        fallback: 'desconhecido',
        confidenceThreshold: 0.75,
        keywords: keywordMap,
      },
      next: ROUTER,
    },
    {
      id: ROUTER,
      type: 'router',
      config: { rules },
      next: FALLBACK, // defaultNext (extra segurança)
    },
    // fallback (nó dedicado)
    // Importante: o validador do editor exige pelo menos um nó do tipo "fallback".
  // Também mantemos o fluxo acíclico e simples; quando precisar convergir caminhos, use `merge`
  // (múltiplas entradas são permitidas em `end`, `handoff` e `merge`).
    {
      id: FALLBACK,
      type: 'fallback',
      config: {
        maxAttempts: 3,
        confidenceThreshold: 0.75,
        enableEmotionCheck: true,
        escalationMode: 'ticket',
        allowReturnToBot: true,
        safeReturnNode: null,
      },
      next: {
        retry: END,
        options: END,
        human: END,
        end: END,
      },
    },
    // end
    {
      id: END,
      type: 'end',
      config: {},
      next: null,
    },
  ];

  // Answers
  for (const it of items) {
    const nodeId = answerNodeByIntentId.get(it.id);
    nodes.push({
      id: nodeId,
      type: 'message',
      // Inclui pergunta/exemplos/resposta no nó (conforme requisito) sem criar tipo novo
      config: {
        text: it.answer || KNOWLEDGE_NOT_FOUND_RESPONSE,
        intentId: it.id,
        question: it.question,
        examples: it.examples,
      },
      next: END,
    });
  }

  // Layout (metadata.positions) para o editor
  const positions = {};
  positions[START] = [0, 0];
  positions[GREETING] = [260, 0];
  positions[USER_INPUT] = [520, 0];
  positions[AI_TASK] = [780, 0];
  positions[ROUTER] = [1040, 0];
  positions[FALLBACK] = [1040, 200];
  positions[END] = [1300, 0];
  let row = 0;
  for (const it of items) {
    const nodeId = answerNodeByIntentId.get(it.id);
    positions[nodeId] = [1300, 80 + row * 140];
    row += 1;
  }

  return {
    tenantId,
    id: flowId,
    name: flowName,
    version: 1,
    nodes,
    metadata: {
      generatedBy: 'ai',
      generated: true,
      status: 'draft',
      requiresReview: true,
      positions,
      intentsCount: items.length,
    },
  };
}

module.exports = {
  buildInitialFlowFromIntents,
};
