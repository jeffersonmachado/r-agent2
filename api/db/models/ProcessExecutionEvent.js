const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProcessExecutionEvent = null;

function getProcessExecutionEventModel() {
  if (!ProcessExecutionEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProcessExecutionEvent = sequelize.define('ProcessExecutionEvent', {
      event_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      execution_id: { type: DataTypes.STRING, allowNull: false },
      sequence: { type: DataTypes.INTEGER, allowNull: false },
      process_id: { type: DataTypes.STRING, allowNull: false },
      process_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      node_id: { type: DataTypes.STRING, allowNull: true },
      node_type: { type: DataTypes.STRING, allowNull: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      timestamp: { type: DataTypes.DATE, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'process_execution_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['execution_id', 'sequence'], name: 'process_execution_events_execution_sequence_uq', unique: true },
        { fields: ['process_id', 'process_version'], name: 'process_execution_events_process_version_idx' },
        { fields: ['event_type', 'timestamp'], name: 'process_execution_events_type_timestamp_idx' },
      ],
    });
  }

  return ProcessExecutionEvent;
}

module.exports = getProcessExecutionEventModel;
