'use strict';

/**
 * Não-vacuidade da prova de ingestão do RAG.
 *
 * O gate existe porque o manifesto de sync já declarou ~436 arquivos
 * sincronizados com o banco vazio (2026-09-11) e nada reprovou. Um gate que não
 * consegue falhar repetiria exatamente esse furo — aqui cada modo de falha tem
 * teste.
 */

const { evaluateCanonicalSources } = require('../../scripts/governance/lib/ragCanonicalSources');

const CANONICAL = {
  tenantKey: 'system',
  domain: 'OPERATIONAL',
  sources: [
    { id: 'src-docs-manual-verticals-fitness-html', reason: 'manual de verticais' },
    { id: 'src-docs-roteiros-jornada-fitness-fitness-new-customer-md', reason: 'roteiro de matrícula' },
  ],
};

function rows(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

const OK_ROW = (id) => ({ id, domain: 'OPERATIONAL', classification: 'PRODUCTION', indexStatus: 'indexed', chunks: 14 });

describe('ragIngestionProof — prova de ingestão no banco', () => {
  test('todas as fontes presentes e indexadas PASSAM', () => {
    const { violations, checked } = evaluateCanonicalSources({
      canonical: CANONICAL,
      rowsById: rows([OK_ROW(CANONICAL.sources[0].id), OK_ROW(CANONICAL.sources[1].id)]),
    });
    expect(violations).toEqual([]);
    expect(checked.map((c) => c.id)).toHaveLength(2);
  });

  test('fonte ausente (o caso do corpus vazio) REPROVA', () => {
    const { violations } = evaluateCanonicalSources({
      canonical: CANONICAL,
      rowsById: rows([OK_ROW(CANONICAL.sources[0].id)]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('RAG_CANONICAL_SOURCE_ABSENT');
    expect(violations[0].id).toBe(CANONICAL.sources[1].id);
  });

  test('documento em escopo errado REPROVA', () => {
    const { violations } = evaluateCanonicalSources({
      canonical: CANONICAL,
      rowsById: rows([
        OK_ROW(CANONICAL.sources[0].id),
        { ...OK_ROW(CANONICAL.sources[1].id), domain: 'SYSTEM' },
      ]),
    });
    expect(violations.map((v) => v.code)).toEqual(['RAG_CANONICAL_SOURCE_WRONG_SCOPE']);
  });

  test('documento não indexado REPROVA (failed/duplicate/pending)', () => {
    for (const indexStatus of ['failed', 'not_indexed_duplicate', 'not_applicable_no_text', 'pending']) {
      const { violations } = evaluateCanonicalSources({
        canonical: CANONICAL,
        rowsById: rows([
          OK_ROW(CANONICAL.sources[0].id),
          { ...OK_ROW(CANONICAL.sources[1].id), indexStatus },
        ]),
      });
      expect(violations.map((v) => v.code)).toEqual(['RAG_CANONICAL_SOURCE_NOT_INDEXED']);
    }
  });

  test('indexado SEM chunks REPROVA (documento inalcançável)', () => {
    const { violations } = evaluateCanonicalSources({
      canonical: CANONICAL,
      rowsById: rows([
        OK_ROW(CANONICAL.sources[0].id),
        { ...OK_ROW(CANONICAL.sources[1].id), chunks: 0 },
      ]),
    });
    expect(violations.map((v) => v.code)).toEqual(['RAG_CANONICAL_SOURCE_WITHOUT_CHUNKS']);
  });

  test('a config REAL do repositório é válida e não vazia', () => {
    // eslint-disable-next-line global-require
    const real = require('../../config/rag-canonical-knowledge.json');
    expect(real.tenantKey).toBeTruthy();
    expect(real.domain).toBe('OPERATIONAL');
    expect(Array.isArray(real.sources)).toBe(true);
    expect(real.sources.length).toBeGreaterThanOrEqual(5);
    for (const source of real.sources) {
      expect(typeof source.id).toBe('string');
      expect(source.id.length).toBeGreaterThan(0);
      expect(source.reason).toBeTruthy();
    }
    // ids duplicados tornariam a prova ambígua.
    const ids = real.sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
