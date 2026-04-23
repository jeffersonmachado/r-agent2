const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectItem = null;

function getProjectItemModel() {
  if (!ProjectItem) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectItem = sequelize.define('ProjectItem', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: false },
      parent_item_id: { type: DataTypes.UUID, allowNull: true },
      list_id: { type: DataTypes.UUID, allowNull: true },
      milestone_id: { type: DataTypes.UUID, allowNull: true },
      item_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'task' },
      title: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'todo' },
      priority: { type: DataTypes.STRING, allowNull: false, defaultValue: 'medium' },
      severity: { type: DataTypes.STRING, allowNull: true },
      assignee_user_id: { type: DataTypes.UUID, allowNull: true },
      reporter_user_id: { type: DataTypes.UUID, allowNull: true },
      story_points: { type: DataTypes.INTEGER, allowNull: true },
      effort_estimate_minutes: { type: DataTypes.INTEGER, allowNull: true },
      effort_actual_minutes: { type: DataTypes.INTEGER, allowNull: true },
      progress_percent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      start_date: { type: DataTypes.DATE, allowNull: true },
      due_date: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      source_type: { type: DataTypes.STRING, allowNull: true },
      source_id: { type: DataTypes.STRING, allowNull: true },
      origin_context_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'project_items',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['project_id', 'list_id', 'position'], name: 'project_items_project_id_list_id_position_idx' },
        { fields: ['project_id', 'status'], name: 'project_items_project_id_status_idx' },
        { fields: ['project_id', 'assignee_user_id'], name: 'project_items_project_id_assignee_user_id_idx' },
      ],
    });
  }

  return ProjectItem;
}

module.exports = getProjectItemModel;
