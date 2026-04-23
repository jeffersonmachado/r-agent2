const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectAttachment = null;

function getProjectAttachmentModel() {
  if (!ProjectAttachment) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectAttachment = sequelize.define('ProjectAttachment', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      item_id: { type: DataTypes.UUID, allowNull: false },
      file_name: { type: DataTypes.STRING, allowNull: false },
      mime_type: { type: DataTypes.STRING, allowNull: true },
      storage_path: { type: DataTypes.STRING, allowNull: false },
      uploaded_by: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'project_attachments',
      timestamps: false,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        { fields: ['item_id'], name: 'project_attachments_item_id_idx' },
      ],
    });
  }

  return ProjectAttachment;
}

module.exports = getProjectAttachmentModel;
