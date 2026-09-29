function toDbPayload(doc) {
  const payload = {
    id: doc.id,
    tenant_key: doc.tenantId || null,
    title: doc.title || null,
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {},
    permissions: doc.permissions && typeof doc.permissions === 'object' ? doc.permissions : {},
    domain: doc.domain || 'OPERATIONAL',
    classification: doc.classification || 'PRODUCTION',
    sensitivity: doc.sensitivity || 'INTERNAL',
    status: doc.status || 'active',
    indexed: !!doc.indexed,
    indexed_at: doc.indexedAt ? new Date(doc.indexedAt) : null,
    chunks_count: Number.isFinite(doc.chunksCount) ? doc.chunksCount : 0,
    index_status: doc.indexStatus || (doc.indexed ? 'indexed' : 'pending'),
    index_error_code: doc.indexErrorCode || null,
    index_error_message: doc.indexErrorMessage || null,
    last_index_attempt_at: doc.lastIndexAttemptAt ? new Date(doc.lastIndexAttemptAt) : null,
    inconsistent: !!doc.inconsistent,
    inconsistent_reason: doc.inconsistentReason || null,
  };
  // Cache leve: docs sem content carregado (undefined) não devem sobrescrever
  // a coluna content no DB — omite o campo do payload nesse caso.
  if (doc.content !== undefined) {
    payload.content = doc.content || null;
  }
  return payload;
}

function fromDbRow(row) {
  const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
  const doc = {
    id: base.id,
    tenantId: base.tenant_key || null,
    title: base.title || 'Sem título',
    metadata: base.metadata || {},
    permissions: base.permissions || {},
    domain: base.domain || 'OPERATIONAL',
    classification: base.classification || 'PRODUCTION',
    sensitivity: base.sensitivity || 'INTERNAL',
    status: base.status || 'active',
    indexed: !!base.indexed,
    indexedAt: base.indexed_at ? new Date(base.indexed_at).toISOString() : null,
    chunksCount: Number.isFinite(base.chunks_count) ? base.chunks_count : 0,
    indexStatus: base.index_status || (base.indexed ? 'indexed' : 'pending'),
    indexErrorCode: base.index_error_code || null,
    indexErrorMessage: base.index_error_message || null,
    lastIndexAttemptAt: base.last_index_attempt_at ? new Date(base.last_index_attempt_at).toISOString() : null,
    inconsistent: !!base.inconsistent,
    inconsistentReason: base.inconsistent_reason || null,
  };
  // Só carrega content quando a coluna foi selecionada (cache leve omite).
  if (base.content !== undefined) {
    doc.content = base.content || '';
  }
  return doc;
}

function setIndexState(doc, state, opts = {}) {
  const nowIso = new Date().toISOString();
  doc.indexStatus = state;
  doc.lastIndexAttemptAt = opts.lastIndexAttemptAt || nowIso;

  if (state === 'pending') {
    doc.indexed = false;
    doc.indexedAt = null;
    doc.chunksCount = 0;
    doc.indexErrorCode = null;
    doc.indexErrorMessage = null;
    doc.inconsistent = false;
    doc.inconsistentReason = null;
    return;
  }

  if (state === 'indexed') {
    doc.indexed = true;
    doc.indexedAt = opts.indexedAt || nowIso;
    doc.chunksCount = Number.isFinite(opts.chunksCount) ? opts.chunksCount : (doc.chunksCount || 0);
    doc.indexErrorCode = null;
    doc.indexErrorMessage = null;
    doc.inconsistent = false;
    doc.inconsistentReason = null;
    return;
  }

  if (state === 'indexing') {
    // Nao altera indexed aqui; so marca indexed apos confirmacao (chunks > 0)
    doc.indexErrorCode = null;
    doc.indexErrorMessage = null;
    return;
  }

  if (state === 'failed') {
    doc.indexed = false;
    doc.indexedAt = null;
    doc.chunksCount = 0;
    doc.indexErrorCode = opts.errorCode || 'RAG_INDEX_FAILED';
    doc.indexErrorMessage = opts.errorMessage || 'Falha ao indexar no vector store';
    return;
  }

  if (state === 'not_indexed_duplicate') {
    // ESTADO PRÓPRIO para "0 chunks por DEDUPLICAÇÃO" (missão 2026-09-28).
    //
    // Defeito real medido: o rag-service descarta chunks com similaridade > 0.97 (deduplicação
    // intencional) e o resultado era registrado como `failed` com
    // `RAG_INDEX_FAILED: "Indexação retornou 0 chunks"`. Isso fazia (a) o operador caçar um erro
    // que não existe, (b) o cenário de QA parecer defeito de produto e (c) o corpus acumular
    // "falhas" que nunca são falhas. Descartar quase-duplicado é COMPORTAMENTO CORRETO: o estado
    // correto é declarar que o documento não foi ingerido DUPLICADO, não que falhou.
    //
    // Não é sucesso (nada foi ingerido, `indexed=false`) e não é falha: é terminal e não conta
    // como problema de saúde do índice (`isIndexFailure` devolve false).
    doc.indexed = false;
    doc.indexedAt = null;
    doc.chunksCount = 0;
    doc.indexErrorCode = opts.errorCode || 'RAG_NOT_INDEXED_DUPLICATE';
    doc.indexErrorMessage = opts.errorMessage
      || 'Conteúdo descartado por deduplicação (similaridade acima do limiar); não foi ingerido no vector store';
    doc.inconsistent = false;
    doc.inconsistentReason = null;
  }
}

/** Estados possíveis da máquina de indexação (fonte única para consumidores). */
const INDEX_STATES = Object.freeze(['pending', 'indexing', 'indexed', 'failed', 'not_indexed_duplicate']);

/**
 * O estado representa PROBLEMA de indexação? `not_indexed_duplicate` NÃO representa: é descarte
 * intencional por deduplicação. Usado por health/consistência para não transformar deduplicação em
 * falha (o defeito que originou este estado).
 */
function isIndexFailure(state) {
  return String(state || '') === 'failed';
}

module.exports = {
  toDbPayload,
  fromDbRow,
  setIndexState,
  INDEX_STATES,
  isIndexFailure,
};
