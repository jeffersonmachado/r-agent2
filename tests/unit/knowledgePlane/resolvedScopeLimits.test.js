'use strict';

/**
 * LIMITES DE RECUPERAÇÃO NO ESCOPO — contrato corrigido.
 *
 * ACHADO REAL (2026-09-25): `createResolvedScope` define `collections` como uma LISTA de coleções
 * (`[...(collections || [])]`), mas o consumidor lia `knowledgeScope.collections?.maxResults` e
 * `.minScore` — propriedades de um objeto de configuração que NUNCA existiu ali. Em JavaScript,
 * acessar propriedade inexistente em array devolve `undefined`, então:
 *
 *   - `minScore` era SEMPRE `undefined` ⇒ o serviço RAG aplicava o próprio default (0.5) e
 *     descartava praticamente todo o corpus de engenharia (scores típicos 0.28–0.35);
 *   - `maxResults` caía nos fallbacks fixos (10 e 6);
 *   - NÃO HAVIA ONDE PASSAR o piso de relevância: o defeito era de contrato, não de configuração.
 *
 * Medido de ponta a ponta depois da correção: com os roles corretos, o enriquecimento passou de
 * 0 para 6 itens com conteúdo.
 *
 * Este teste fixa o contrato para o defeito não voltar.
 */

const { createResolvedScope } = require('../../../src/core/knowledge-plane/knowledge-router');

function scope(extra = {}) {
  return createResolvedScope({
    domain: 'SYSTEM',
    classifications: ['DEVELOPMENT'],
    knowledgeTypes: ['SEMANTIC'],
    policy: { retrievalPurpose: null },
    reason: 'teste',
    ...extra,
  });
}

describe('createResolvedScope — limites de recuperação', () => {
  it('`collections` é LISTA (não objeto de configuração) e por isso não carrega maxResults', () => {
    const resolvido = scope({ collections: ['docs', 'handbook'] });
    expect(Array.isArray(resolvido.collections)).toBe(true);
    expect(resolvido.collections).toEqual(['docs', 'handbook']);
    // A propriedade não existe: foi exatamente essa leitura que devolvia undefined em silêncio.
    expect(resolvido.collections.maxResults).toBeUndefined();
    expect(resolvido.collections.minScore).toBeUndefined();
  });

  it('os limites vivem em `limits`, com defaults declarados', () => {
    const resolvido = scope();
    expect(resolvido.limits).toBeTruthy();
    expect(resolvido.limits.maxResults).toBe(10);
    // `minScore: null` significa "não sobrescrever o default do serviço" — estado explícito,
    // não um undefined que ninguém consegue distinguir de bug.
    expect(resolvido.limits.minScore).toBeNull();
  });

  it('o piso de relevância INFORMADO chega ao escopo (antes não havia onde passá-lo)', () => {
    const resolvido = scope({ limits: { minScore: 0.05, maxResults: 3 } });
    expect(resolvido.limits.minScore).toBe(0.05);
    expect(resolvido.limits.maxResults).toBe(3);
  });

  it('limites parciais não apagam os defaults', () => {
    const resolvido = scope({ limits: { minScore: 0.2 } });
    expect(resolvido.limits.minScore).toBe(0.2);
    expect(resolvido.limits.maxResults).toBe(10);
  });

  it('o escopo é imutável e válido para o guard interno', () => {
    const resolvido = scope({ limits: { minScore: 0.1 } });
    expect(Object.isFrozen(resolvido)).toBe(true);
    expect(Object.isFrozen(resolvido.limits)).toBe(true);
    expect(resolvido._internal).toBe(true);
    expect(() => { resolvido.limits.minScore = 0.9; }).toThrow();
  });

  it('escopo sem `limits` continua construível (retrocompatível com chamadores antigos)', () => {
    const resolvido = createResolvedScope({
      domain: 'OPERATIONAL',
      classifications: ['PRODUCTION'],
      knowledgeTypes: ['SEMANTIC'],
      collections: [],
      policy: {},
      reason: 'sem limits',
    });
    expect(resolvido.limits.maxResults).toBe(10);
    expect(resolvido.limits.minScore).toBeNull();
  });
});
