/**
 * Model FlowExecution - flow_executions (tenant_key-based)
 *
 * Execution ledger header: one per execution (session / simulation / pipeline).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let FlowExecution = null;

function getFlowExecutionModel() {
  if (!FlowExecution) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    FlowExecution = sequelize.define('FlowExecution', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      flow_id: { type: DataTypes.STRING, allowNull: false },
      flow_version: { type: DataTypes.INTEGER, allowNull: true },
      session_id: { type: DataTypes.STRING, allowNull: true },
      correlation_id: { type: DataTypes.STRING, allowNull: true },
      subject_type: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'running' },
      started_at: { type: DataTypes.DATE, allowNull: false },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'flow_executions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'started_at'], name: 'flow_executions_tenant_started_at_idx' },
        { fields: ['tenant_key', 'correlation_id'], name: 'flow_executions_tenant_correlation_id_idx' },
        { fields: ['tenant_key', 'session_id'], name: 'flow_executions_tenant_session_id_idx' },
        { fields: ['tenant_key', 'subject_type', 'subject_id'], name: 'flow_executions_tenant_subject_idx' },
      ],
    });
  }

  return FlowExecution;
}

module.exports = getFlowExecutionModel;

