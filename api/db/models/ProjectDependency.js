const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectDependency = null;

function getProjectDependencyModel() {
  if (!ProjectDependency) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectDependency = sequelize.define('ProjectDependency', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      predecessor_item_id: { type: DataTypes.UUID, allowNull: false },
      successor_item_id: { type: DataTypes.UUID, allowNull: false },
      dependency_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'blocks' },
    }, {
      tableName: 'project_dependencies',
      timestamps: false,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        {
          unique: true,
          fields: ['predecessor_item_id', 'successor_item_id'],
          name: 'project_dependencies_predecessor_successor_unique',
        },
      ],
    });
  }

  return ProjectDependency;
}

module.exports = getProjectDependencyModel;
