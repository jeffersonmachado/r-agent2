/**
 * Adapters (API): conecta o core injetável em engine/ai/ ao runtime da API.
 *
 * Estes adapters são o único lugar que conhece:
 * - aiProviderService (chamada real ao provider)
 * - montagem de contexto RAG/scraping (quando necessário)
 * - envelope (aiEnvelope)
 */

const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');
const { generateAiResponse } = require('./aiProviderService');
const { validateFlow } = require('../../engine/validator');
const { validateGeneratedPlan } = require('../../engine/ai/validateGeneratedPlan');
const { validateByContract, buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../../engine/ai/aiEnvelope');
const { generateChatbotFlowCore, generateRpaTestCore } = require('../../engine/ai/flowGenerator');
const { buildDiverseRagContext } = require('./ragContextBuilder');
const { validateFlowDraft } = require('../utils/flowPreValidator');

const CHATBOT_PROMPT_PATH = path.resolve(process.cwd(), 'prompts/chatbot.generator.prompt.md');
const RPA_PROMPT_PATH = path.resolve(process.cwd(), 'prompts/rpa.generator.prompt.md');

const RAG_CHATBOT_SCHEMA_PATH = path.resolve(process.cwd(), 'api/data/rag/chatbot/schema/flow.schema.json');
const RAG_CHATBOT_NODE_TYPES_PATH = path.resolve(process.cwd(), 'api/data/rag/chatbot/nodes/node.types.json');
const RAG_CHATBOT_CONNECTION_RULES_PATH = path.resolve(process.cwd(), 'api/data/rag/chatbot/rules/connection.rules.json');

let cachedPromptChatbot = null;
let cachedPromptRpa = null;
let cachedRagChatbotBundle = null;

const PROMPT_SUMMARY_MARKER = 'PROMPT_SUMMARY_MODE=1';

function isProviderContextOverflowError(err) {
  if (!err) return false;
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();
  const type = String(err?.type || '').toLowerCase();
  const status = typeof err?.status === 'number' ? err.status : null;

  // OpenAI costuma sinalizar code/type.
  if (code === 'context_length_exceeded') return true;
  if (type.includes('context_length_exceeded')) return true;

  // Heurísticas (OpenAI/Claude): mensagens comuns quando o contexto excede.
  const patterns = [
    'context length',
    'maximum context',
    'max context',
    'too many tokens',
    'prompt too long',
    'exceeds the context',
    'exceeded the context',
    'input is too long',
  ];
  if (patterns.some((p) => msg.includes(p))) return true;

  // Alguns providers retornam 400 para este caso.
  if (status === 400 && patterns.some((p) => msg.includes(p))) return true;

  return false;
}

function extractRagBlockFromPrompt(prompt) {
  const raw = String(prompt || '');
  const ragStart = raw.indexOf('## Conhecimento Interno (RAG)');
  const userDesc = raw.indexOf('## Descrição do Usuário');
  if (ragStart < 0 || userDesc < 0) return null;
  if (ragStart >= userDesc) return null;

  return {
    before: raw.slice(0, ragStart).trimEnd(),
    rag: raw.slice(ragStart, userDesc).trim(),
    after: raw.slice(userDesc).trimStart(),
  };
}

function buildRagSummarizationPrompt(ragBlock, options = {}) {
  const maxChars = Number.isFinite(Number(options.maxChars)) ? Number(options.maxChars) : 45000;
  const maxLines = Number.isFinite(Number(options.maxLines)) ? Number(options.maxLines) : 60;
  const maxPerSection = Number.isFinite(Number(options.maxPerSection)) ? Number(options.maxPerSection) : 12;
  const raw = String(ragBlock || '');
  const clipped = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[TRUNCATED_INPUT_FOR_SUMMARY=true]` : raw;

  return [
    'Você é um sumarizador de contexto RAG.',
    '',
    'Tarefa:',
    '- Resuma o conteúdo abaixo em bullets curtos e estruturados.',
    '- Preserve números, preços, telefones, URLs, datas, horários e nomes próprios.',
    '- Remova redundância e ruído (ex.: OCR repetido), mas não perca fatos.',
    '',
    'Formato de saída (OBRIGATÓRIO):',
    `- Máximo ${maxLines} linhas.`,
    `- Use apenas bullets iniciando com "- " e, quando útil, subtítulos em bullets como "- [Serviços]"`,
    `- No máximo ${maxPerSection} bullets por seção.`,
    '- Não inclua markdown além de bullets simples.',
    '',
    'Conteúdo para resumir (entre delimitadores):',
    '-----BEGIN_RAG_CONTEXT-----',
    clipped,
    '-----END_RAG_CONTEXT-----',
  ].join('\n');
}

function buildPromptSummaryIndicator({ originalChars, summarizedChars }) {
  const safeN = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  return [
    '## Indicador de Prompt',
    PROMPT_SUMMARY_MARKER,
    'summarized=true',
    'reason=PROVIDER_CONTEXT_OVERFLOW',
    `originalPromptChars=${safeN(originalChars) ?? 'N/A'}`,
    `summarizedPromptChars=${safeN(summarizedChars) ?? 'N/A'}`,
  ].join('\n');
}

function buildPromptIndicatorDefault({ promptChars }) {
  const safeN = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  return [
    '## Indicador de Prompt',
    'summarized=false',
    'reason=NONE',
    `promptChars=${safeN(promptChars) ?? 'N/A'}`,
  ].join('\n');
}

function upsertPromptIndicator(promptText, { summarized, reason, originalPromptChars, summarizedPromptChars }) {
  const raw = String(promptText || '');
  const hasHeader = raw.includes('## Indicador de Prompt');
  const hasMarker = raw.includes(PROMPT_SUMMARY_MARKER);

  const indicator = summarized
    ? [
        '## Indicador de Prompt',
        PROMPT_SUMMARY_MARKER,
        'summarized=true',
        `reason=${reason || 'PROVIDER_CONTEXT_OVERFLOW'}`,
        `originalPromptChars=${typeof originalPromptChars === 'number' ? originalPromptChars : raw.length}`,
        `summarizedPromptChars=${typeof summarizedPromptChars === 'number' ? summarizedPromptChars : 'N/A'}`,
      ].join('\n')
    : buildPromptIndicatorDefault({ promptChars: raw.length });

  if (!hasHeader) {
    return `${indicator}\n\n${raw}`.trim();
  }

  // Substitui o bloco do indicador (do header até a próxima linha em branco).
  const replaced = raw.replace(
    /## Indicador de Prompt[\s\S]*?(?:\n\s*\n|$)/,
    `${indicator}\n\n`
  );

  // Se já existia marker, mantém; se não existia e summarized=true, o indicador já inclui.
  // Se existia marker mas summarized=false, removemos marker implicitamente via substituição do bloco.
  return replaced;
}

function minifyJsonText(rawJsonText, filenameForLog) {
  try {
    const obj = JSON.parse(String(rawJsonText || ''));
    return JSON.stringify(obj);
  } catch (err) {
    logger.warn('[aiWrappersAdapter] Falha ao minificar JSON (mantendo bruto)', {
      file: filenameForLog,
      error: err?.message || String(err),
    });
    return String(rawJsonText || '');
  }
}

function getRagChatbotBundleText() {
  if (cachedRagChatbotBundle) return cachedRagChatbotBundle;

  const schemaRaw = fs.readFileSync(RAG_CHATBOT_SCHEMA_PATH, 'utf8');
  const nodeTypesRaw = fs.readFileSync(RAG_CHATBOT_NODE_TYPES_PATH, 'utf8');
  const rulesRaw = fs.readFileSync(RAG_CHATBOT_CONNECTION_RULES_PATH, 'utf8');

  const schemaMin = minifyJsonText(schemaRaw, 'flow.schema.json');
  const nodeTypesMin = minifyJsonText(nodeTypesRaw, 'node.types.json');
  const rulesMin = minifyJsonText(rulesRaw, 'connection.rules.json');

  cachedRagChatbotBundle = [
    '## Designer Schema (RAG_CHATBOT)',
    'A seguir estão os artefatos do designer. Use-os como fonte da verdade para tipos, configs obrigatórias e regras de conexão.',
    '',
    '### flow.schema.json',
    schemaMin,
    '',
    '### node.types.json',
    nodeTypesMin,
    '',
    '### connection.rules.json',
    rulesMin,
    '',
  ].join('\n');

  return cachedRagChatbotBundle;
}

function loadPrompt(domain) {
  if (domain === 'rpa_test') {
    if (cachedPromptRpa) return cachedPromptRpa;
    cachedPromptRpa = fs.readFileSync(RPA_PROMPT_PATH, 'utf8');
    return cachedPromptRpa;
  }

  // chatbot_flow (default)
  if (cachedPromptChatbot) return cachedPromptChatbot;
  const base = fs.readFileSync(CHATBOT_PROMPT_PATH, 'utf8');
  const ragBundle = getRagChatbotBundleText();
  cachedPromptChatbot = [base, '', ragBundle].join('\n');
  return cachedPromptChatbot;
}

async function callModel(prompt, meta) {
  const tenantId = meta?.tenantId || null;
  const context = {
    tenantId,
    source: 'aiWrappersAdapter',
    endpoint: meta?.endpoint || null,
    executionId: meta?.executionId || null,
    requestId: meta?.requestId || null,
    signal: meta?.signal || null,
  };
  try {
    const res = await generateAiResponse(prompt, tenantId, context);
    return { text: res?.text || '', usage: res?.usage || null };
  } catch (err) {
    const msg = err?.message || String(err);
    const overflow = isProviderContextOverflowError(err);
    const alreadySummarized = String(prompt || '').includes(PROMPT_SUMMARY_MARKER);

    if (!overflow || alreadySummarized) {
      throw err;
    }

    const parts = extractRagBlockFromPrompt(prompt);
    if (!parts) {
      logger.warn('[aiWrappersAdapter] Overflow detectado, mas bloco RAG não foi encontrado no prompt (sem retry)', {
        tenantId,
        message: msg,
      });
      throw err;
    }

    // 1) Sumariza o bloco RAG com uma chamada curta à IA.
    let summaryText = '';
    try {
      const summarizationPrompt = buildRagSummarizationPrompt(parts.rag, {
        maxChars: 45000,
        maxLines: 60,
        maxPerSection: 12,
      });
      const sumRes = await generateAiResponse(summarizationPrompt, tenantId, {
        ...context,
        source: 'aiWrappersAdapter:rag_summarize',
      });
      summaryText = String(sumRes?.text || '').trim();
    } catch (sumErr) {
      logger.warn('[aiWrappersAdapter] Falha ao sumarizar RAG após overflow (sem retry)', {
        tenantId,
        error: sumErr?.message || String(sumErr),
      });
      throw err;
    }

    if (!summaryText) {
      logger.warn('[aiWrappersAdapter] Sumarização retornou vazia após overflow (sem retry)', { tenantId });
      throw err;
    }

    const summarizedRag = [
      '## Conhecimento Interno (RAG) — SUMARIZADO',
      summaryText,
    ].join('\n');

    const summarizedPrompt = [
      parts.before,
      '',
      summarizedRag,
      '',
      parts.after,
    ].filter(Boolean).join('\n');

    const summarizedPromptWithSize = upsertPromptIndicator(summarizedPrompt, {
      summarized: true,
      reason: 'PROVIDER_CONTEXT_OVERFLOW',
      originalPromptChars: String(prompt || '').length,
      summarizedPromptChars: summarizedPrompt.length,
    });

    // 2) Retry único com prompt sumarizado.
    try {
      const retryRes = await generateAiResponse(summarizedPromptWithSize, tenantId, {
        ...context,
        source: 'aiWrappersAdapter:retry_summarized',
      });
      return { text: retryRes?.text || '', usage: retryRes?.usage || null };
    } catch (retryErr) {
      logger.error('[aiWrappersAdapter] Retry com prompt sumarizado falhou', {
        tenantId,
        error: retryErr?.message || String(retryErr),
      });
      throw retryErr;
    }
  }
}

async function buildKnowledgeContext(description, options = {}) {
  const tenantId = options?.tenantId || null;
  if (!tenantId) return { text: '', ragUsed: false, ragExecutionId: null, ragSources: [] };

  // Preferir contexto já fornecido (pipeline)
  if (options?.ragContext?.enabled) {
    const rc = options.ragContext;
    const chunks = Array.isArray(rc.chunks) ? rc.chunks : [];
    const sources = Array.isArray(rc.sources) ? rc.sources : [];
    const text = chunks.length
      ? [
          `## Conhecimento Interno (RAG) - Execution ID: ${rc.executionId || 'N/A'}`,
          ...chunks.slice(0, 18).map((c) => `- ${String(c?.content || c?.text || '').slice(0, 900)}`),
        ].join('\n')
      : '';
    return {
      text,
      ragUsed: true,
      ragExecutionId: rc.executionId || null,
      ragSources: sources.map((s) => s?.documentId || s?.sourceId || s?.sourceType || String(s)).slice(0, 40),
    };
  }

  // Se useRag=true sem ragContext, best-effort: construir contexto persistido
  if (options?.useRag === true) {
    const desiredSources = Array.isArray(options?.ragSources) ? options.ragSources : [];
    const query = `${options?.name ? `${options.name}\n` : ''}${description}`.slice(0, 1800);
    const diverse = await buildDiverseRagContext({
      query,
      tenantId,
      totalK: 12,
      minUploaded: 0,
      minWeb: 0,
      minScore: 0.12,
      maxTokens: 4500,
    });
    const contextSources = Array.isArray(diverse?.contextSources) ? diverse.contextSources : [];
    const text = contextSources.length
      ? [
          '## Conhecimento Interno (RAG)',
          ...contextSources.slice(0, 18).map((s) => `- ${String(s?.text || s?.excerpt || '').slice(0, 900)}`),
        ].join('\n')
      : '';
    return {
      text,
      ragUsed: true,
      ragExecutionId: options?.executionId || null,
      ragSources: contextSources.map((s) => s?.sourceId || s?.sourceType || 'unknown').slice(0, 40),
    };
  }

  return { text: '', ragUsed: false, ragExecutionId: null, ragSources: [] };
}

