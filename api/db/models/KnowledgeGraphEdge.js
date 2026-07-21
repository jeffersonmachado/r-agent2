'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let KnowledgeGraphEdge = null;

function getKnowledgeGraphEdgeModel() {
  if (!KnowledgeGraphEdge) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    KnowledgeGraphEdge = sequelize.define('KnowledgeGraphEdge', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      sourceNodeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'kg_nodes', key: 'id' },
      },
      targetNodeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'kg_nodes', key: 'id' },
      },
      relationship: { type: DataTypes.STRING, allowNull: false },
      weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1.0 },
      properties: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'kg_edges',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id'], name: 'kg_edges_tenant_idx' },
        { fields: ['source_node_id', 'target_node_id'], name: 'kg_edges_nodes_idx' },
        { fields: ['relationship'], name: 'kg_edges_relationship_idx' },
      ],
    });
  }

  return KnowledgeGraphEdge;
}

module.exports = getKnowledgeGraphEdgeModel;
