'use strict';

/**
 * TAREFAS 04-20 — perguntas sobre o próprio assistente.
 *
 * RED medido antes do fix: `classifyIntent({ question: 'Quem é você?' })`
 * devolvia `KNOWLEDGE` e `needsKnowledge(intent) === true` — a pergunta ia para
 * o RAG. O mesmo para "O que você pode fazer?", "Quais são seus limites?",
 * "De onde vêm suas respostas?" e "Meus dados estão seguros?".
 *
 * Estes testes fixam as duas garantias que importam:
 *   1. a pergunta é reconhecida como auto-descrição e NÃO exige recuperação;
 *   2. a resposta vem de configuração canônica — sem fornecedor/modelo, sem
 *      identificador interno, sem prometer capacidade que o ator não tem.
 */

const {
  classifyIntent,
  isAssistantMeta,
  needsKnowledge,
  needsOperationalData,
  INTENTS,
} = require('../../../api/services/askAi/intentRouter');
const {
  buildAssistantSelfDescription,
} = require('../../../api/services/askAi/assistantSelfDescription');

const META_CASES = [
  ['Quem é você?', INTENTS.ASSISTANT_IDENTITY],
  ['Você é um robô ou uma pessoa?', INTENTS.ASSISTANT_IDENTITY],
  ['Qual é o seu nome?', INTENTS.ASSISTANT_IDENTITY],
  ['O que você pode fazer?', INTENTS.ASSISTANT_CAPABILITIES],
  ['Quais são suas funções?', INTENTS.ASSISTANT_CAPABILITIES],
  ['Você consegue consultar a frequência dos alunos?', INTENTS.ASSISTANT_CAPABILITIES],
  ['O que você não pode fazer?', INTENTS.ASSISTANT_LIMITATIONS],
  ['Quais são seus limites?', INTENTS.ASSISTANT_LIMITATIONS],
  ['Você tem acesso a outros clientes?', INTENTS.ASSISTANT_LIMITATIONS],
  ['De onde vêm suas respostas?', INTENTS.ASSISTANT_SOURCES],
  ['Quais fontes você usa?', INTENTS.ASSISTANT_SOURCES],
  ['Meus dados estão seguros?', INTENTS.ASSISTANT_PRIVACY],
  ['Quem pode ver minhas perguntas?', INTENTS.ASSISTANT_PRIVACY],
  ['Como eu uso você?', INTENTS.ASSISTANT_HELP],
];

describe('intentRouter — auto-descrição do assistente', () => {
  it.each(META_CASES)('classifica "%s" como %s', (question, expected) => {
    const result = classifyIntent({ question, classification: 'PRODUCTION' });
    expect(result.intent).toBe(expected);
    expect(result.blocked).toBe(false);
    expect(result.signals).toContain('assistant_meta_marker');
    expect(isAssistantMeta(result.intent)).toBe(true);
  });

  it('não exige conhecimento nem dado vivo (é a garantia de não gastar RAG/DB)', () => {
    for (const [question] of META_CASES) {
      const { intent } = classifyIntent({ question, classification: 'PRODUCTION' });
      expect(needsKnowledge(intent)).toBe(false);
      expect(needsOperationalData(intent)).toBe(false);
    }
  });

  it('não sequestra pergunta de negócio só por conter "posso fazer"', () => {
    // A pergunta é sobre a operação, não sobre o assistente: continua no domínio.
    const procedure = classifyIntent({
      question: 'Como faço para cadastrar um aluno novo?',
      classification: 'PRODUCTION',
    });
    expect(procedure.intent).toBe(INTENTS.PROCEDURE);

    const navigation = classifyIntent({
      question: 'Onde encontro o cadastro de alunos?',
      classification: 'PRODUCTION',
    });
    expect(navigation.intent).toBe(INTENTS.NAVIGATION_HELP);

    const live = classifyIntent({
      question: 'Qual foi a última visita da aluna Maria?',
      classification: 'PRODUCTION',
    });
    expect(live.intent).toBe(INTENTS.OPERATIONAL_DATA);
  });

  it('pergunta sobre assistente não é bloqueada como internals técnicos', () => {
    const result = classifyIntent({
      question: 'O que você pode fazer nesta tela de QA Waves?',
      classification: 'PRODUCTION',
    });
    // O pedido é sobre o assistente; a menção técnica não deve virar SYSTEM.
    expect(isAssistantMeta(result.intent)).toBe(true);
    expect(result.blocked).toBe(false);
  });
});

describe('assistantSelfDescription — texto canônico, sem vazamento', () => {
  const build = (intent, extra = {}) => buildAssistantSelfDescription({
    intent,
    availableTools: ['última visita do aluno', 'situação financeira'],
    classification: 'PRODUCTION',
    ...extra,
  });

  const FORBIDDEN = [
    'gpt', 'openai', 'anthropic', 'claude', 'llama', 'mistral', 'gemini',
    'deepseek', 'llm', 'token', 'prompt do sistema', 'modelo de linguagem',
  ];
  const ALL_INTENTS = Object.values(INTENTS).filter((intent) => isAssistantMeta(intent));

  it('nenhuma resposta revela fornecedor, modelo ou mecânica interna', () => {
    for (const intent of ALL_INTENTS) {
      const { answer } = build(intent);
      for (const term of FORBIDDEN) {
        expect(answer.toLowerCase()).not.toContain(term);
      }
    }
  });

  it('nenhuma resposta vaza identificador interno ou rota de engenharia', () => {
    for (const intent of ALL_INTENTS) {
      const { answer } = build(intent);
      expect(answer).not.toMatch(/toolId|documentId|chunk|qa-mesh|qa-waves|\/dev\//i);
    }
  });

  it('capacidades citam as ferramentas autorizadas de fato', () => {
    const { answer, facts } = build(INTENTS.ASSISTANT_CAPABILITIES);
    expect(answer).toContain('última visita do aluno');
    expect(answer).toContain('situação financeira');
    expect(facts.capabilityCount).toBeGreaterThan(0);
  });

  it('sem ferramentas autorizadas não promete consulta a dado vivo', () => {
    const { answer } = build(INTENTS.ASSISTANT_CAPABILITIES, { availableTools: [] });
    expect(answer).toMatch(/quando a sua permissão incluir/i);
    expect(answer).not.toMatch(/consulto, no momento da pergunta/i);
  });

  it('não menciona engenharia interna para ator PRODUCTION', () => {
    for (const intent of ALL_INTENTS) {
      const { answer } = build(intent, { classification: 'PRODUCTION' });
      expect(answer.toLowerCase()).not.toContain('engenharia interna');
    }
  });

  it('identidade não inventa nome de produto quando não recebe um', () => {
    const { answer, facts } = build(INTENTS.ASSISTANT_IDENTITY);
    expect(answer).toContain(facts.productName);
    expect(answer).not.toMatch(/undefined|null/i);
  });

  it('intenção desconhecida devolve texto seguro em vez de string vazia', () => {
    const { answer } = build('INTENT_INEXISTENTE');
    expect(answer.length).toBeGreaterThan(40);
  });
});
