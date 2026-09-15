'use strict';

/**
 * Auto-descrição do assistente (TAREFAS 04-20).
 *
 * GAP CONFIRMADO (2026-09-14): "Quem é você?", "O que você pode fazer?",
 * "Quais são seus limites?", "De onde vêm suas respostas?" caíam em
 * `KNOWLEDGE` e eram enviadas ao RAG — a pergunta sobre o PRÓPRIO assistente
 * consumia recuperação documental e podia voltar com um trecho de manual que
 * nada tem a ver com a pergunta (ou sem resposta, quando o corpus não tem o
 * assunto).
 *
 * Aqui a resposta é montada por CONFIGURAÇÃO CANÔNICA, sem RAG, sem dado vivo e
 * sem LLM. Regras de conteúdo:
 *  - nada de fornecedor/modelo/versão de motor (isso é decisão de política, não
 *    de texto padrão);
 *  - capacidades descritas a partir do que o ATOR realmente pode acionar
 *    (ferramentas já autorizadas por capabilidade) — nunca prometer o que a
 *    permissão não alcança;
 *  - nenhum identificador interno (toolId, documento, rota de engenharia) no
 *    texto;
 *  - em ator PRODUCTION, nenhuma menção a superfície de engenharia.
 */

const { INTENTS } = require('./intentRouter');

const DEFAULT_PRODUCT_NAME = 'Assistente RAP';

const IDENTITY_CORE = [
  'Sou o assistente do seu espaço de trabalho no RAP. Respondo sobre a sua operação: dúvidas de processo, roteiros e dados do seu negócio.',
  'Não sou uma pessoa: sou um componente do sistema, e o que eu afirmo vem das fontes que consigo consultar no seu espaço de trabalho.',
];

const SOURCE_RULES = [
  'Documentos operacionais do seu espaço de trabalho (manuais, roteiros e materiais que você ou sua equipe carregaram).',
  'Dados vivos do seu negócio, consultados no momento da pergunta quando ela é sobre estado atual.',
  'Quando não encontro evidência suficiente, eu digo que não encontrei — não estimo nem completo por conta própria.',
];

const LIMITATION_RULES = [
  'Vejo apenas o seu espaço de trabalho: documentos e dados de outros clientes não entram na resposta.',
  'Não altero nem apago registros: eu mostro onde fazer e o que fazer.',
  'Não respondo sobre engenharia interna da plataforma.',
  'Não substituo decisão humana em assunto sensível: a decisão final é sempre de quem opera.',
];

const PRIVACY_RULES = [
  'Acesso apenas os dados do seu espaço de trabalho que a sua permissão alcança e que são necessários para responder à pergunta — nunca tudo, nunca dados de outros clientes.',
  'As perguntas e respostas ficam no histórico da sua conversa, dentro do seu espaço de trabalho.',
  'A busca em documentos é filtrada por domínio antes da recuperação: conteúdo técnico e conteúdo operacional não se misturam.',
  'O conhecimento de outros espaços de trabalho não é acessível a partir do seu.',
];

const HELP_RULES = [
  'Pergunte em linguagem natural, como falaria com um colega: "como cadastro um aluno?" ou "qual foi a última visita deste aluno?".',
  'Vale citar a tela em que você está: eu uso esse contexto para responder sobre o que está na frente.',
  'Cada resposta traz as fontes usadas; você pode abrir o documento citado para conferir.',
];

/**
 * ESCOPO DE CONHECIMENTO (TAREFA — "O que você sabe?").
 *
 * Separado de CAPACIDADES de propósito: aqui a resposta é sobre o QUE EXISTE
 * como conhecimento disponível, não sobre o que eu consigo executar. Misturar
 * as duas perguntas produzia a mesma resposta para "o que você sabe?" e "o que
 * você pode fazer?".
 *
 * Em ator PRODUCTION nenhuma linha menciona superfície de engenharia (QA Waves,
 * replay, seeds, RPA interno, benchmark, corpus SYSTEM).
 */
