const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectMember = null;

function getProjectMemberModel() {
  if (!ProjectMember) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectMember = sequelize.define('ProjectMember', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: false },
      user_id: { type: DataTypes.UUID, allowNull: false },
      role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'project_contributor' },
      allocation_percent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    }, {
      tableName: 'project_members',
      timestamps: false,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        { unique: true, fields: ['project_id', 'user_id'], name: 'project_members_project_id_user_id_unique' },
      ],
    });
  }

  return ProjectMember;
}

module.exports = getProjectMemberModel;
