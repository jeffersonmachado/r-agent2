'use strict';

/**
 * Regra da prova de ingestão do RAG — pura, para poder ser testada.
 *
 * O validador (`scripts/governance/validate-rag-ingestion-proof.js`) só orquestra
 * banco + relatório; a DECISÃO mora aqui, com as duas direções provadas em
 * `tests/unit/ragIngestionProof.test.js`. Sem isso, um gate que nunca falha vira
 * decoração — foi o que aconteceu com a evidência do Ask AI (PASS com o copiloto
 * degradado).
 */

/**
 * @param {object} input
 * @param {{tenantKey: string, domain: string, sources: Array<{id: string, reason?: string}>}} input.canonical
 * @param {Map<string, {domain?: string, classification?: string, indexStatus?: string, chunks?: number}>} input.rowsById
 * @returns {{violations: Array<object>, checked: Array<object>}}
 */
function evaluateCanonicalSources({ canonical, rowsById }) {
  const violations = [];
  const checked = [];
  const expectedDomain = canonical.domain;
  const sources = Array.isArray(canonical.sources) ? canonical.sources : [];

  for (const source of sources) {
    const row = rowsById.get(source.id);
    if (!row) {
      violations.push({
        code: 'RAG_CANONICAL_SOURCE_ABSENT',
        detail: `fonte canônica ausente no banco do tenant ${canonical.tenantKey}: ${source.id}`,
        id: source.id,
        reason: source.reason || null,
      });
      continue;
    }

    if (row.domain !== expectedDomain) {
      violations.push({
        code: 'RAG_CANONICAL_SOURCE_WRONG_SCOPE',
        detail: `${source.id}: domain=${row.domain || '(vazio)'} (esperado ${expectedDomain})`,
        id: source.id,
      });
      continue;
    }

    if (row.indexStatus !== 'indexed') {
      violations.push({
        code: 'RAG_CANONICAL_SOURCE_NOT_INDEXED',
        detail: `${source.id}: index_status=${row.indexStatus || '(vazio)'} — conhecimento declarado indisponível para o copiloto`,
        id: source.id,
      });
      continue;
    }

    if (!Number.isFinite(row.chunks) || row.chunks <= 0) {
      violations.push({
        code: 'RAG_CANONICAL_SOURCE_WITHOUT_CHUNKS',
        detail: `${source.id}: indexado sem chunks (inalcançável pelo retrieval)`,
        id: source.id,
      });
      continue;
    }

    checked.push({
      id: source.id,
      domain: row.domain,
      classification: row.classification || null,
      chunks: row.chunks,
    });
  }

  return { violations, checked };
}

module.exports = { evaluateCanonicalSources };
