'use strict';

/**
 * Contexto conversacional do "Perguntar à IA".
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): a conversa era PERSISTIDA mas não
 * PARTICIPAVA do turno. `buildPromptHistory` existia e nunca era chamado.
 * Consequência prática:
 *
 *   Q1: "Qual a situação financeira deste aluno?"  → respondia
 *   Q2: "E a frequência dele?"                     → não sabia quem era "ele"
 *   Q3: "Então por que está em risco?"             → perdia sujeito e método
 *
 * Aqui a continuidade é resolvida de forma DETERMINÍSTICA e sem LLM:
 *  - o SUJEITO da conversa vem do contexto PERSISTIDO e já validado
 *    server-side (nunca do histórico enviado pelo cliente, que permanece
 *    ignorado) — e é REVALIDADO de novo no turno seguinte;
 *  - um acompanhamento curto herda a FAMÍLIA de intenção do turno anterior
 *    (não repete a classificação por palavra-chave, que em "e a frequência
 *    dele?" seria ambígua);
 *  - a RECUPERAÇÃO documental é contextualizada com o assunto anterior, para
 *    que um follow-up não vire uma busca sem sujeito no corpus.
 *
 * Nada aqui é autoridade: a posse da entidade continua sendo revalidada no
 * backend a cada turno.
 */

/** Marcadores de continuação: pergunta que só faz sentido com o turno anterior. */
const FOLLOW_UP_MARKERS = Object.freeze([
  /^\s*(?:e|aí|então|entao|também|tambem|mas|aliás|alias)\b/i,
  /^\s*(?:dele|dela|disso|nisso|nesse|nessa|neles|nelas|ele|ela)\b/i,
  /^\s*(?:e\s+o|e\s+a|e\s+os|e\s+as)\b/i,
  /\b(?:mesmo\s+(?:aluno|cliente|caso)|esse\s+aluno|essa\s+aluna|esse\s+cliente)\b/i,
]);

/**
 * Aberturas de ASSUNTO NOVO. Uma pergunta que começa assim não é
 * acompanhamento, mesmo sendo curta ("Como configuro uma campanha?" é tema
 * novo, não continuação de "e a frequência dele?").
 *
 * Sem esta guarda, o limite de palavras transformava toda pergunta curta em
 * herança do turno anterior — e a recuperação documental recebia o sujeito
 * errado.
 */
const TOPIC_STARTERS = Object.freeze([
  /^\s*(?:como|qual|quais|quando|onde|cad[êe]|quanto|quantos|quantas)\b/i,
  /^\s*(?:o\s+que|que|explique|explica|mostre|liste|detalhe|descreva|me\s+diga)\b/i,
]);

/**
 * Pergunta CAUSAL sobre o assunto corrente ("então por que está em risco").
 * Causalidade exige dado vivo E método: herdar apenas `OPERATIONAL_DATA`
 * responderia o fato sem explicar o porquê.
 */
const CAUSAL_MARKERS = Object.freeze([
  /\b(?:por\s+que|porque|por\s+quais\s+motivos?)\b/i,
  /\b(?:o\s+que\s+(?:devo|preciso|podemos)\s+(?:fazer|faz|ser\s+feito))\b/i,
  /\b(?:qual\s+a\s+melhor\s+(?:a[çc][ãa]o|abordagem))\b/i,
]);

const MAX_FOLLOW_UP_WORDS = 6;const MAX_SUBJECT_TOKENS = 6;
const MAX_SUBJECT_CHARS = 120;

/** Palavras funcionais que não identificam assunto (pt-BR). */
const STOPWORDS = Object.freeze(new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
  'nos', 'nas', 'por', 'para', 'com', 'sem', 'e', 'ou', 'que', 'qual', 'quais', 'como',
  'quando', 'onde', 'porque', 'se', 'ao', 'aos', 'à', 'às', 'é', 'são', 'está', 'estao',
  'estão', 'foi', 'ser', 'tem', 'têm', 'tenho', 'ele', 'ela', 'dele', 'dela', 'isso',
  'este', 'esta', 'esse', 'essa', 'deste', 'desta', 'desse', 'dessa', 'meu', 'minha',
  'mais', 'menos', 'muito', 'pouco', 'já', 'ja', 'não', 'nao', 'sim', 'sobre', 'the',
]));

function isShortFollowUp(question) {
  const text = String(question || '').trim();
  if (!text) return false;
  if (FOLLOW_UP_MARKERS.some((pattern) => pattern.test(text))) return true;
  // Assunto novo explícito nunca é acompanhamento, mesmo curto.
  if (TOPIC_STARTERS.some((pattern) => pattern.test(text))) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= MAX_FOLLOW_UP_WORDS;
}

function lastMessageWithRole(messages, role) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === role) return list[index];
  }
  return null;
}

/** Última pergunta do usuário na janela persistida. */
function lastUserQuestion(history) {
  return String(lastMessageWithRole(history?.messages, 'user')?.content || '') || null;
}

/** Intenção do último turno assistente (persistida com a resposta). */
function lastIntent(history) {
  const value = lastMessageWithRole(history?.messages, 'assistant')?.intent;
  return value ? String(value) : null;
}

