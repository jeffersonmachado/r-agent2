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
 * @returns {{answer: string, intent: string, facts: Object, capabilityCount: number}}
 */
function buildAssistantSelfDescription({
  intent,
  productName = DEFAULT_PRODUCT_NAME,
  availableTools = [],
  classification = 'PRODUCTION',
} = {}) {
  const capabilities = describeCapabilities(availableTools);
  const name = String(productName || DEFAULT_PRODUCT_NAME).trim() || DEFAULT_PRODUCT_NAME;
  const isPrivileged = classification === 'SUPPORT' || classification === 'DEVELOPMENT';

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
    case INTENTS.ASSISTANT_CAPABILITIES:
      answer = `Com o seu acesso atual, eu:\n\n${bullets(capabilities)}`;
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
  describeCapabilities,
  DEFAULT_PRODUCT_NAME,
  IDENTITY_CORE,
  SOURCE_RULES,
  LIMITATION_RULES,
  PRIVACY_RULES,
  HELP_RULES,
};
