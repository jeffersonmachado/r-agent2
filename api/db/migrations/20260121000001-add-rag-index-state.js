'use strict';

/**
 * Migration: Add index state fields to rag_documents.
 *
 * Objetivo:
 * - Garantir máquina de estados de indexação no BD:
 *   pending -> indexing -> indexed | failed
 * - Registrar erros e inconsistências para health/auto-repair.
 */

const { tableExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await tableExists(queryInterface, 'rag_documents');
    if (!exists) {
      // Em instalações novas, a tabela pode ainda não existir; evita falha.
      return;
    }

    const table = await queryInterface.describeTable('rag_documents');

    async function addColumnIfMissing(name, spec) {
      if (table[name]) return;
      await queryInterface.addColumn('rag_documents', name, spec);
    }

    await addColumnIfMissing('index_status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending',
    });

    await addColumnIfMissing('index_error_code', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addColumnIfMissing('index_error_message', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await addColumnIfMissing('last_index_attempt_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await addColumnIfMissing('inconsistent', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await addColumnIfMissing('inconsistent_reason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    // Backfill: documentos já marcados como indexed=true viram index_status='indexed'
    // (mantemos consistent=false por padrão; o /rag/health irá detectar e marcar se necessário).
    try {
      await queryInterface.sequelize.query(
        "UPDATE rag_documents SET index_status='indexed' WHERE indexed=true AND (index_status IS NULL OR index_status='pending')"
      );
    } catch {
      // Best-effort; não bloqueia migration em ambientes com permissões restritas.
    }

    // Índices auxiliares
    try {
      await queryInterface.addIndex('rag_documents', ['tenant_key', 'index_status'], {
        name: 'rag_documents_tenant_key_index_status_idx',
      });
    } catch {
      // ignore if exists
    }
    try {
      await queryInterface.addIndex('rag_documents', ['tenant_key', 'inconsistent'], {
        name: 'rag_documents_tenant_key_inconsistent_idx',
      });
    } catch {
      // ignore if exists
    }
  },

  async down(queryInterface) {
    // Rollback best-effort (não falha se colunas não existirem)
    const exists = await tableExists(queryInterface, 'rag_documents');
    if (!exists) return;
    const table = await queryInterface.describeTable('rag_documents');

    async function removeIfExists(name) {
      if (!table[name]) return;
      await queryInterface.removeColumn('rag_documents', name);
    }

    await removeIfExists('index_status');
    await removeIfExists('index_error_code');
    await removeIfExists('index_error_message');
    await removeIfExists('last_index_attempt_at');
    await removeIfExists('inconsistent');
    await removeIfExists('inconsistent_reason');
  },
};

