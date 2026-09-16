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

  test('tokens ESPALHADOS pela página NÃO são sinal (falso positivo do run real r4)', () => {
    // Reproduz o defeito observado no run real r4 (2026-09-16): um relatório
    // de mercado imobiliário continha "fitness", "club", "management" e
    // "platform" em seções distantes — o casamento bag-of-words aceitou como
    // sinal da categoria. O termo precisa ocorrer numa JANELA local do texto:
    // quem É do mercado declara a categoria junto; quem só cita palavras
    // soltas em contextos diferentes não é.
    const content = [
      'Hospitality market report: the local gym scene grew this year.',
      'In another section, asset management remains the core business of the firm.',
      'Our software division released a new brokerage dashboard this quarter.',
    ].join(' ');
    const { signalCount } = matchCategorySignals({
      content,
      categoryTerms: FITNESS_CONTEXT.categoryTerms,
    });
    expect(signalCount).toBe(0);
  });

  test('redação natural do fornecedor (palavras intercaladas) CONTINUA sinal', () => {
    // "Sistema completo para gestão de academias" é como um fornecedor real
    // escreve — os tokens do termo `sistema de gestão para academias` não são
    // contíguos, mas estão juntos na mesma declaração.
    const { signalCount, matchedTerms } = matchCategorySignals({
      content: 'Sistema completo para gestão de academias: matrículas, cobrança recorrente, catraca e app do aluno.',
      categoryTerms: FITNESS_CONTEXT.categoryTerms,
    });
    expect(signalCount).toBeGreaterThanOrEqual(1);
    expect(matchedTerms).toContain('sistema de gestao para academias');
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

describe('qualidade do registro de candidato (run real r8, 2026-09-16)', () => {
  // O run r8 aceitou vantagefit.io e woliba.io, mas o registro herdou a URL da
  // PÁGINA DE SINAL (blog listicle do próprio fornecedor) como officialSite e o
  // TÍTULO do post como name — officialSite é a raiz do domínio, e a página de
  // sinal fica como evidência de descoberta, nunca como identidade.
  const {
    homepageUrl,
    vendorNameFromHomepageTitle,
    nameFromDomain,
    archetypesFromMatchedTerms,
  } = require('../../../api/services/marketDiscovery/relevance');

  test('homepageUrl canonicaliza qualquer página do domínio para a raiz', () => {
    expect(homepageUrl('https://woliba.io/blog/wellhub-alternatives/')).toBe('https://woliba.io/');
    expect(homepageUrl('https://www.vantagefit.io/alternatives/wellhub-alternatives/')).toBe('https://vantagefit.io/');
    expect(homepageUrl('http://app.tecnofit.com.br/login?x=1')).toBe('http://tecnofit.com.br/');
    expect(homepageUrl('https://alpha-gym.com/')).toBe('https://alpha-gym.com/');
    expect(homepageUrl('não é url')).toBe(null);
    expect(homepageUrl('')).toBe(null);
  });

  test('vendorNameFromHomepageTitle extrai a marca do <title> da homepage', () => {
    expect(vendorNameFromHomepageTitle(
      '<html><head><title>Vantage Fit: Employee Wellness Platform</title></head><body/></html>',
    )).toBe('Vantage Fit');
    expect(vendorNameFromHomepageTitle(
      '<title>Woliba | Corporate Wellness Platform</title>',
    )).toBe('Woliba');
    expect(vendorNameFromHomepageTitle(
      '<title>GymNovo — Sistema de gestão para academias</title>',
    )).toBe('GymNovo');
    // Sem título utilizável: null (o chamador cai para o domínio, nunca inventa).
    expect(vendorNameFromHomepageTitle('<html><body>sem title</body></html>')).toBe(null);
    expect(vendorNameFromHomepageTitle('<title>   </title>')).toBe(null);
    expect(vendorNameFromHomepageTitle('')).toBe(null);
    expect(vendorNameFromHomepageTitle(null)).toBe(null);
  });

  test('nameFromDomain é o fallback determinístico (rótulo do domínio, não invenção)', () => {
    expect(nameFromDomain('vantagefit.io')).toBe('Vantagefit');
    expect(nameFromDomain('woliba.io')).toBe('Woliba');
    expect(nameFromDomain('tecnofit.com.br')).toBe('Tecnofit');
    expect(nameFromDomain(null)).toBe(null);
    expect(nameFromDomain('')).toBe(null);
  });

  test('archetypesFromMatchedTerms mapeia sinais aos arquétipos declarados pela vertical', () => {
    const mapping = {
      'corporate wellness platform': ['personal-wellness'],
      'employee wellness platform': ['personal-wellness'],
      'gym management software': ['independent-gym', 'gym-network'],
    };
    expect(archetypesFromMatchedTerms(['corporate wellness platform'], mapping)).toEqual(['personal-wellness']);
    // União determinística (ordem estável) de vários sinais.
    expect(archetypesFromMatchedTerms(
      ['employee wellness platform', 'gym management software', 'corporate wellness platform'],
      mapping,
    )).toEqual(['gym-network', 'independent-gym', 'personal-wellness']);
    // Sinal sem mapeamento não inventa arquétipo.
    expect(archetypesFromMatchedTerms(['termo desconhecido'], mapping)).toEqual([]);
    expect(archetypesFromMatchedTerms([], mapping)).toEqual([]);
    expect(archetypesFromMatchedTerms(null, mapping)).toEqual([]);
    expect(archetypesFromMatchedTerms(['corporate wellness platform'], null)).toEqual([]);
  });

  test('config REAL da vertical: todo termo de categoria tem mapeamento para arquétipo existente', () => {
    // Sem mapeamento completo, um candidato IN_MARKET ficaria sem arquétipo e o
    // pré-registro do holdout (engine: marketArchetype obrigatório) morreria a
    // jusante. A completude é exigência do contrato, não conveniência.
    const path = require('path');
    const fs = require('fs');
    const sample = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'config', 'benchmarks', 'fitness.json'), 'utf8',
    ));
    const known = new Set(sample.archetypes.map((a) => a.id));
    const mapping = sample.marketContext.categoryTermArchetypes || {};
    const { normalizeTerm } = require('../../../api/services/benchmark/benchmarkResearchSemantics');
    for (const term of sample.marketContext.categoryTerms) {
      const mapped = mapping[normalizeTerm(term)] || mapping[term];
      expect(Array.isArray(mapped)).toBe(true);
      expect(mapped.length).toBeGreaterThan(0);
      for (const id of mapped) expect(known.has(id)).toBe(true);
    }
  });
});
