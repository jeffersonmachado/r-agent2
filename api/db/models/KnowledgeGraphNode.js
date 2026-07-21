'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let KnowledgeGraphNode = null;

function getKnowledgeGraphNodeModel() {
  if (!KnowledgeGraphNode) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    KnowledgeGraphNode = sequelize.define('KnowledgeGraphNode', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      type: {
        type: DataTypes.ENUM(
          'Customer', 'Lead', 'Conversation', 'Ticket', 'Journey',
          'Agent', 'Replay', 'Wave', 'Campaign', 'Appointment',
          'Contract', 'Invoice', 'Knowledge', 'Decision', 'Document',
          'Product', 'Service', 'Event', 'Insight'
        ),
        allowNull: false,
      },
      label: { type: DataTypes.STRING, allowNull: false },
      properties: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      externalRef: { type: DataTypes.STRING, allowNull: true },
      externalType: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'kg_nodes',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'type'], name: 'kg_nodes_tenant_type_idx' },
        { fields: ['external_ref', 'external_type'], name: 'kg_nodes_external_idx' },
        { fields: ['tenant_id', 'label'], name: 'kg_nodes_label_idx' },
      ],
    });
  }

  return KnowledgeGraphNode;
}

module.exports = getKnowledgeGraphNodeModel;
