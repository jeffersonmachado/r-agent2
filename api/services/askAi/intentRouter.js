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
 *   ASSISTANT_*       → perguntas sobre o PRÓPRIO assistente (identidade,
 *                       capacidades, limites, fontes, privacidade, uso).
 *                       Respondidas por configuração canônica: NÃO recuperam
 *                       RAG nem consultam dado vivo (TAREFAS 04-20).
 */

const INTENTS = Object.freeze({
  KNOWLEDGE: 'KNOWLEDGE',
  OPERATIONAL_DATA: 'OPERATIONAL_DATA',
  MIXED: 'MIXED',
  PROCEDURE: 'PROCEDURE',
  NAVIGATION_HELP: 'NAVIGATION_HELP',
  SYSTEM_INTERNAL: 'SYSTEM_INTERNAL',
  ASSISTANT_IDENTITY: 'ASSISTANT_IDENTITY',
  ASSISTANT_CAPABILITIES: 'ASSISTANT_CAPABILITIES',
  ASSISTANT_LIMITATIONS: 'ASSISTANT_LIMITATIONS',
  ASSISTANT_SOURCES: 'ASSISTANT_SOURCES',
  ASSISTANT_PRIVACY: 'ASSISTANT_PRIVACY',
  ASSISTANT_HELP: 'ASSISTANT_HELP',
});

const ASSISTANT_META_INTENTS = Object.freeze([
  INTENTS.ASSISTANT_IDENTITY,
  INTENTS.ASSISTANT_CAPABILITIES,
  INTENTS.ASSISTANT_LIMITATIONS,
  INTENTS.ASSISTANT_SOURCES,
  INTENTS.ASSISTANT_PRIVACY,
  INTENTS.ASSISTANT_HELP,
]);

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

// Perguntas sobre o PRÓPRIO assistente. O sujeito é o assistente ("você"), não o
// domínio: por isso os padrões exigem o pronome/segunda pessoa junto do
// substantivo. Sem isso, "o que você pode fazer" viraria ASSISTANT_CAPABILITIES
// mas "o que posso fazer com um aluno inadimplente" também — e essa é uma
// pergunta de negócio, não sobre o assistente.
const ASSISTANT_META_MARKERS = Object.freeze([
  {
    intent: INTENTS.ASSISTANT_IDENTITY,
    patterns: [
      // `\b` do JavaScript é ASCII: depois de `você` (termina em `ê`, não-ASCII)
      // o boundary NÃO casa. Toda terminação acentuada usa lookahead explícito.
      /\bquem\s+(?:é|e)\s+voc[êe](?=\s|$|[,.!?;:])/i,
      /\bvoc[êe]\s+(?:é|e)\s+(?:um|uma|o|a)?\s*(?:rob[ôo]|bot|ia|intelig[êe]ncia|assistente|humano|pessoa)/i,
      /\b(?:qual|qual\s+é)\s+(?:o\s+)?seu\s+nome\b/i,
      /\bo\s+que\s+voc[êe]\s+(?:é|e)(?=\s|$|[,.!?;:])/i,
    ],
  },
  {
    intent: INTENTS.ASSISTANT_CAPABILITIES,
    patterns: [
      /\bo\s+que\s+voc[êe]\s+(?:pode|consegue|sabe|faz)\b/i,
      /\b(?:quais|que)\s+(?:s[ãa]o\s+)?(?:as\s+)?suas\s+(?:fun[çc][õo]es|capacidades|habilidades|tarefas)\b/i,
      /\bvoc[êe]\s+(?:consegue|pode)\s+(?:me\s+)?(?:ajudar|fazer|responder|buscar|consultar|executar)\b/i,
      /\bpara\s+que\s+voc[êe]\s+serve\b/i,
    ],
  },
  {
    intent: INTENTS.ASSISTANT_LIMITATIONS,
    patterns: [
      /\bo\s+que\s+voc[êe]\s+n[ãa]o\s+(?:pode|consegue|sabe|faz)\b/i,
      /\b(?:quais|que)\s+(?:s[ãa]o\s+)?(?:os\s+)?seus\s+limites\b/i,
      /\bquais\s+s[ãa]o\s+suas\s+limita[çc][õo]es\b/i,
      /\bvoc[êe]\s+(?:tem|possui)\s+acesso\s+a\b/i,
    ],
  },
  {
    intent: INTENTS.ASSISTANT_SOURCES,
    patterns: [
      /\bde\s+onde\s+(?:v[êe]m|vem|saem)\s+(?:as\s+)?suas\s+respostas\b/i,
      /\b(?:quais|que)\s+fontes\s+voc[êe]\s+usa\b/i,
      /\bvoc[êe]\s+usa\s+(?:quais\s+)?(?:fontes|documentos)\b/i,
      /\bcomo\s+voc[êe]\s+(?:sabe|descobre|encontra)\s+(?:isso|as\s+respostas)\b/i,
    ],
  },
  {
    intent: INTENTS.ASSISTANT_PRIVACY,
    patterns: [
      /\b(?:meus|nossos)\s+dados\s+(?:est[ãa]o|ficam|s[ãa]o)\s+(?:seguros|protegidos)\b/i,
      /\bquem\s+(?:v[êe]|pode\s+ver)\s+(?:o\s+que\s+eu\s+pergunto|minhas\s+perguntas)\b/i,
      /\bvoc[êe]\s+(?:guarda|armazena|salva)\s+(?:minhas|as)\s+(?:perguntas|conversas)\b/i,
      /\boutros\s+(?:clientes|tenants|empresas)\s+(?:veem|vêem|conseguem\s+ver)\b/i,
    ],
  },
  {
    intent: INTENTS.ASSISTANT_HELP,
    patterns: [
      /\bcomo\s+(?:eu\s+)?(?:uso|utilizo)\s+voc[êe](?=\s|$|[,.!?;:])/i,
      /\bcomo\s+(?:fa[çc]o|devo)\s+(?:uma\s+)?pergunt/i,
      /\bajuda\s+(?:do|sobre\s+o)\s+assistente\b/i,
      /\bo\s+que\s+eu\s+posso\s+perguntar\b/i,
    ],
  },
]);

/**
 * Detecta pergunta sobre o próprio assistente.
 *
 * @param {string} text
 * @returns {string|null} intenção ASSISTANT_* ou null
 */
function detectAssistantMetaIntent(text) {
  for (const entry of ASSISTANT_META_MARKERS) {
    if (matchesAny(text, entry.patterns)) return entry.intent;
  }
  return null;
}

/**
 * Intenções respondidas por configuração canônica — nunca por recuperação.
 */
function isAssistantMeta(intent) {
  return ASSISTANT_META_INTENTS.includes(intent);
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

  // Pergunta sobre o próprio assistente é resolvida primeiro: ela não descreve
  // o domínio nem pede dado vivo, e o pedido é sobre COMO o assistente funciona.
  const metaIntent = detectAssistantMetaIntent(text);
  if (metaIntent) {
    signals.push('assistant_meta_marker');
    return { intent: metaIntent, signals, entity: null, blocked: false };
  }

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
  ASSISTANT_META_INTENTS,
  ASSISTANT_META_MARKERS,
  LIVE_DATA_MARKERS,
  PROCEDURE_MARKERS,
  RECOMMENDATION_MARKERS,
  NAVIGATION_MARKERS,
  SYSTEM_INTERNAL_MARKERS,
  classifyIntent,
  detectAssistantMetaIntent,
  isAssistantMeta,
  needsKnowledge,
  needsOperationalData,
};
