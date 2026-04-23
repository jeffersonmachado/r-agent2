const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectMilestone = null;

function getProjectMilestoneModel() {
  if (!ProjectMilestone) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectMilestone = sequelize.define('ProjectMilestone', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      due_date: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'planned' },
    }, {
      tableName: 'project_milestones',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['project_id', 'due_date'], name: 'project_milestones_project_id_due_date_idx' },
      ],
    });
  }

  return ProjectMilestone;
}

module.exports = getProjectMilestoneModel;