const KNOWLEDGE_SCOPE_RULES = [
  'Documentação operacional do seu espaço de trabalho: manuais, roteiros e materiais que você ou sua equipe carregaram.',
  'Procedimentos da plataforma dentro da sua permissão — o que fazer e onde fazer.',
  'O contexto da tela atual, quando você está com uma página aberta.',
  'O registro selecionado, quando a tela informa qual é (aluno, cliente, atendimento).',
  'Dados vivos do seu negócio que a sua permissão alcança, consultados no momento da pergunta.',
];

const KNOWLEDGE_SCOPE_LIMITS = [
  'Não tenho conhecimento do que não está no seu espaço de trabalho.',
  'Não guardo conteúdo de outras empresas nem de outras telas fora do seu espaço.',
  'Quando a resposta não está nas fontes disponíveis, eu digo que não encontrei.',
];

const PRIVILEGED_KNOWLEDGE_SCOPE_EXTRA = [
  'Com o seu nível de acesso, também alcanço a documentação de engenharia da plataforma (validação, replay e benchmarking).',
];

/** Rótulos humanos de tipo de entidade — nunca ids, nunca rotas internas. */
const ENTITY_LABELS = Object.freeze({
  FITNESS_STUDENT: 'aluno',
  CUSTOMER: 'cliente',
  CASE: 'chamado',
  CONVERSATION: 'atendimento',
  CAMPAIGN: 'campanha',
  TICKET: 'chamado',
  ORDER: 'pedido',
  BOOKING: 'agendamento',
});

/** Módulos cujo rótulo humano não é apenas a slug humanizada. */
const MODULE_LABELS = Object.freeze({
  workspace: 'espaço de trabalho',
  inbox: 'atendimento (caixa de entrada)',
  crm: 'CRM',
  pfx: 'telefonia',
  pbx: 'telefonia',
  ragdocuments: 'base de conhecimento',
  'rag-documents': 'base de conhecimento',
  settings: 'configurações',
  cases: 'chamados',
});

function humanizeToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Rótulo HUMANO da tela atual.
 *
 * Nunca devolve `route` (caminho interno), id de entidade nem tenant: a
 * pergunta é "em que tela estou?", não "qual é a URL".
 *
 * @returns {string|null}
 */
function describeScreenLabel(context = {}) {
  const module = String(context?.module || '').trim().toLowerCase();
  const pageType = String(context?.pageType || '').trim().toLowerCase();
  const action = String(context?.actionContext || '').trim().toLowerCase();

  const known = MODULE_LABELS[module] || MODULE_LABELS[module.replace(/[^a-z0-9]/g, '')];
  if (known) return known;

  return humanizeToken(pageType) || humanizeToken(module) || humanizeToken(action) || null;
}

/**
 * Resposta para SCREEN_CONTEXT. Sem contexto suficiente, DIZ QUE NÃO TEM —
 * nunca inventa a tela.
 *
 * @param {Object} input
 * @param {Object} [input.context] contexto de tela já validado server-side
 * @returns {{answer: string, grounded: boolean, facts: Object}}
 */
function buildScreenContextAnswer({ context = {}, productName = DEFAULT_PRODUCT_NAME } = {}) {
  const label = describeScreenLabel(context);
  const entityType = String(context?.entityType || '').trim().toUpperCase();
  const entityLabel = ENTITY_LABELS[entityType] || null;

  if (!label && !entityLabel) {
    return {
      answer: 'Não tenho contexto suficiente da tela atual. Se você abrir a página e perguntar de novo, eu uso o contexto dela para responder.',
      grounded: false,
      facts: { kind: 'screen_context', grounded: false, hasLabel: false },
    };
  }

  const parts = [];
  if (label) parts.push(`Você está em ${label}.`);
  if (entityLabel) {
    parts.push(`Estou considerando o ${entityLabel} que está aberto nesta tela, dentro da sua permissão.`);
  }
  parts.push(`Sou o ${String(productName || DEFAULT_PRODUCT_NAME).trim() || DEFAULT_PRODUCT_NAME}: posso explicar o que esta tela faz, apontar onde ficam os recursos e consultar os dados que a sua permissão alcança aqui.`);

  return {
    answer: parts.join(' '),
    grounded: true,
    facts: { kind: 'screen_context', grounded: true, hasLabel: Boolean(label), hasEntity: Boolean(entityLabel) },
  };
}

