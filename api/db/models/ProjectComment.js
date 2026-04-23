const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProjectComment = null;

function getProjectCommentModel() {
  if (!ProjectComment) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProjectComment = sequelize.define('ProjectComment', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      item_id: { type: DataTypes.UUID, allowNull: false },
      author_user_id: { type: DataTypes.UUID, allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: false },
      is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    }, {
      tableName: 'project_comments',
      timestamps: false,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        { fields: ['item_id', 'created_at'], name: 'project_comments_item_id_created_at_idx' },
      ],
    });
  }

  return ProjectComment;
}

module.exports = getProjectCommentModel;
