'use strict';

/**
 * Um buscador que devolve HTTP 200 com página ALHEIA à query não é um resultado
 * vazio: é um backend quebrado — e o pior modo de falha, porque parece sucesso.
 *
 * DEFEITO MEDIDO (2026-09-19). A query `bakery management software` retornou:
 *   - eletricistas de Summerville/SC (uma chamada) e "When I Work" (outra
 *     chamada, mesma query) via provider;
 *   - uma tela de login do Google num fetch CRU do mesmo URL, sem esta camada;
 *   - `login.authorize.net` (gateway de pagamento) no run original;
 *   - DuckDuckGo falhando no transporte (`research_fetch_failed`).
 *
 * Como HTTP 200 + links parseáveis passava por sucesso, o lixo entrava como
 * candidato: a vertical `bakery` avaliou 23 candidatos, rejeitou TODOS por
 * `category_signals_below_minimum` (zero termos de categoria, `minSignals: 1`) e
 * o erro só apareceu no handoff, três camadas adiante, como um 400 genérico.
 *
 * Estes testes fixam o contrato: o conjunto de resultados tem de RESPONDER à
 * query, ou o backend falha com motivo nominal.
 */

const { assessSearchResultRelevance } = require('../../../api/services/research/nativeResearchProvider');

describe('assessSearchResultRelevance — o conjunto responde à query?', () => {
  describe('recusa o lixo REAL medido em 2026-09-19', () => {
    it('eletricistas de Summerville/SC para "bakery management software"', () => {
      const verdict = assessSearchResultRelevance('bakery management software', [
        { title: '24 Hour Emergency Electrician in Summerville , SC 29483', url: 'https://www.electriciansquad.com/summerville-sc/' },
        { title: 'Commercial Electrician Summerville SC | 24/7 Licensed', url: 'https://emergenserve.com/commercial-electrician-summerville-sc' },
      ]);
      expect(verdict.unrelated).toBe(true);
      expect(verdict.matched).toBe(0);
      expect(verdict.evaluated).toBe(2);
      expect(verdict.terms).toEqual(['bakery']);
    });

    it('tela de login do Google (fetch cru, sem nossa camada)', () => {
      const verdict = assessSearchResultRelevance('bakery management software', [
        { title: 'Gmail - Email from Google', url: 'https://accounts.google.com/' },
        { title: 'Sign in - Google Accounts', url: 'https://accounts.google.com/signin' },
      ]);
      expect(verdict.unrelated).toBe(true);
    });

    it('"When I Work" (software de escalas) para a mesma query de padaria', () => {
      const verdict = assessSearchResultRelevance('bakery management software', [
        { title: 'Smarter Employee Scheduling Software | When I Work', url: 'https://wheniwork.com/' },
        { title: 'Team Building Games For Remote Workers', url: 'https://wheniwork.com/blog/virtual-team-building-games' },
      ]);
      expect(verdict.unrelated).toBe(true);
    });

    it('fórum em francês sobre WhatsApp para query veterinária', () => {
      const verdict = assessSearchResultRelevance('veterinary clinic management software', [
        { title: 'forums.commentcamarche.net', url: 'https://forums.commentcamarche.net/forum/whatsapp' },
      ]);
      expect(verdict.unrelated).toBe(true);
    });
  });

  describe('aceita resultado legítimo (sem falso positivo)', () => {
    it('casamento direto de termo', () => {
      const verdict = assessSearchResultRelevance('bakery management software', [
        { title: 'CakeBoss | Bakery POS Software', url: 'https://cakeboss.com/' },
      ]);
      expect(verdict.unrelated).toBe(false);
      expect(verdict.matched).toBe(1);
    });

    it('casamento por radical: "bakery" casa "bakeries"', () => {
      const verdict = assessSearchResultRelevance('bakery management software', [
        { title: 'Best software for bakeries', url: 'https://example.com/bakeries' },
      ]);
      expect(verdict.unrelated).toBe(false);
    });

    it('um único acerto basta, mesmo com a maioria fora do tema', () => {
      const verdict = assessSearchResultRelevance('veterinary clinic management software', [
        { title: 'Notícias de tecnologia', url: 'https://ex.com/news' },
        { title: 'Vetstoria | Veterinary Clinic Software', url: 'https://vetstoria.com/' },
        { title: 'Receitas de bolo', url: 'https://ex.com/bolo' },
      ]);
      expect(verdict.unrelated).toBe(false);
      expect(verdict.matched).toBe(1);
      expect(verdict.evaluated).toBe(3);
    });

    it('query em português, com acentos removidos na comparação', () => {
      const verdict = assessSearchResultRelevance('software para padaria gestão de produção', [
        { title: 'Sistema para Padaria - Controle de Produção', url: 'https://ex.com/padaria' },
      ]);
      expect(verdict.unrelated).toBe(false);
      expect(verdict.terms).toEqual(['padaria', 'producao']);
    });

    it('a query define os termos: "software" sozinho não é termo significativo', () => {
      const verdict = assessSearchResultRelevance('software', [
        { title: 'Qualquer coisa', url: 'https://x.com/' },
      ]);
      expect(verdict.unrelated).toBe(false);
      expect(verdict.terms).toEqual([]);
    });

    it('não recusa quando não há como decidir — recusar por ambiguidade seria forçar verde', () => {
      const semTermo = assessSearchResultRelevance('management software', [
        { title: 'Qualquer coisa', url: 'https://x.com/' },
      ]);
      expect(semTermo.unrelated).toBe(false);
      expect(semTermo.decidable).toBe(false);

      const semCandidato = assessSearchResultRelevance('bakery management software', []);
      expect(semCandidato.unrelated).toBe(false);
      expect(semCandidato.decidable).toBe(false);
      expect(semCandidato.evaluated).toBe(0);
    });
  });

  it('é pura: não muta a entrada', () => {
    const candidates = Object.freeze([
      Object.freeze({ title: 'Bakery POS', url: 'https://x.com/' }),
    ]);
    expect(() => assessSearchResultRelevance('bakery management software', candidates)).not.toThrow();
  });
});
