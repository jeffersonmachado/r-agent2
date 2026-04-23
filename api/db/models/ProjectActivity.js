const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectActivity = null;

function getProjectActivityModel() {
  if (!ProjectActivity) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectActivity = sequelize.define('ProjectActivity', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: false },
      item_id: { type: DataTypes.UUID, allowNull: true },
      actor_user_id: { type: DataTypes.UUID, allowNull: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      before_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      after_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'project_activities',
      timestamps: false,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        { fields: ['project_id', 'created_at'], name: 'project_activities_project_id_created_at_idx' },
        { fields: ['item_id', 'created_at'], name: 'project_activities_item_id_created_at_idx' },
      ],
    });
  }

  return ProjectActivity;
}

module.exports = getProjectActivityModel;
