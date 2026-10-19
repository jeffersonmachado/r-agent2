'use strict';

/**
 * Política de saúde do índice RAG — função PURA, extraída do validador
 * (`scripts/governance/validate-rag-index-health.js`).
 *
 * DEFEITO QUE MOTIVA: a regra vivia inline em `main()`, misturada com SQL e com escrita de
 * relatório, então não havia como testá-la. O resultado era uma regra de governança
 * inegociável sem nenhuma prova executável: qualquer mudança no cálculo de `HEALTHY`/`NO_GO`
 * só seria percebida em produção. Aqui a regra é determinística e testável.
 *
 * Não faz I/O: recebe as medições do banco já feitas e devolve violações + status.
 */

const REGRAS = Object.freeze({
  INDEXED_WITHOUT_CHUNKS: 'documento marcado indexed sem chunks: inalcançável pelo retrieval',
  UNDECLARED_FAILED_DOCUMENT: 'documento em failed sem exceção declarada',
  NO_TEXT_DOCUMENT_WITH_CHUNKS: 'documento sem texto com chunks (chunk fantasma)',
  RAG_PLACEHOLDER_SOURCE_DUPLICATED: 'literal do placeholder declarado fora do arquivo autorizado',
  RAG_INDEXING_STUCK: 'documento preso em indexing além da janela',
});

/**
 * @param {Object} m medições
 * @param {Array<{index_status:string,total:number}>} m.byStatus
 * @param {Array<{id:string}>} m.indexedWithoutChunks
 * @param {Array<{id:string,tenant_key?:string|null}>} m.failedDocs
 * @param {Array<{id:string,chunks:number}>} m.noTextWithChunks
 * @param {Array<{id:string}>} m.stuckIndexing
 * @param {Array<{id:string,reason:string,origin:string}>} m.declaredExceptions
 * @param {string[]} m.duplicatedPlaceholderLiterals
 * @param {{stuckIndexingMinutes?:number}} [opcoes]
 * @returns {{status:string, violations:Array<Object>, statusByKey:Object,
 *            staleExceptions:string[], failedUndeclared:string[]}}
 */
function avaliarSaudeDoIndice(m, opcoes = {}) {
  const med = m || {};
  const declared = Array.isArray(med.declaredExceptions) ? med.declaredExceptions : [];
  const failedDocs = Array.isArray(med.failedDocs) ? med.failedDocs : [];
  const indexedWithoutChunks = Array.isArray(med.indexedWithoutChunks) ? med.indexedWithoutChunks : [];
  const noTextWithChunks = Array.isArray(med.noTextWithChunks) ? med.noTextWithChunks : [];
  const stuckIndexing = Array.isArray(med.stuckIndexing) ? med.stuckIndexing : [];
  const duplicatedPlaceholderLiterals = Array.isArray(med.duplicatedPlaceholderLiterals)
    ? med.duplicatedPlaceholderLiterals : [];
  const byStatus = Array.isArray(med.byStatus) ? med.byStatus : [];
  const stuckIndexingMinutes = opcoes.stuckIndexingMinutes;

  // Exceção declarada SEM motivo (ou sem origem) não é exceção: é esconderijo.
  const excecoesValidas = new Set(
    declared
      .filter((e) => e && typeof e.id === 'string' && String(e.reason || '').trim() && String(e.origin || '').trim())
      .map((e) => e.id),
  );
  const declaradasSemJustificativa = declared
    .filter((e) => e && typeof e.id === 'string' && !excecoesValidas.has(e.id))
    .map((e) => e.id);

  const failedUndeclared = failedDocs.filter((row) => !excecoesValidas.has(row.id));
  const staleExceptions = declared
    .filter((e) => e && !failedDocs.some((row) => row.id === e.id))
    .map((e) => e.id);

  const violations = [];

  if (indexedWithoutChunks.length > 0) {
    violations.push({
      code: 'INDEXED_WITHOUT_CHUNKS',
      detail: `${indexedWithoutChunks.length} documento(s) marcados como indexed SEM chunks (documento inalcançável pelo retrieval)`,
      ids: indexedWithoutChunks.slice(0, 10).map((row) => row.id),
    });
  }
  if (failedUndeclared.length > 0) {
    violations.push({
      code: 'UNDECLARED_FAILED_DOCUMENT',
      detail: `${failedUndeclared.length} documento(s) em failed SEM exceção declarada`,
      ids: failedUndeclared.slice(0, 10).map((row) => row.id),
    });
  }
  if (declaradasSemJustificativa.length > 0) {
    violations.push({
      code: 'DECLARED_EXCEPTION_WITHOUT_REASON',
      detail: `${declaradasSemJustificativa.length} exceção(ões) declarada(s) SEM motivo/origem — exceção sem justificativa é esconderijo`,
      ids: declaradasSemJustificativa,
    });
  }
  if (noTextWithChunks.length > 0) {
    violations.push({
      code: 'NO_TEXT_DOCUMENT_WITH_CHUNKS',
      detail: `${noTextWithChunks.length} documento(s) sem texto extraído COM chunks no índice (chunk fantasma — a invariante de conteúdo indexável foi furada)`,
      ids: noTextWithChunks.slice(0, 10).map((row) => row.id),
    });
  }
  if (duplicatedPlaceholderLiterals.length > 0) {
    violations.push({
      code: 'RAG_PLACEHOLDER_SOURCE_DUPLICATED',
      detail: 'placeholder de "sem texto extraído" declarado fora do arquivo autorizado (regra de conteúdo indexável duplicada)',
      files: duplicatedPlaceholderLiterals,
    });
  }
  if (stuckIndexing.length > 0) {
    violations.push({
      code: 'RAG_INDEXING_STUCK',
      detail: `${stuckIndexing.length} documento(s) presos em indexing${Number.isFinite(stuckIndexingMinutes) ? ` há mais de ${stuckIndexingMinutes} min` : ''} (inalcançáveis pelo retrieval; o processo que os marcou morreu) — reindexe pela rota oficial`,
      ids: stuckIndexing.slice(0, 10).map((row) => row.id),
    });
  }

  return {
    status: violations.length === 0 ? 'HEALTHY' : 'NO_GO',
    violations,
    statusByKey: Object.fromEntries(byStatus.map((row) => [row.index_status, row.total])),
    staleExceptions,
    failedUndeclared: failedUndeclared.map((row) => row.id),
  };
}

module.exports = { avaliarSaudeDoIndice, REGRAS };
