'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TimesheetEntry = null;
function getTimesheetEntryModel() {
  if (!TimesheetEntry) {
    const sequelize = getSequelize();
    if (!sequelize) return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });
    TimesheetEntry = sequelize.define('TimesheetEntry', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: true },
      task_id: { type: DataTypes.UUID, allowNull: true },
      ticket_id: { type: DataTypes.STRING, allowNull: true },
      project_id: { type: DataTypes.UUID, allowNull: true },
      user_id: { type: DataTypes.STRING, allowNull: true },
      duration_minutes: { type: DataTypes.INTEGER, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
    }, { tableName: 'timesheet_entries', timestamps: true, updatedAt: false, underscored: true, indexes: [
      { fields: ['tenant_id', 'entity_id', 'created_at'], name: 'timesheet_tenant_entity_created_idx' },
      { fields: ['tenant_id', 'project_id', 'created_at'], name: 'timesheet_tenant_project_created_idx' },
      { fields: ['tenant_id', 'ticket_id', 'created_at'], name: 'timesheet_tenant_ticket_created_idx' },
    ] });
  }
  return TimesheetEntry;
}
module.exports = getTimesheetEntryModel;
