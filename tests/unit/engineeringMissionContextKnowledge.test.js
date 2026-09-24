'use strict';

/**
 * Contexto profundo de missão + Engineering RAG (§14–§18).
 *
 * O que está sendo protegido aqui:
 *   - o domínio do conhecimento é resolvido pela IDENTIDADE do ator, nunca pelo texto da missão;
 *   - um ator sem acesso a SYSTEM recebe VAZIO com degradação declarada — jamais um fallback para
 *     OPERATIONAL (isso levaria dado de cliente para dentro da decisão de engenharia);
 *   - orçamento é explícito e o que é cortado é REGISTRADO (truncar em silêncio finge contexto
 *     completo);
 *   - indisponibilidade do Knowledge Plane degrada a confiança, não inventa conhecimento.
 */

const context = require('../../api/services/engineeringMission/missionContextService');

describe('Engineering RAG — domínio SYSTEM, orçamento e proveniência', () => {
  test('QUERY_VAZIA: sem texto não há retrieval, e isso é declarado', async () => {
    const out = await context.retrieveEngineeringKnowledge({ query: '   ' });
    expect(out.items).toEqual([]);
    expect(out.degraded).toContain('KNOWLEDGE_QUERY_EMPTY');
    expect(out.budget.usedItems).toBe(0);
  });

  test('SEGREGACAO: ator de classificacao PRODUCTION nao acessa SYSTEM (fail-closed, sem fallback OPERATIONAL)', async () => {
    const out = await context.retrieveEngineeringKnowledge({
      query: 'como o replay governance funciona',
      actorClassification: 'PRODUCTION',
    });
    expect(out.items).toEqual([]);
    expect(out.degraded.some((d) => d.startsWith('KNOWLEDGE_DOMAIN_NOT_AUTHORIZED'))).toBe(true);
    // Nada de conhecimento de outro domínio entra no contexto.
    expect(out.provenance).toEqual([]);
    expect(out.scope).toBeNull();
  });

  test('ORCAMENTO_ITENS: maxItems=0 nao deixa passar nenhum item (e registra o motivo)', async () => {
    const out = await context.retrieveEngineeringKnowledge({
      query: 'lease distribuido fencing token',
      budget: { maxItems: 0 },
    });
    expect(out.items).toEqual([]);
    const declared = [...out.budget.droppedReasons, ...out.degraded];
    expect(declared.join(' ')).toMatch(/BUDGET_ITEMS_EXCEEDED|KNOWLEDGE_NO_RESULTS|KNOWLEDGE_RETRIEVAL_UNAVAILABLE/);
  });

  test('ORCAMENTO_SCORE: minScore inalcancavel nao deixa passar nada relevante', async () => {
    const out = await context.retrieveEngineeringKnowledge({
      query: 'resume task interrupted mission',
      budget: { minScore: 999 },
    });
    expect(out.items).toEqual([]);
    const declared = [...out.budget.droppedReasons, ...out.degraded];
    expect(declared.join(' ')).toMatch(/BELOW_MIN_SCORE|KNOWLEDGE_NO_RESULTS|KNOWLEDGE_RETRIEVAL_UNAVAILABLE/);
  });

  test('DEGRADACAO_DECLARADA: indisponibilidade aparece em degraded, nunca como sucesso vazio', async () => {
    // Qualquer que seja o ambiente, o retorno tem SEMPRE as chaves do contrato (nada de undefined
    // que faria o chamador tratar ausencia como "sem conhecimento relevante").
    const out = await context.retrieveEngineeringKnowledge({ query: 'qualquer coisa' });
    expect(out).toEqual(expect.objectContaining({
      items: expect.any(Array),
      provenance: expect.any(Array),
      degraded: expect.any(Array),
      budget: expect.objectContaining({
        maxItems: expect.any(Number),
        usedItems: expect.any(Number),
        usedChars: expect.any(Number),
        dropped: expect.any(Number),
      }),
    }));
    expect(out.budget.usedItems).toBe(out.items.length);
    // Zero conhecimento SEM declaração seria indistinguível de falha silenciosa.
    if (out.items.length === 0) expect(out.degraded.length).toBeGreaterThan(0);
  });

  test('PROVENIENCIA: cada item aceito tem fonte e hash (sem hash nao ha auditoria)', async () => {
    const out = await context.retrieveEngineeringKnowledge({ query: 'engineering router v2 seal' });
    expect(out.provenance.length).toBe(out.items.length);
    for (const item of out.provenance) {
      expect(item.domain).toBe('SYSTEM');
      expect(typeof item.hash).toBe('string');
      expect(item.hash.length).toBe(64);
    }
  });

  test('CONTEXTO_INTEGRADO: collectContextFacts carrega orcamento e referencias de conhecimento', async () => {
    const result = await context.collectContextFacts({
      originalMission: 'Corrigir o recover de lease expirado no engineering router.',
      contextHints: {},
    });
    expect(result.facts).toHaveProperty('knowledgeBudget');
    expect(result.facts).toHaveProperty('knowledgeRefs');
    expect(result.facts).toHaveProperty('knowledgeItems');
    expect(Array.isArray(result.facts.knowledgeRefs)).toBe(true);
    expect(result.degraded).toEqual(expect.any(Array));
    // O hash de fatos continua sendo produção determinística do contexto coletado.
    expect(typeof result.factsHash).toBe('string');
    expect(result.factsHash.length).toBe(64);
  });
});