/**
 * Contexto EFETIVO do turno.
 *
 * Precedência: contexto do cliente (validado neste turno) → contexto
 * PERSISTIDO da conversa (validado em turno anterior e revalidado agora).
 * O histórico enviado pelo cliente nunca é consultado.
 *
 * @returns {{context: object, source: 'payload'|'conversation'|'none'}}
 */
function resolveEffectiveContext({ payloadContext = null, persistedContext = null } = {}) {
  if (payloadContext?.entityType && payloadContext?.entityId) {
    return { context: payloadContext, source: 'payload' };
  }
  if (persistedContext?.entityType && persistedContext?.entityId) {
    return { context: persistedContext, source: 'conversation' };
  }
  return { context: payloadContext || {}, source: 'none' };
}

/**
 * Sujeito do Workspace (cliente 360) informado pela tela.
 *
 * É um DADO DE CONTEXTO aceito pelo contrato e mantido para continuidade — a
 * resolução dele para uma entidade de domínio depende de um resolver de
 * Workspace, que NÃO existe hoje. Expor isso como campo explícito evita que o
 * valor seja silenciosamente descartado.
 */
function workspaceSubjectOf(context) {
  const value = context?.workspaceEntityId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Herda a família de intenção quando a pergunta é um acompanhamento curto e a
 * classificação por palavra-chave caiu no default KNOWLEDGE.
 *
 * Só herda entre intenções que compartilham a mesma necessidade de dados:
 * um follow-up de um turno MIXED continua MIXED (dado vivo + método), e não
 * vira uma pergunta apenas documental.
 */
function inheritIntent({ question, intent, previousIntent, hasEntity = false }) {
  const text = String(question || '');
  if (!isShortFollowUp(text)) return { intent, inherited: false };
  if (!previousIntent) return { intent, inherited: false };
  if (previousIntent === 'SYSTEM_INTERNAL') {
    // Continuação de assunto interno nunca é promovida por herança.
    return { intent, inherited: false };
  }

  const liveIntents = ['OPERATIONAL_DATA', 'MIXED'];
  const causal = CAUSAL_MARKERS.some((pattern) => pattern.test(text));

  // Acompanhamento CAUSAL sobre dado vivo: o fato não explica o porquê — a
  // resposta precisa do DADO e do MÉTODO. Vale quando o turno atual já é de
  // dado vivo ("então por que está em risco?" casa o marcador de estado) ou
  // quando o turno anterior era.
  if (causal && hasEntity && intent !== 'MIXED'
    && (liveIntents.includes(intent) || liveIntents.includes(previousIntent))) {
    return { intent: 'MIXED', inherited: true };
  }

  if (intent !== 'KNOWLEDGE') return { intent, inherited: false };
  if (intent === previousIntent) return { intent, inherited: false };
  // Sem sujeito conhecido, herdar uma intenção de dado vivo não faz sentido.
  if (!hasEntity && liveIntents.includes(previousIntent)) {
    return { intent, inherited: false };
  }
  return { intent: previousIntent, inherited: true };
}

/** Tokens significativos de um texto (assunto), sem palavras funcionais. */
function subjectTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, MAX_SUBJECT_TOKENS);
}

/**
 * Consulta de recuperação contextualizada: um acompanhamento curto não pode
 * ser buscado no corpus sem sujeito. Prefixa os termos significativos da
 * última pergunta do usuário.
 */
function buildRetrievalQuery({ question, history } = {}) {
  const text = String(question || '');
  if (!isShortFollowUp(text)) return text;

  const previous = lastUserQuestion(history);
  if (!previous) return text;

  const tokens = subjectTokens(previous);
  if (tokens.length === 0) return text;

  const subject = tokens.join(' ').slice(0, MAX_SUBJECT_CHARS);
  return `${subject} ${text}`.trim();
}

/**
 * Resumo auditável do que a conversa contribuiu para o turno.
 * Nunca contém valores de dado de negócio — apenas rótulos e contadores.
 */
function describeConversationUse({ history, effectiveContextSource, inheritedIntent, hasSummary, context = null }) {
  return Object.freeze({
    windowMessages: Array.isArray(history?.messages) ? history.messages.length : 0,
    hasSummary: hasSummary === true,
    entityFromConversation: effectiveContextSource === 'conversation',
    intentInheritedFromConversation: inheritedIntent === true,
    // Sujeito do Workspace recebido da tela (não resolvido para entidade de
    // domínio — não há resolver de Workspace implementado).
    workspaceSubjectPresent: workspaceSubjectOf(context) !== null,
    routeModule: context?.module || null,
    routePageType: context?.pageType || null,
  });
}

module.exports = {
  FOLLOW_UP_MARKERS,
  TOPIC_STARTERS,
  CAUSAL_MARKERS,
  MAX_FOLLOW_UP_WORDS,
  isShortFollowUp,
  lastUserQuestion,
  lastIntent,
  resolveEffectiveContext,
  workspaceSubjectOf,
  inheritIntent,
  subjectTokens,
  buildRetrievalQuery,
  describeConversationUse,
};
