'use strict';

const {
  createTableIfNotExists,
  addIndexIfNotExists,
} = require('../migrations-helper');

function resolveEmbeddingDim() {
  const raw = process.env.EMBEDDING_DIM || process.env.RAG_EMBEDDING_DIM || '384';
  const dim = parseInt(String(raw), 10);
  if (!Number.isFinite(dim) || dim <= 0) return 384;
  return dim;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const dim = resolveEmbeddingDim();

    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS vector;');

    await createTableIfNotExists(queryInterface, 'conversation_summaries', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      ticket_id: { type: Sequelize.STRING(128), allowNull: false },
      conversation_id: { type: Sequelize.STRING(128), allowNull: true },
      summary_kind: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'rolling' },
      summary_text: { type: Sequelize.TEXT, allowNull: false },
      window_start_at: { type: Sequelize.DATE, allowNull: true },
      window_end_at: { type: Sequelize.DATE, allowNull: true },
      message_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata_json: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'conversation_summaries', ['tenant_key', 'ticket_id', 'created_at'], {
      name: 'conv_summaries_tenant_ticket_created_idx',
    });
    await addIndexIfNotExists(queryInterface, 'conversation_summaries', ['tenant_key', 'conversation_id', 'created_at'], {
      name: 'conv_summaries_tenant_conversation_created_idx',
    });

    await createTableIfNotExists(queryInterface, 'conversation_facts', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      ticket_id: { type: Sequelize.STRING(128), allowNull: false },
      fact_key: { type: Sequelize.STRING(120), allowNull: false },
      fact_value: { type: Sequelize.TEXT, allowNull: false },
      confidence: { type: Sequelize.DECIMAL(7, 4), allowNull: true },
      source: { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'heuristic' },
      source_message_id: { type: Sequelize.STRING(191), allowNull: true },
      metadata_json: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'conversation_facts', ['tenant_key', 'ticket_id', 'fact_key'], {
      name: 'conv_facts_tenant_ticket_fact_key_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'conversation_facts', ['tenant_key', 'ticket_id', 'updated_at'], {
      name: 'conv_facts_tenant_ticket_updated_idx',
    });

    await createTableIfNotExists(queryInterface, 'conversation_events', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      ticket_id: { type: Sequelize.STRING(128), allowNull: false },
      conversation_id: { type: Sequelize.STRING(128), allowNull: true },
      event_type: { type: Sequelize.STRING(120), allowNull: false },
      direction: { type: Sequelize.STRING(20), allowNull: true },
      message_id: { type: Sequelize.STRING(191), allowNull: true },
      payload_json: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'conversation_events', ['tenant_key', 'ticket_id', 'occurred_at'], {
      name: 'conv_events_tenant_ticket_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'conversation_events', ['tenant_key', 'conversation_id', 'occurred_at'], {
      name: 'conv_events_tenant_conversation_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'conversation_events', ['tenant_key', 'event_type', 'occurred_at'], {
      name: 'conv_events_tenant_type_occurred_idx',
    });

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS conversation_memory_embeddings (
        id TEXT PRIMARY KEY,
        tenant_key TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        conversation_id TEXT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NULL,
        content TEXT NOT NULL,
        embedding vector(${dim}) NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await addIndexIfNotExists(queryInterface, 'conversation_memory_embeddings', ['tenant_key', 'ticket_id', 'created_at'], {
      name: 'conv_memory_tenant_ticket_created_idx',
    });
    await addIndexIfNotExists(queryInterface, 'conversation_memory_embeddings', ['tenant_key', 'conversation_id', 'created_at'], {
      name: 'conv_memory_tenant_conversation_created_idx',
    });
    await addIndexIfNotExists(queryInterface, 'conversation_memory_embeddings', ['tenant_key', 'source_type'], {
      name: 'conv_memory_tenant_source_type_idx',
    });

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS conv_memory_embedding_ivfflat_idx
      ON conversation_memory_embeddings
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('conversation_memory_embeddings').catch(() => {});
    await queryInterface.dropTable('conversation_events').catch(() => {});
    await queryInterface.dropTable('conversation_facts').catch(() => {});
    await queryInterface.dropTable('conversation_summaries').catch(() => {});
  },
};
