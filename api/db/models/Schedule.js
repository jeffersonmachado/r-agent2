/**
 * Model Schedule - schedules (tenant_key-based)
 *
 * Minimal interval-based scheduler v1.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Schedule = null;

function getScheduleModel() {
  if (!Schedule) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    Schedule = sequelize.define('Schedule', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      kind: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      interval_sec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
      next_run_at: { type: DataTypes.DATE, allowNull: false },
      last_run_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'schedules',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'enabled', 'next_run_at'], name: 'schedules_tenant_enabled_next_run_idx' },
      ],
    });
  }

  return Schedule;
}

module.exports = getScheduleModel;

