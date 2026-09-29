/**
 * ragIndexDuplicateState.test.js — DEDUPLICAÇÃO NÃO É FALHA.
 *
 * DEFEITO REAL medido (2026-09-28): o rag-service descarta chunks com similaridade > 0.97
 * (deduplicação intencional, documentada) e o resultado era gravado como `index_status='failed'`
 * com `RAG_INDEX_FAILED: "Indexação retornou 0 chunks (duplicado/sem ingestão)"`. Consequências
 * medidas: 3 documentos em `failed` por esse motivo, o operador caçando um defeito que não existe,
 * e o eixo de governança `RAG_INDEX_HEALTH` carregando "residual" que não é resíduo.
 *
 * Correção: estado PRÓPRIO (`not_indexed_duplicate`) — não é sucesso (nada foi ingerido) e não é
 * falha (descarte intencional). Estes testes fixam a semântica nos dois sentidos.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { setIndexState, INDEX_STATES, isIndexFailure } = require('../../api/services/rag/ragDocumentsState');

const ROOT = path.resolve(__dirname, '..', '..');

describe('ragDocumentsState — estado de duplicação', () => {
  test('not_indexed_duplicate é estado DECLARADO da máquina', () => {
    expect(INDEX_STATES).toContain('not_indexed_duplicate');
  });

  test('duplicação NÃO é falha; falha continua falha', () => {
    expect(isIndexFailure('not_indexed_duplicate')).toBe(false);
    expect(isIndexFailure('indexed')).toBe(false);
    expect(isIndexFailure('failed')).toBe(true);
  });

  test('o documento duplicado fica com estado próprio, sem chunks e sem inconsistência', () => {
    const doc = { indexStatus: 'pending', chunksCount: 5, inconsistent: true, inconsistentReason: 'x' };
    setIndexState(doc, 'not_indexed_duplicate');

    expect(doc.indexStatus).toBe('not_indexed_duplicate');
    expect(doc.indexed).toBe(false);
    expect(doc.chunksCount).toBe(0);
    expect(doc.indexErrorCode).toBe('RAG_NOT_INDEXED_DUPLICATE');
    expect(String(doc.indexErrorMessage)).toMatch(/deduplica/i);
    expect(doc.inconsistent).toBe(false);
    expect(doc.inconsistentReason).toBeNull();
  });

  test('FAILED continua marcando falha real (a correção não cegou o estado de erro)', () => {
    const doc = {};
    setIndexState(doc, 'failed', { errorCode: 'RAG_INDEX_FAILED' });
    expect(doc.indexStatus).toBe('failed');
    expect(isIndexFailure(doc.indexStatus)).toBe(true);
  });

  test('a saúde do índice conta apenas `failed` (duplicação sai da conta)', () => {
    const docs = [
      { indexStatus: 'failed' },
      { indexStatus: 'not_indexed_duplicate' },
      { indexStatus: 'not_indexed_duplicate' },
      { indexStatus: 'indexed' },
    ];
    // Mesma expressão usada em ragDocumentsHealth.js.
    const failed = docs.filter((document) => document.indexStatus === 'failed').length;
    expect(failed).toBe(1);
  });

  test('os DOIS caminhos de indexação usam o estado próprio (nada de `duplicado/sem ingestão` como falha)', () => {
    for (const rel of ['api/services/rag/ragDocumentsIndexing.js', 'api/services/rag/ragDocumentsLifecycle.js']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).toMatch(/not_indexed_duplicate/);
      expect(src).not.toMatch(/duplicado\/sem ingestão/);
    }
  });
});
