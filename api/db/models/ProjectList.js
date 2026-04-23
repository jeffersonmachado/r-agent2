const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectList = null;

function getProjectListModel() {
  if (!ProjectList) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectList = sequelize.define('ProjectList', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      color: { type: DataTypes.STRING, allowNull: true },
      wip_limit: { type: DataTypes.INTEGER, allowNull: true },
    }, {
      tableName: 'project_lists',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['project_id', 'position'], name: 'project_lists_project_id_position_idx' },
        { unique: true, fields: ['project_id', 'slug'], name: 'project_lists_project_id_slug_unique' },
      ],
    });
  }

  return ProjectList;
}

module.exports = getProjectListModel;
