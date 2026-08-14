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
  }
}

module.exports = {
  toDbPayload,
  fromDbRow,
  setIndexState,
};
