'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const ragService = require('./ragService');

function resolveEmbeddingDim() {
  const raw = process.env.EMBEDDING_DIM || process.env.RAG_EMBEDDING_DIM || '384';
  const dim = parseInt(String(raw), 10);
  return Number.isFinite(dim) && dim > 0 ? dim : 384;
}

function embeddingToPgVectorLiteral(embedding) {
  return `[${embedding.map((n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return String(Math.abs(v) < 1e-8 ? 0 : v);
  }).join(',')}]`;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

async function generateEmbedding(text, tenantId) {
  const out = await ragService.generateEmbeddingsBatch([String(text)], tenantId, { timeoutMs: 15000 });
  if (!out?.success || !Array.isArray(out.embeddings) || !Array.isArray(out.embeddings[0])) {
    return null;
  }
  const emb = out.embeddings[0];
  const dim = resolveEmbeddingDim();
  if (!Array.isArray(emb) || emb.length !== dim) return null;
  return emb;
}

async function indexMemoryEntry({
  tenantId,
  ticketId,
  conversationId = null,
  sourceType = 'ticket_message',
  sourceId = null,
  content,
  metadata = {},
}) {
  if (!tenantId || !ticketId) return null;
  const text = String(content || '').trim();
  if (!text) return null;

  const sequelize = getSequelize();
  if (!sequelize) return null;

  try {
    const embedding = await generateEmbedding(text, tenantId);
    if (!embedding) return null;

    const vectorLiteral = embeddingToPgVectorLiteral(embedding);
    const id = newId('cmem');

    await sequelize.query(
      `
        INSERT INTO conversation_memory_embeddings
          (id, tenant_key, ticket_id, conversation_id, source_type, source_id, content, embedding, metadata_json, created_at, updated_at)
        VALUES
          (:id, :tenantKey, :ticketId, :conversationId, :sourceType, :sourceId, :content, (:embedding)::vector, :metadataJson, NOW(), NOW())
      `,
      {
        replacements: {
          id,
          tenantKey: String(tenantId),
          ticketId: String(ticketId),
          conversationId: conversationId ? String(conversationId) : null,
          sourceType: String(sourceType || 'ticket_message'),
          sourceId: sourceId ? String(sourceId) : null,
          content: text,
          embedding: vectorLiteral,
          metadataJson: JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
        },
      }
    );

    return { id };
  } catch (err) {
    logger.debug('[ConversationMemory] Falha ao indexar memória (best-effort)', {
      tenantId,
      ticketId,
      error: err.message,
    });
    return null;
  }
}

async function searchRelevantMemories({ tenantId, ticketId, conversationId = null, queryText, topK = 5 }) {
  if (!tenantId || !queryText) return [];
  const sequelize = getSequelize();
  if (!sequelize) return [];

  try {
    const embedding = await generateEmbedding(String(queryText), tenantId);
    if (!embedding) return [];

    const k = Number.isFinite(Number(topK)) ? Math.max(1, Math.min(12, Number(topK))) : 5;
    const q = embeddingToPgVectorLiteral(embedding);

    const [rows] = await sequelize.query(
      `
        SELECT
          id,
          ticket_id,
          conversation_id,
          source_type,
          source_id,
          content,
          metadata_json,
          (embedding <=> (:q)::vector) AS distance,
          created_at
        FROM conversation_memory_embeddings
        WHERE tenant_key = :tenantKey
          AND (
            ticket_id = :ticketId
            OR (:conversationId IS NOT NULL AND conversation_id = :conversationId)
          )
        ORDER BY embedding <=> (:q)::vector
        LIMIT :k
      `,
      {
        replacements: {
          tenantKey: String(tenantId),
          ticketId: ticketId ? String(ticketId) : '__none__',
          conversationId: conversationId ? String(conversationId) : null,
          q,
          k,
        },
      }
    );

    return (rows || []).map((row) => {
      let metadata = {};
      try { metadata = JSON.parse(String(row.metadata_json || '{}')); } catch (_) {}
      const distance = Number(row.distance);
      return {
        id: row.id,
        ticketId: row.ticket_id,
        conversationId: row.conversation_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        content: row.content,
        metadata,
        score: Number.isFinite(distance) ? Math.max(0, 1 - distance) : 0,
        createdAt: row.created_at || null,
      };
    });
  } catch (err) {
    logger.debug('[ConversationMemory] Falha em busca semântica (best-effort)', {
      tenantId,
      ticketId,
      error: err.message,
    });
    return [];
  }
}

module.exports = {
  indexMemoryEntry,
  searchRelevantMemories,
};
