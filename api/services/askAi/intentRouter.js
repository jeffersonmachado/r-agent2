'use strict';

/**
 * Roteador de intenção determinístico do "Perguntar à IA".
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): toda pergunta era enviada ao RAG
 * estático, inclusive perguntas sobre estado operacional vivo ("qual foi a
 * última visita do João?"). O RAG respondia com documentação — ou não
 * respondia — e a resposta correta exigia consulta ao domínio.
 *
 * Aqui a intenção é classificada ANTES de qualquer recuperação, sem LLM:
 * padrões determinísticos + presença de contexto de entidade. O resultado
 * define quais data tools e quais domínios de conhecimento podem ser usados.
 *
 *   KNOWLEDGE         → documentação/manual (RAG)
 *   OPERATIONAL_DATA  → dados vivos (data tools)
 *   MIXED             → dados vivos + conhecimento operacional
 *   PROCEDURE         → roteiro/manual de "como fazer"
 *   NAVIGATION_HELP   → ajuda de navegação/tela atual
 *   SYSTEM_INTERNAL   → pedido sobre internals técnicos (SYSTEM)
 */

const INTENTS = Object.freeze({
  KNOWLEDGE: 'KNOWLEDGE',
  OPERATIONAL_DATA: 'OPERATIONAL_DATA',
  MIXED: 'MIXED',
  PROCEDURE: 'PROCEDURE',
  NAVIGATION_HELP: 'NAVIGATION_HELP',
  SYSTEM_INTERNAL: 'SYSTEM_INTERNAL',
});

// Marcadores de dado vivo: exigem consulta ao domínio, nunca ao RAG estático.
const LIVE_DATA_MARKERS = [
  /\b(?:qual|quais)\s+(?:foi|foram|é|são|era)\s+(?:a|o|as|os)?\s*(?:últim|ultim)/i,
  /\búltim[ao]s?\s+(?:visita|check-?in|contato|pagamento|compra|interação|mensagem|atendimento)/i,
  /\b(?:está|esta|estão|estao)\s+(?:inadimplente|ativo|ativa|bloqueado|bloqueada|em risco|cancelad[oa]|pendente)/i,
  /\b(?:quanto|quantos)\s+(?:[\wçãáéíóúâêô]+\s+){0,3}?(?:deve|devem|devo)\b/i,
  /\b(?:frequência|frequencia|assiduidade|comparecimento)\b/i,
  /\b(?:churn|evasão|evasao|risco de perda|risco de cancelamento)\b/i,
  /\b(?:saldo|fatura|faturas|inadimplência|inadimplencia|cobrança|cobranca)\b/i,
  /\b(?:quantas vezes|quantos dias sem|dias sem vir|sem frequentar)\b/i,
  /\b(?:agendamentos|agenda|reservas?)\s+(?:futur|próxim|proxim)/i,
  /\b(?:status do|situação d[ao]|situacao d[ao])\s+(?:aluno|aluna|cliente|paciente|matrícula|matricula|pedido)/i,
];

// Marcadores de procedimento: "como fazer" → roteiro/manual.
const PROCEDURE_MARKERS = [
  /\bcomo\s+(?:fa[çc]o|fazer|cadastr|registr|abrir|criar|configur|alterar|editar|cancelar|emitir|gerar)/i,
  /\bqual\s+(?:é\s+)?o\s+(?:roteiro|procedimento|passo a passo|processo)/i,
  /\bpasso\s+a\s+passo\b/i,
  /\bprocedimento\s+(?:para|de)\b/i,
];

// Marcadores de recomendação/explicação: transformam dado vivo em MIXED.
// "Por que este aluno está em risco?" exige o método (conhecimento) além do
// dado vivo — a explicação causal nunca vem só do estado.
const RECOMMENDATION_MARKERS = [
  /^\s*(?:por\s+que|porque|por\s+quais\s+motivos?)\b/i,
  /\b(?:o que|que)\s+(?:devo|preciso|podemos)\s+(?:fazer|faz|ser feito)/i,
  /\b(?:recomend|sugir|melhore?s?\s+aç|proxim[oa]\s+aç|qual a melhor (?:ação|acao|ação|abordagem))/i,
  /\bcomo\s+(?:recuperar|reverter|contornar|resolver|tratar|abordar)\b/i,
  /\b(?:plano de ação|plano de acao|próximos passos|proximos passos)\b/i,
];

// Marcadores de ajuda de navegação/tela.
const NAVIGATION_MARKERS = [
  /\bonde\s+(?:encontro|fica|est[áa]|consigo|vejo|acesso)\b/i,
  /\bnessa\s+tela\b|\bnesta\s+tela\b|\bao\s+abrir\s+esta\s+tela\b/i,
  /\b(?:o que|que)\s+(?:fa[çc]o|posso fazer)\s+(?:aqui|nessa|nesta)\b/i,
  /\bcomo\s+(?:chego|navego|vou)\s+(?:at[ée]|para)\b/i,
];

