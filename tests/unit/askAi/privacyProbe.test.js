'use strict';

/**
 * MISSÃO ASK_AI_AGENT — T-A1 (sonda de privacidade).
 *
 * RED medido em 2026-09-15: o padrão `/você\s+(tem|possui)\s+acesso\s+a\b/`
 * (intentRouter.js, bloco ASSISTANT_LIMITATIONS) exige `\b` depois de "a" — em
 * "acesso AOS meus dados" o boundary não casa, então a pergunta canônica de
 * privacidade caía em KNOWLEDGE e era enviada ao RAG:
 *
 *   "Você tem acesso aos meus dados?"    → KNOWLEDGE (ia para o RAG)
 *   "você possui acesso aos meus dados?" → KNOWLEDGE
 *
 * Regras fixadas aqui:
 *   1. a sonda de privacidade é ASSISTANT_PRIVACY, respondida por configuração
 *      canônica — nunca por recuperação documental;
 *   2. a resposta descreve o acesso REAL da arquitetura: somente dados do
 *      espaço de trabalho do tenant, dentro da permissão do ator e necessários
 *      à pergunta — nunca "tenho acesso a tudo";
 *   3. a variante "acesso a outros clientes?" permanece ASSISTANT_LIMITATIONS
 *      (pergunta sobre limite, não sobre os dados do próprio usuário).
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

const PRIVACY_PROBES = [
  'Você tem acesso aos meus dados?',
  'Você tem acesso aos meus dados',
  'você possui acesso aos meus dados?',
  'Você possui acesso às minhas informações?',
];

describe('T-A1 — sonda de privacidade classifica como ASSISTANT_PRIVACY', () => {
  it.each(PRIVACY_PROBES)('"%s"', (question) => {
    const result = classifyIntent({ question, classification: 'PRODUCTION' });
    expect(result.intent).toBe(INTENTS.ASSISTANT_PRIVACY);
    expect(result.blocked).toBe(false);
    expect(isAssistantMeta(result.intent)).toBe(true);
    // A garantia operacional: a sonda NÃO consome RAG nem dado vivo.
    expect(needsKnowledge(result.intent)).toBe(false);
    expect(needsOperationalData(result.intent)).toBe(false);
  });

  it('pergunta sobre OUTROS clientes permanece LIMITATIONS (não é privacidade do usuário)', () => {
    const result = classifyIntent({
      question: 'Você tem acesso a outros clientes?',
      classification: 'PRODUCTION',
    });
    expect(result.intent).toBe(INTENTS.ASSISTANT_LIMITATIONS);
  });

  it('sonda de privacidade não é desviada por marcador de dado vivo', () => {
    // "dados" sozinho não é marcador de dado vivo, mas a classificação correta
    // precisa valer mesmo com termos do domínio na frase.
    const result = classifyIntent({
      question: 'Você tem acesso aos meus dados de cobrança?',
      classification: 'PRODUCTION',
    });
    expect(result.intent).toBe(INTENTS.ASSISTANT_PRIVACY);
  });
});

describe('T-A1 — resposta de privacidade reflete a arquitetura real', () => {
  const { answer } = buildAssistantSelfDescription({
    intent: INTENTS.ASSISTANT_PRIVACY,
    availableTools: ['Situação da matrícula'],
    classification: 'PRODUCTION',
  });

  it('declara acesso escopado: tenant, permissão e necessidade da pergunta', () => {
    expect(answer).toMatch(/permiss/i);
    expect(answer).toMatch(/espaço de trabalho/i);
    expect(answer).toMatch(/necess[áa]ri/i);
  });

  it('nunca afirma acesso total nem irrestrito', () => {
    expect(answer).not.toMatch(/acesso\s+a\s+tudo/i);
    expect(answer).not.toMatch(/todos\s+os\s+dados/i);
    expect(answer).not.toMatch(/acesso\s+(?:total|irrestrito|completo)\b/i);
  });

  it('não vaza identificador interno nem mecânica', () => {
    expect(answer).not.toMatch(/toolId|documentId|chunk|tenant_key|rag_/i);
  });
});
