'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Task = null;

function getTaskModel() {
  if (!Task) {
    const sequelize = getSequelize();
    if (!sequelize) return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });

    Task = sequelize.define('Task', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: true },
      ticket_id: { type: DataTypes.STRING, allowNull: true },
      project_id: { type: DataTypes.UUID, allowNull: true },
      conversation_id: { type: DataTypes.STRING, allowNull: true },
      title: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'manual' },
      priority: { type: DataTypes.STRING, allowNull: false, defaultValue: 'normal' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
      due_date: { type: DataTypes.DATE, allowNull: true },
      assigned_to: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'tasks',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'entity_id', 'created_at'], name: 'tasks_tenant_entity_created_idx' },
        { fields: ['tenant_id', 'status'], name: 'tasks_tenant_status_idx' },
        { fields: ['tenant_id', 'ticket_id'], name: 'tasks_tenant_ticket_idx' },
        { fields: ['tenant_id', 'project_id'], name: 'tasks_tenant_project_idx' },
      ],
    });
  }
  return Task;
}

module.exports = getTaskModel;
