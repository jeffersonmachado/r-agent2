/**
 * Model NodeExecution - node_executions (tenant_key-based)
 *
 * Execution ledger detail: one per node step.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let NodeExecution = null;

function getNodeExecutionModel() {
  if (!NodeExecution) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    NodeExecution = sequelize.define('NodeExecution', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      execution_id: { type: DataTypes.STRING, allowNull: false },
      node_id: { type: DataTypes.STRING, allowNull: true },
      node_type: { type: DataTypes.STRING, allowNull: true },
      step_index: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'ok' },
      started_at: { type: DataTypes.DATE, allowNull: false },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      input: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      output: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      state_before: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      state_after: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      events: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      error_message: { type: DataTypes.TEXT, allowNull: true },
    }, {
      tableName: 'node_executions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'execution_id', 'step_index'], name: 'node_executions_tenant_execution_step_idx' },
        { fields: ['tenant_key', 'execution_id', 'created_at'], name: 'node_executions_tenant_execution_created_at_idx' },
        { fields: ['tenant_key', 'node_id'], name: 'node_executions_tenant_node_id_idx' },
      ],
    });
  }

  return NodeExecution;
}

module.exports = getNodeExecutionModel;