/**
 * Monta o prompt FINAL (string) que seria enviado ao provedor para o domínio chatbot_flow,
 * sem executar a chamada ao provedor (sem gerar resposta).
 *
 * Importante:
 * - Se `options.ragContext.enabled === true`, usa esse contexto (não faz consulta nova).
 * - Se `options.useRag === true` sem `ragContext`, pode buscar contexto persistido via buildDiverseRagContext (best-effort).
 *
 * @param {string} description
 * @param {object} options
 * @returns {Promise<{ finalPrompt: string, promptSummary: string, objective: string, ragMeta: { ragUsed: boolean, ragExecutionId: any, ragSources: any[] } }>}
 */
async function buildChatbotFinalPrompt(description, options = {}) {
  const objective = typeof description === 'string' ? description.trim() : '';
  if (!objective) {
    throw new Error('description é obrigatório');
  }
  const tenantId = options?.tenantId || null;
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId é obrigatório');
  }

  const prompt = loadPrompt('chatbot_flow');
  const knowledge = await buildKnowledgeContext(objective, { ...options, tenantId: tenantId.trim() });

  const finalPromptRaw = [
    prompt,
    '',
    knowledge?.text ? String(knowledge.text).trim() : '',
    '',
    '## Descrição do Usuário',
    objective,
  ].filter(Boolean).join('\n');

  // Sempre inclui indicador no preview (mesmo quando não houve sumarização).
  const finalPrompt = upsertPromptIndicator(finalPromptRaw, { summarized: false });

  return {
    objective,
    finalPrompt,
    promptSummary: 'chatbot.generator.prompt.md',
    ragMeta: {
      ragUsed: knowledge?.ragUsed === true,
      ragExecutionId: knowledge?.ragExecutionId || null,
      ragSources: Array.isArray(knowledge?.ragSources) ? knowledge.ragSources : [],
    },
  };
}

