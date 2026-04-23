const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectTemplate = null;

function getProjectTemplateModel() {
  if (!ProjectTemplate) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectTemplate = sequelize.define('ProjectTemplate', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.UUID, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      template_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_by: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'project_templates',
      timestamps: false,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        { fields: ['tenant_id', 'name'], name: 'project_templates_tenant_id_name_idx' },
      ],
    });
  }

  return ProjectTemplate;
}

module.exports = getProjectTemplateModel;
