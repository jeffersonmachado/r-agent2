'use strict';

/**
 * Regra única de "conteúdo indexável" do RAG.
 *
 * Defeito medido em 2026-10-08: documento sem texto extraído recebia o
 * placeholder como CONTEÚDO e era indexado, virando "chunk fantasma" que
 * pontuava alto e aparecia como FONTE do copiloto (um `.jpeg` sem OCR foi a 1ª
 * fonte de "Como faço uma matrícula?", score 0.70, à frente dos manuais).
 *
 * A regra vive num módulo só — a duplicação (ingestão gravava, indexador
 * aceitava) foi o que deixou o defeito entrar pelos dois lados.
 */

const {
  NO_TEXT_PLACEHOLDER,
  hasIndexableContent,
  isPlaceholderOnlyContent,
} = require('../../api/services/rag/indexableContent');

describe('indexableContent — o que pode ser embeddado', () => {
  test('texto vazio ou ausente não é indexável', () => {
    expect(hasIndexableContent('')).toBe(false);
    expect(hasIndexableContent('   \n  ')).toBe(false);
    expect(hasIndexableContent(undefined)).toBe(false);
    expect(hasIndexableContent(null)).toBe(false);
    expect(hasIndexableContent(42)).toBe(false);
  });

  test('placeholder de upload não é indexável', () => {
    expect(hasIndexableContent(NO_TEXT_PLACEHOLDER)).toBe(false);
    expect(isPlaceholderOnlyContent(NO_TEXT_PLACEHOLDER)).toBe(true);
    // Variação de caixa/acento não pode furar a regra.
    expect(hasIndexableContent('sem texto extraído. indexando metadados do arquivo.')).toBe(false);
    expect(hasIndexableContent('Sem texto extraido. Indexando metadados do arquivo.')).toBe(false);
    expect(hasIndexableContent(`  ${NO_TEXT_PLACEHOLDER}  `)).toBe(false);
  });

  test('placeholders de outros caminhos também não são indexáveis', () => {
    expect(hasIndexableContent('Sem texto extraído. Indexando metadados do site.')).toBe(false);
    expect(hasIndexableContent('Não foi possível extrair conteúdo automaticamente do arquivo.')).toBe(false);
    expect(hasIndexableContent('[Arquivo: contrato.pdf] Não foi possível extrair conteúdo.')).toBe(false);
  });

  test('conteúdo real continua indexável (controle)', () => {
    const real = 'Para matricular um aluno: cadastre os dados, registre o pagamento e libere o acesso.';
    expect(hasIndexableContent(real)).toBe(true);
    expect(isPlaceholderOnlyContent(real)).toBe(false);
    // Documento real que MENCIONA o placeholder segue indexável: a regra é sobre
    // o documento ser SÓ o placeholder, não sobre conter a frase.
    expect(hasIndexableContent(`Runbook: quando a extração falha, o sistema grava "${NO_TEXT_PLACEHOLDER}".`)).toBe(true);
  });
});
