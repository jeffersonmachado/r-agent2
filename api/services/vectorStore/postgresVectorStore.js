/**
 * Postgres (pgvector) Vector Store adapter.
 *
 * Fonte única para embeddings/chunks: tabela `rag_chunks`.
 *
 * Convenções do projeto:
 * - multi-tenant via `tenant_key` (obrigatório)
 * - document_id referencia `rag_documents.id`
 */

const { getSequelize } = require('../../db/sequelize');

function requireSequelize() {
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
  }
  return sequelize;
}

function normalizeTenantKey(tenantId) {
  if (tenantId === null || tenantId === undefined) return null;
  const tid = String(tenantId).trim();
  return tid || null;
}

function resolveEmbeddingDim() {
  const raw = process.env.EMBEDDING_DIM || process.env.RAG_EMBEDDING_DIM || '384';
  const dim = parseInt(String(raw), 10);
  return Number.isFinite(dim) && dim > 0 ? dim : 384;
}

function embeddingToPgVectorLiteral(embedding) {
  // pgvector aceita string no formato "[1,2,3]"
  // Mantemos precisão suficiente sem notação científica extrema.
  return `[${embedding.map((n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    // 1e-8 é suficiente; evita strings gigantes
    return String(Math.abs(v) < 1e-8 ? 0 : v);
  }).join(',')}]`;
}

function assertEmbeddingDim(embedding) {
  const dim = resolveEmbeddingDim();
  if (!Array.isArray(embedding) || embedding.length !== dim) {
    const err = new Error(`EMBEDDING_DIM_MISMATCH: esperado ${dim}, recebido ${Array.isArray(embedding) ? embedding.length : 'invalid'}`);
    err.code = 'EMBEDDING_DIM_MISMATCH';
    err.details = { expected: dim, received: Array.isArray(embedding) ? embedding.length : null };
    throw err;
  }
}

async function upsertChunks({ tenantId, documentId, chunks }) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  if (!documentId) throw Object.assign(new Error('documentId é obrigatório'), { code: 'DOCUMENT_ID_REQUIRED' });
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { insertedChunksCount: 0 };
  }

  const sequelize = requireSequelize();
  return await sequelize.transaction(async (t) => {
    // Fluxo consistente de reindex: remove chunks antigos do documento e reinserir
    await sequelize.query(
      `DELETE FROM rag_chunks WHERE tenant_key = :tenantKey AND document_id = :documentId`,
      { replacements: { tenantKey, documentId: String(documentId) }, transaction: t }
    );

    const validChunks = [];
    for (const c of chunks) {
      if (!c || !c.id) continue;
      assertEmbeddingDim(c.embedding);
      validChunks.push(c);
    }

    if (validChunks.length === 0) {
      return { insertedChunksCount: 0 };
    }

    // INSERT multi-row único (1 roundtrip para o batch inteiro), com bind
    // params por linha — sem concatenação de valores.
    const replacements = {};
    const valuesSql = validChunks.map((c, idx) => {
      replacements[`id${idx}`] = String(c.id);
      replacements[`tenantKey${idx}`] = tenantKey;
      replacements[`documentId${idx}`] = String(documentId);
      replacements[`chunkIndex${idx}`] = Number.isFinite(c.chunkIndex) ? c.chunkIndex : 0;
      replacements[`content${idx}`] = String(c.content || '');
      replacements[`embedding${idx}`] = embeddingToPgVectorLiteral(c.embedding);
      replacements[`metadata${idx}`] = JSON.stringify(c.metadata || {});
      replacements[`permissions${idx}`] = JSON.stringify(c.permissions || {});
      return `(:id${idx}, :tenantKey${idx}, :documentId${idx}, :chunkIndex${idx}, :content${idx}, (:embedding${idx})::vector, (:metadata${idx})::jsonb, (:permissions${idx})::jsonb, NOW())`;
    }).join(',\n');

    await sequelize.query(
      `
        INSERT INTO rag_chunks
          (id, tenant_key, document_id, chunk_index, content, embedding, metadata, permissions, created_at)
        VALUES
          ${valuesSql}
        ON CONFLICT (id)
        DO UPDATE SET
          tenant_key = EXCLUDED.tenant_key,
          document_id = EXCLUDED.document_id,
          chunk_index = EXCLUDED.chunk_index,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          permissions = EXCLUDED.permissions
      `,
      { replacements, transaction: t }
    );

    return { insertedChunksCount: validChunks.length };
  });
}

