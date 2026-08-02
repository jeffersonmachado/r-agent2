/**
 * Model RagDocument - Documentos RAG (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let RagDocument = null;

function getRagDocumentModel() {
  if (!RagDocument) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    RagDocument = sequelize.define('RagDocument', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      title: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      permissions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // Segregação de domínios do RAG (OPERATIONAL vs SYSTEM)
      domain: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'OPERATIONAL',
      },
      classification: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'PRODUCTION',
      },
      sensitivity: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'INTERNAL',
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'active',
      },
      indexed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      indexed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      chunks_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Estado de indexação (máquina de estados)
      index_status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'pending',
      },
      index_error_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      index_error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      last_index_attempt_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      inconsistent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      inconsistent_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    }, {
      tableName: 'rag_documents',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status'], name: 'rag_documents_tenant_key_status_idx' },
        { fields: ['tenant_key', 'indexed'], name: 'rag_documents_tenant_key_indexed_idx' },
        { fields: ['tenant_key', 'index_status'], name: 'rag_documents_tenant_key_index_status_idx' },
        { fields: ['tenant_key', 'inconsistent'], name: 'rag_documents_tenant_key_inconsistent_idx' },
      ],
    });
  }

  return RagDocument;
}

module.exports = getRagDocumentModel;

