/**
 * Model RagDocumentFile - Arquivo original (binário) de um documento RAG (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let RagDocumentFile = null;

function getRagDocumentFileModel() {
  if (!RagDocumentFile) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    RagDocumentFile = sequelize.define('RagDocumentFile', {
      document_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      filename: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      mime_type: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      size_bytes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      data: {
        type: DataTypes.BLOB('long'),
        allowNull: false,
      },
    }, {
      tableName: 'rag_document_files',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'rag_document_files_tenant_key_idx' },
      ],
    });
  }

  return RagDocumentFile;
}

module.exports = getRagDocumentFileModel;