/**
 * Resposta para ASSISTANT_SOURCE_FOLLOWUP — reaproveita o TURNO ANTERIOR.
 *
 * Não refaz recuperação: as fontes devolvidas são EXATAMENTE as da resposta
 * citada (mesmo `url`), ou a declaração explícita de que a resposta veio de
 * dados vivos e não de documento.
 *
 * @param {Object} input
 * @param {Object|null} input.previousTurn `{ sources, facts, intent }` do turno anterior
 * @returns {{answer: string, sources: Array, reused: boolean, facts: Object}}
 */
function buildSourceFollowUpAnswer({ previousTurn = null } = {}) {
  if (!previousTurn) {
    return {
      answer: 'Ainda não tenho uma resposta anterior nesta conversa para citar a fonte. Faça a pergunta e eu mostro de onde tirei a resposta.',
      sources: [],
      reused: false,
      facts: { kind: 'source_followup', reused: false, sourceCount: 0 },
    };
  }

  const sources = Array.isArray(previousTurn.sources) ? previousTurn.sources : [];
  if (sources.length > 0) {
    const labels = sources.map((source) => source.label).filter(Boolean);
    return {
      answer: `A resposta anterior veio de: ${labels.join('; ')}. Os links estão logo abaixo — abra para conferir o documento.`,
      sources,
      reused: true,
      facts: { kind: 'source_followup', reused: true, sourceCount: sources.length },
    };
  }

  const liveFacts = Array.isArray(previousTurn.facts) ? previousTurn.facts : [];
  if (liveFacts.length > 0) {
    const labels = liveFacts.map((fact) => fact.label || fact.key).filter(Boolean);
    return {
      answer: `A resposta anterior não veio de um documento: foi consultada nos dados vivos do seu espaço de trabalho${labels.length ? ` (${labels.join('; ')})` : ''} no momento em que você perguntou. Não existe documento citável para ela.`,
      sources: [],
      reused: true,
      facts: { kind: 'source_followup', reused: true, sourceCount: 0, liveFactCount: liveFacts.length },
    };
  }

  return {
    answer: 'A resposta anterior não usou documento nem dado do seu espaço de trabalho: foi uma resposta de orientação. Por isso não há fonte para citar.',
    sources: [],
    reused: true,
    facts: { kind: 'source_followup', reused: true, sourceCount: 0 },
  };
}

const INTENT_LABELS = Object.freeze({
  KNOWLEDGE: 'documentação do seu espaço de trabalho',
  OPERATIONAL_DATA: 'dados vivos do seu negócio',
  MIXED: 'dados vivos e documentação',
  PROCEDURE: 'roteiro/procedimento documentado',
  NAVIGATION_HELP: 'orientação de navegação',
  SCREEN_CONTEXT: 'contexto da tela atual',
  ASSISTANT_IDENTITY: 'configuração do assistente',
  ASSISTANT_KNOWLEDGE_SCOPE: 'configuração do assistente',
  ASSISTANT_CAPABILITIES: 'configuração do assistente',
  ASSISTANT_LIMITATIONS: 'configuração do assistente',
  ASSISTANT_SOURCES: 'configuração do assistente',
  ASSISTANT_PRIVACY: 'configuração do assistente',
  ASSISTANT_HELP: 'configuração do assistente',
});

/**
 * Resposta para ASSISTANT_PRIOR_PROVENANCE — "Por que você respondeu isso?".
 *
 * Explica com as EVIDÊNCIAS usadas (fatos consultados, fontes citadas). Nunca
 * expõe prompt de sistema, cadeia de raciocínio, ids de ferramenta ou mecânica
 * interna do retrieval.
 *
 * @param {Object} input
 * @param {Object|null} input.previousTurn
 * @returns {{answer: string, sources: Array, facts: Object}}
 */
