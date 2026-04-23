const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Project = null;

function getProjectModel() {
  if (!Project) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    Project = sequelize.define('Project', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.UUID, allowNull: true },
      code: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      priority: { type: DataTypes.STRING, allowNull: false, defaultValue: 'medium' },
      health: { type: DataTypes.STRING, allowNull: false, defaultValue: 'on_track' },
      visibility: { type: DataTypes.STRING, allowNull: false, defaultValue: 'private' },
      owner_user_id: { type: DataTypes.UUID, allowNull: true },
      start_date: { type: DataTypes.DATE, allowNull: true },
      target_end_date: { type: DataTypes.DATE, allowNull: true },
      actual_end_date: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'projects',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'status'], name: 'projects_tenant_id_status_idx' },
        { unique: true, fields: ['tenant_id', 'code'], name: 'projects_tenant_id_code_unique' },
      ],
    });
  }

  return Project;
}

module.exports = getProjectModel;
