'use strict';

/**
 * T-S2 — gate de pertencimento ao mercado: existência ≠ pertencimento.
 * Candidato descoberto só entra no universo quando o CONTEÚDO obtido casa os
 * termos de categoria declarados pela vertical; a identidade é o domínio
 * registrável; hosts declarados como não-mercado (enciclopédia, help center)
 * são rejeitados nominalmente.
 */

const {
  RELEVANCE_STATES,
  registrableDomain,
  matchCategorySignals,
  evaluateMarketRelevance,
} = require('../../../api/services/marketDiscovery/relevance');

const FITNESS_CONTEXT = {
  categoryTerms: [
    'gym management software',
    'fitness studio management platform',
    'gym membership management software',
    'software para academia gestão',
    'sistema de gestão para academias',
    'software para estúdio de pilates e treino funcional',
  ],
  relevance: {
    minCategorySignals: 1,
    excludedHosts: ['wikipedia.org', 'support.google.com'],
  },
};

describe('relevance — domínio registrável (identidade de mercado)', () => {
  test('remove www, colapsa subdomínios e normaliza caixa', () => {
    expect(registrableDomain('https://www.tecnofit.com.br/')).toBe('tecnofit.com.br');
    expect(registrableDomain('https://app.glofox.com/pricing')).toBe('glofox.com');
    expect(registrableDomain('HTTPS://MindBodyOnline.com/')).toBe('mindbodyonline.com');
    expect(registrableDomain('wl.vendor.com')).toBe('vendor.com');
  });

  test('entrada não parseável é null (nunca inventa identidade)', () => {
    expect(registrableDomain('')).toBeNull();
    expect(registrableDomain('nao-e-url')).toBeNull();
    expect(registrableDomain(null)).toBeNull();
  });
});

describe('relevance — sinais de categoria no conteúdo', () => {
  test('casa termo completo ignorando stopwords, caixa e acentos', () => {
    const content = 'O melhor SOFTWARE para ACADEMIA: gestão completa de membros e catraca.';
    const { matchedTerms, signalCount } = matchCategorySignals({
      content,
      categoryTerms: FITNESS_CONTEXT.categoryTerms,
    });
    expect(signalCount).toBeGreaterThanOrEqual(1);
    expect(matchedTerms).toContain('software para academia gestao');
  });

  test('página que só menciona a palavra solta "fitness" NÃO é sinal', () => {
    const { signalCount } = matchCategorySignals({
      content: 'Moda fitness: leggings, tops e acessórios para o seu treino. Frete grátis.',
      categoryTerms: FITNESS_CONTEXT.categoryTerms,
    });
    expect(signalCount).toBe(0);
  });
});

describe('relevance — veredito de pertencimento', () => {
  test('página de fornecedor real da categoria é IN_MARKET', () => {
    const verdict = evaluateMarketRelevance({
      content: 'Gym management software para academias: membros, cobrança recorrente, catraca e app do aluno.',
      url: 'https://fornecedor-gym.com/',
      marketContext: FITNESS_CONTEXT,
    });
    expect(verdict.state).toBe(RELEVANCE_STATES.IN_MARKET);
    expect(verdict.accepted).toBe(true);
    expect(verdict.signalCount).toBeGreaterThanOrEqual(1);
    expect(verdict.domain).toBe('fornecedor-gym.com');
  });

  test('loja de roupa fitness obtida com sucesso é OUT_OF_MARKET', () => {
    const verdict = evaluateMarketRelevance({
      content: 'Roupas fitness e moda esportiva: leggings, tops, frete grátis para todo o Brasil.',
      url: 'https://modafitness.example.com/',
      marketContext: FITNESS_CONTEXT,
    });
    expect(verdict.state).toBe(RELEVANCE_STATES.OUT_OF_MARKET);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('category_signals_below_minimum');
  });

  test('Wikipedia é OUT_OF_MARKET por host excluído declarado (mesmo citando a categoria)', () => {
    const verdict = evaluateMarketRelevance({
      content: 'Gym management software is a category of software. This encyclopedia article...',
      url: 'https://en.wikipedia.org/wiki/Gym_management_software',
      marketContext: FITNESS_CONTEXT,
    });
    expect(verdict.state).toBe(RELEVANCE_STATES.OUT_OF_MARKET);
    expect(verdict.reason).toBe('candidate_host_excluded');
  });

  test('help center do Google é OUT_OF_MARKET por host excluído (subdomínio herda)', () => {
    const verdict = evaluateMarketRelevance({
      content: 'Como usar o Google Fit no seu relógio.',
      url: 'https://support.google.com/fit/answer/1',
      marketContext: FITNESS_CONTEXT,
    });
    expect(verdict.state).toBe(RELEVANCE_STATES.OUT_OF_MARKET);
    expect(verdict.reason).toBe('candidate_host_excluded');
  });

  test('minCategorySignals declarado é honrado (2 sinais exigidos)', () => {
    const strict = { ...FITNESS_CONTEXT, relevance: { minCategorySignals: 2 } };
    const oneSignal = evaluateMarketRelevance({
      content: 'Gym management software. O resto da página fala de outra coisa.',
      url: 'https://x.example.com/',
      marketContext: strict,
    });
    expect(oneSignal.state).toBe(RELEVANCE_STATES.OUT_OF_MARKET);
    expect(oneSignal.minSignals).toBe(2);
    const twoSignals = evaluateMarketRelevance({
      content: 'Gym management software e fitness studio management platform em um só produto.',
      url: 'https://x.example.com/',
      marketContext: strict,
    });
    expect(twoSignals.state).toBe(RELEVANCE_STATES.IN_MARKET);
  });

  test('sem marketContext declarado o veredito é NOT_EVALUABLE (nunca finge medição)', () => {
    const verdict = evaluateMarketRelevance({
      content: 'qualquer coisa',
      url: 'https://x.example.com/',
      marketContext: null,
    });
    expect(verdict.evaluated).toBe(false);
    expect(verdict.state).toBe(RELEVANCE_STATES.NOT_EVALUABLE);
    expect(verdict.reason).toBe('market_context_not_declared');
  });

  test('determinístico: mesmo conteúdo + contexto → mesmo veredito', () => {
    const input = {
      content: 'Gym management software com catraca.',
      url: 'https://a.example.com/',
      marketContext: FITNESS_CONTEXT,
    };
    expect(JSON.stringify(evaluateMarketRelevance(input))).toBe(JSON.stringify(evaluateMarketRelevance(input)));
  });
});