function buildPriorProvenanceAnswer({ previousTurn = null } = {}) {
  if (!previousTurn) {
    return {
      answer: 'Ainda não tenho uma resposta anterior nesta conversa para justificar. Faça a pergunta e, na sequência, eu explico no que me baseei.',
      sources: [],
      facts: { kind: 'prior_provenance', available: false },
    };
  }

  const sources = Array.isArray(previousTurn.sources) ? previousTurn.sources : [];
  const facts = Array.isArray(previousTurn.facts) ? previousTurn.facts : [];
  const lines = [];
  const basis = INTENT_LABELS[previousTurn.intent] || 'informações disponíveis no seu espaço de trabalho';
  lines.push(`Aquela resposta foi montada a partir de ${basis}.`);

  const factLabels = facts.map((fact) => fact.label || fact.key).filter(Boolean);
  if (factLabels.length > 0) {
    lines.push(`Consultei: ${factLabels.join('; ')}.`);
  }
  if (sources.length > 0) {
    const labels = sources.map((source) => source.label).filter(Boolean);
    lines.push(`Documentos citados: ${labels.join('; ')}.`);
  } else if (factLabels.length === 0) {
    lines.push('Não usei documento nem registro do seu espaço de trabalho: foi uma orientação geral.');
  }
  lines.push('Se algum desses dados não conferir com o que você vê, me diga qual — eu revejo a resposta.');

  return {
    answer: lines.join(' '),
    sources,
    facts: {
      kind: 'prior_provenance',
      available: true,
      sourceCount: sources.length,
      factCount: facts.length,
    },
  };
}

/**
 * Capacidades reais do ator, derivadas das ferramentas AUTORIZADAS.
 *
 * @param {string[]} toolLabels rótulos legíveis das ferramentas autorizadas
 * @returns {string[]}
 */
function describeCapabilities(toolLabels = []) {
  const lines = [
    'Explico processos e roteiros a partir dos documentos do seu espaço de trabalho.',
    'Digo onde encontrar cada recurso nas telas que a sua permissão alcança.',
  ];
  const labels = Array.from(new Set(
    (Array.isArray(toolLabels) ? toolLabels : [])
      .map((label) => String(label || '').trim())
      .filter(Boolean),
  ));
  if (labels.length > 0) {
    lines.push(`Consulto, no momento da pergunta: ${labels.join('; ')}.`);
  } else {
    lines.push('Quando a sua permissão incluir consultas a dados do negócio, eu passo a responder também sobre o estado atual dos registros.');
  }
  return lines;
}

/**
 * Recorte pelas CAPABILITIES DO TENANT (`tenant_settings.capabilities`).
 *
 * Uma tool só é filtrada aqui quando declara `tenantCapability` E o tenant a
 * tem explicitamente desligada (`=== false`). Capability ausente/desconhecida
 * NÃO esconde a tool: o RBAC do ator já governa, e esconder por desconhecido
 * transformaria um erro de configuração em negação silenciosa de capacidade.
 *
 * Nenhuma tool do catálogo atual declara `tenantCapability` (o schema de
 * capabilities do tenant — inbox/caseManagement — não cobre a vertical
 * fitness); o mecanismo existe para o próximo domínio gateado.
 *
 * @param {Array<Object>} tools entradas da projeção (com `label` e, opcional, `tenantCapability`)
 * @param {Object|null} tenantCapabilities capabilities normalizadas do tenant
 * @returns {Array<Object>}
 */
function scopeToolsByTenantCapabilities(tools, tenantCapabilities) {
  const list = Array.isArray(tools) ? tools : [];
  if (!tenantCapabilities || typeof tenantCapabilities !== 'object') return list;
  return list.filter((tool) => {
    const required = tool?.tenantCapability;
    if (!required) return true;
    return tenantCapabilities[required] !== false;
  });
}

function bullets(lines) {
  return lines.map((line) => `- ${line}`).join('\n');
}

/**
 * Monta a resposta determinística para pergunta sobre o próprio assistente.
 *
 * @param {Object} input
 * @param {string} input.intent uma das intenções ASSISTANT_*
 * @param {string} [input.productName]
 * @param {string[]} [input.availableTools] rótulos das ferramentas autorizadas
 * @param {string} [input.classification] PRODUCTION | SUPPORT | DEVELOPMENT
 * @param {Object} [input.screenContext] contexto de tela validado (recorte "aqui")
 * @returns {{answer: string, intent: string, facts: Object, capabilityCount: number}}
 */