async function similaritySearch({ tenantId, queryEmbedding, topK = 6 }) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  assertEmbeddingDim(queryEmbedding);
  const sequelize = requireSequelize();

  const k = Number.isFinite(topK) ? Math.max(1, Math.min(50, topK)) : 6;
  const q = embeddingToPgVectorLiteral(queryEmbedding);

  const [rows] = await sequelize.query(
    `
      SELECT
        id,
        tenant_key,
        document_id,
        chunk_index,
        content,
        metadata,
        permissions,
        (embedding <=> (:q)::vector) AS distance
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
      ORDER BY embedding <=> (:q)::vector
      LIMIT :k
    `,
    {
      replacements: { tenantKey, q, k },
    }
  );

  return (rows || []).map((r) => {
    const distance = Number(r.distance);
    const score = Number.isFinite(distance) ? Math.max(0, 1 - distance) : 0;
    return {
      id: r.id,
      tenantId: r.tenant_key,
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      metadata: r.metadata || {},
      permissions: r.permissions || {},
      score,
      distance: Number.isFinite(distance) ? distance : null,
    };
  });
}

async function countVectorDocs({ tenantId }) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  const sequelize = requireSequelize();

  const [[chunksRow]] = await sequelize.query(
    `SELECT COUNT(*)::int AS chunks FROM rag_chunks WHERE tenant_key = :tenantKey`,
    { replacements: { tenantKey } }
  );
  const [[docsRow]] = await sequelize.query(
    `SELECT COUNT(DISTINCT document_id)::int AS docs FROM rag_chunks WHERE tenant_key = :tenantKey`,
    { replacements: { tenantKey } }
  );

  return {
    documents: Number(docsRow?.docs || 0),
    chunks: Number(chunksRow?.chunks || 0),
  };
}

async function countChunksByDocument({ tenantId }) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  const sequelize = requireSequelize();

  const [rows] = await sequelize.query(
    `
      SELECT document_id, COUNT(*)::int AS chunks
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
      GROUP BY document_id
    `,
    { replacements: { tenantKey } }
  );

  const map = {};
  for (const r of rows || []) {
    map[String(r.document_id)] = Number(r.chunks || 0);
  }
  return map;
}

async function deleteTenantVectors(tenantId) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  const sequelize = requireSequelize();
  const [res] = await sequelize.query(
    `DELETE FROM rag_chunks WHERE tenant_key = :tenantKey`,
    { replacements: { tenantKey } }
  );
  // res pode variar por dialect; não dependemos do rowCount
  return { success: true };
}

async function deleteDocumentVectors({ tenantId, documentId }) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  if (!documentId) throw Object.assign(new Error('documentId é obrigatório'), { code: 'DOCUMENT_ID_REQUIRED' });
  const sequelize = requireSequelize();
  await sequelize.query(
    `DELETE FROM rag_chunks WHERE tenant_key = :tenantKey AND document_id = :documentId`,
    { replacements: { tenantKey, documentId: String(documentId) } }
  );
  return { success: true };
}

async function deleteOrphanedChunksForTenant(tenantId) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  const sequelize = requireSequelize();
  await sequelize.query(
    `
      DELETE FROM rag_chunks rc
      WHERE rc.tenant_key = :tenantKey
        AND NOT EXISTS (
          SELECT 1 FROM rag_documents rd
          WHERE rd.id = rc.document_id
            AND (rd.tenant_key = rc.tenant_key)
        )
    `,
    { replacements: { tenantKey } }
  );
  return { success: true };
}

async function listOrphanedDocumentIdsForTenant(tenantId, limit = 50000) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  const sequelize = requireSequelize();

  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50000, limit)) : 50000;
  const [rows] = await sequelize.query(
    `
      SELECT DISTINCT rc.document_id
      FROM rag_chunks rc
      LEFT JOIN rag_documents rd
        ON rd.id = rc.document_id
       AND rd.tenant_key = rc.tenant_key
      WHERE rc.tenant_key = :tenantKey
        AND rd.id IS NULL
      LIMIT :limit
    `,
    { replacements: { tenantKey, limit: safeLimit } }
  );

  return (rows || []).map((r) => String(r.document_id)).filter(Boolean);
}

module.exports = {
  resolveEmbeddingDim,
  assertEmbeddingDim,
  upsertChunks,
  similaritySearch,
  countVectorDocs,
  countChunksByDocument,
  deleteTenantVectors,
  deleteDocumentVectors,
  deleteOrphanedChunksForTenant,
  listOrphanedDocumentIdsForTenant,
};