async function generateChatbotViaCore(description, options = {}, meta = {}) {
  const tenantId = options?.tenantId;
  const requestId = meta?.requestId || null;
  const aiMeta = meta?.aiMeta || options?._aiMeta || {};

  // ------------------------------------------------------------
  // FlowPreValidator ANTES do LLM (draft do request), quando houver
  // algum fluxo base/seed fornecido por opções de composição.
  // ------------------------------------------------------------
  const prevalidateRequestDraftIfAny = () => {
    const candidates = [
      options?.seedFlowDefinition,
      options?.baseFlowDefinition,
      options?.draftFlowDefinition,
      options?.flowDefinition,
      options?.flow,
    ];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      if (!Array.isArray(c.nodes) || c.nodes.length === 0) continue;
      // Se falhar, deve abortar antes de chamar o provedor.
      validateFlowDraft(c);
      break; // valida apenas o primeiro candidato válido encontrado
    }
  };
  prevalidateRequestDraftIfAny();

  const coreRes = await generateChatbotFlowCore({
    description,
    tenantId,
    options: { ...options, _aiMeta: aiMeta },
    deps: {
      logger,
      loadPrompt: async () => loadPrompt('chatbot_flow'),
      callModel: (prompt) => callModel(prompt, { tenantId, requestId, endpoint: meta?.endpoint || null, signal: meta?.signal || null }),
      validateGeneratedPlan,
      validateByContract,
      validateFlow,
      buildKnowledgeContext: (desc) => buildKnowledgeContext(desc, options),
      buildAiEnvelope,
      validateAiEnvelopeOrThrow,
      // Pós-LLM: o core executa pré-validação hard-fail quando fornecida.
      validateFlowDraft,
    },
  });

  // Pré-validação estrutural (FLOW_*) do draft retornado pelo modelo.
  // Regra: falhou => aborta imediatamente (o normalizer NÃO deve receber ciclos).
  validateFlowDraft(coreRes?.flowDefinition);

  return coreRes;
}

async function generateRpaViaCore(description, options = {}, meta = {}) {
  const tenantId = options?.tenantId;
  const requestId = meta?.requestId || null;
  const aiMeta = meta?.aiMeta || options?._aiMeta || {};

  return await generateRpaTestCore({
    description,
    tenantId,
    options: { ...options, _aiMeta: aiMeta },
    deps: {
      logger,
      loadPrompt: async () => loadPrompt('rpa_test'),
      callModel: (prompt) => callModel(prompt, { tenantId, requestId, endpoint: meta?.endpoint || null, signal: meta?.signal || null }),
      validateGeneratedPlan,
      validateByContract,
      buildAiEnvelope,
      validateAiEnvelopeOrThrow,
    },
  });
}

module.exports = {
  generateChatbotViaCore,
  generateRpaViaCore,
  buildChatbotFinalPrompt,
};