function buildAssistantSelfDescription({
  intent,
  productName = DEFAULT_PRODUCT_NAME,
  availableTools = [],
  classification = 'PRODUCTION',
  screenContext = null,
} = {}) {
  const capabilities = describeCapabilities(availableTools);
  const name = String(productName || DEFAULT_PRODUCT_NAME).trim() || DEFAULT_PRODUCT_NAME;
  const isPrivileged = classification === 'SUPPORT' || classification === 'DEVELOPMENT';
  // Recorte "aqui": rótulo HUMANO da tela (nunca rota, id de entidade ou tenant).
  const screenLabel = screenContext ? describeScreenLabel(screenContext) : null;

  // Em PRODUCTION a superfície de engenharia não é mencionada nem de passagem
  // (TAREFA 08). As linhas abaixo já são neutras; a guarda existe para que uma
  // futura edição de texto não fure a regra em silêncio.
  const limitations = isPrivileged
    ? LIMITATION_RULES
    : LIMITATION_RULES.filter((line) => !/engenharia interna/i.test(line));

  let answer;
  switch (intent) {
    case INTENTS.ASSISTANT_IDENTITY:
      answer = `Sou o ${name} — ${IDENTITY_CORE[0]}\n\n${IDENTITY_CORE[1]}`;
      break;
    case INTENTS.ASSISTANT_KNOWLEDGE_SCOPE: {
      const scope = isPrivileged
        ? [...KNOWLEDGE_SCOPE_RULES, ...PRIVILEGED_KNOWLEDGE_SCOPE_EXTRA]
        : KNOWLEDGE_SCOPE_RULES;
      answer = `Sobre o que eu sei:\n\n${bullets(scope)}\n\nO que está fora disso:\n\n${bullets(KNOWLEDGE_SCOPE_LIMITS)}`;
      break;
    }
    case INTENTS.ASSISTANT_CAPABILITIES:
      answer = screenLabel
        ? `Aqui, em ${screenLabel}, você pode me pedir:\n\n${bullets(capabilities)}`
        : `Com o seu acesso atual, eu:\n\n${bullets(capabilities)}`;
      break;
    case INTENTS.ASSISTANT_LIMITATIONS:
      answer = `O que eu não faço:\n\n${bullets(limitations)}`;
      break;
    case INTENTS.ASSISTANT_SOURCES:
      answer = `Minhas respostas vêm de:\n\n${bullets(SOURCE_RULES)}`;
      break;
    case INTENTS.ASSISTANT_PRIVACY:
      answer = `Como eu trato o que você pergunta:\n\n${bullets(PRIVACY_RULES)}`;
      break;
    case INTENTS.ASSISTANT_HELP:
      answer = `Como me usar:\n\n${bullets(HELP_RULES)}`;
      break;
    default:
      answer = `Sou o ${name}. Posso explicar processos, apontar onde ficam as telas e consultar os dados do seu negócio dentro da sua permissão.`;
  }

  return {
    answer,
    intent,
    facts: {
      kind: 'assistant_self_description',
      intent,
      productName: name,
      capabilityCount: capabilities.length,
      privilegedActor: isPrivileged,
    },
    capabilityCount: capabilities.length,
  };
}

module.exports = {
  buildAssistantSelfDescription,
  buildScreenContextAnswer,
  buildSourceFollowUpAnswer,
  buildPriorProvenanceAnswer,
  describeCapabilities,
  describeScreenLabel,
  scopeToolsByTenantCapabilities,
  DEFAULT_PRODUCT_NAME,
  IDENTITY_CORE,
  SOURCE_RULES,
  LIMITATION_RULES,
  PRIVACY_RULES,
  HELP_RULES,
  KNOWLEDGE_SCOPE_RULES,
  KNOWLEDGE_SCOPE_LIMITS,
  ENTITY_LABELS,
  MODULE_LABELS,
};