// Marcadores de internals técnicos. Só fazem sentido no domínio SYSTEM.
const SYSTEM_INTERNAL_MARKERS = [
  /\b(?:qa\s*waves?|qa\s*mesh|wave\s*\d+|coverage\s*gate)\b/i,
  /\b(?:replay|replays|rpa)\b/i,
  /\b(?:seed|seeds|dados sintéticos|dados sinteticos)\b/i,
  /\b(?:scenario\s*builder|validation\s*engine|evidence\s*engine|benchmark)\b/i,
  /\b(?:coverage\s*analysis|regression\s*engine|rpa\s*lab)\b/i,
  /\b(?:arquivos? de evidência|raw\s*logs|logs? brutos)\b/i,
  /\b(?:diagrama\s+de\s+qa|qa\s*diagram)\b/i,
];

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classifica a intenção da pergunta.
 *
 * @param {Object} input
 * @param {string} input.question
 * @param {Object} [input.context] - Contexto de tela já validado
 * @param {string} [input.classification] - Classificação do ator (resolve SYSTEM/FORBIDDEN)
 * @returns {{intent: string, signals: string[], entity: Object|null, blocked: boolean}}
 */
function classifyIntent({ question, context = {}, classification = 'PRODUCTION' }) {
  const text = String(question || '');
  const signals = [];

  const hasSystemMarker = matchesAny(text, SYSTEM_INTERNAL_MARKERS);
  const isPrivileged = classification === 'SUPPORT' || classification === 'DEVELOPMENT';

  if (hasSystemMarker) {
    signals.push('system_internal_marker');
    if (!isPrivileged) {
      // PRODUCTION não pode sequer consultar o domínio SYSTEM: bloqueia antes
      // de qualquer recuperação (fail-closed).
      return {
        intent: INTENTS.SYSTEM_INTERNAL,
        signals,
        entity: null,
        blocked: true,
      };
    }
  }

  const entity = context?.entityType && context?.entityId
    ? { type: context.entityType, id: context.entityId }
    : null;
  if (entity) signals.push('entity_context');

  const hasLiveData = matchesAny(text, LIVE_DATA_MARKERS);
  const hasRecommendation = matchesAny(text, RECOMMENDATION_MARKERS);
  const hasProcedure = matchesAny(text, PROCEDURE_MARKERS);
  const hasNavigation = matchesAny(text, NAVIGATION_MARKERS);

  if (hasLiveData) signals.push('live_data_marker');

  if (hasRecommendation) signals.push('recommendation_marker');
  if (hasProcedure) signals.push('procedure_marker');
  if (hasNavigation) signals.push('navigation_marker');

  let intent = INTENTS.KNOWLEDGE;

  if (hasLiveData && (hasRecommendation || hasProcedure)) {
    intent = INTENTS.MIXED;
  } else if (hasLiveData || (entity && entityQuestionsState(text))) {
    intent = INTENTS.OPERATIONAL_DATA;
  } else if (hasProcedure) {
    intent = INTENTS.PROCEDURE;
  } else if (hasNavigation) {
    intent = INTENTS.NAVIGATION_HELP;
  } else if (hasRecommendation && entity) {
    intent = INTENTS.MIXED;
  }

  if (hasSystemMarker && isPrivileged) {
    intent = INTENTS.SYSTEM_INTERNAL;
  }

  return { intent, signals, entity, blocked: false };
}

// Perguntas curtas de acompanhamento ("e a frequência dele?", "e o
// financeiro?") só fazem sentido como dado vivo quando há entidade no contexto.
function entityQuestionsState(text) {
  return /\b(?:dele|dela|deste|desta|desse|dessa|do aluno|da aluna|do cliente|da cliente)\b/i.test(text);
}

/**
 * Decide se a intenção exige conhecimento documental (RAG).
 */
function needsKnowledge(intent) {
  return intent === INTENTS.KNOWLEDGE
    || intent === INTENTS.MIXED
    || intent === INTENTS.PROCEDURE
    || intent === INTENTS.NAVIGATION_HELP;
}

/**
 * Decide se a intenção exige dados vivos (data tools).
 */
function needsOperationalData(intent) {
  return intent === INTENTS.OPERATIONAL_DATA
    || intent === INTENTS.MIXED;
}

module.exports = {
  INTENTS,
  LIVE_DATA_MARKERS,
  PROCEDURE_MARKERS,
  RECOMMENDATION_MARKERS,
  NAVIGATION_MARKERS,
  SYSTEM_INTERNAL_MARKERS,
  classifyIntent,
  needsKnowledge,
  needsOperationalData,
};
