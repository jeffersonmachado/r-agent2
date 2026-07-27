'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let KnowledgeGraphNode = null;

// Fonte única dos valores válidos de type — usada no ENUM do model e na
// validação de contrato das rotas. Manter em sincronia com o CHECK
// knowledge_graph_nodes_type_check (migrations/agent-os-2026-06-11.sql).
const NODE_TYPES = [
  'Customer', 'Lead', 'Conversation', 'Ticket', 'Journey',
  'Agent', 'Replay', 'Wave', 'Campaign', 'Appointment',
  'Contract', 'Invoice', 'Knowledge', 'Decision', 'Document',
  'Product', 'Service', 'Event', 'Insight',
];

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
type: DataTypes.ENUM(...NODE_TYPES),
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
module.exports.NODE_TYPES = NODE_TYPES;
