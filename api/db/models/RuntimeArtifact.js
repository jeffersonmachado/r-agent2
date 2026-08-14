const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let RuntimeArtifact = null;

function getRuntimeArtifactModel() {
  if (!RuntimeArtifact) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    RuntimeArtifact = sequelize.define('RuntimeArtifact', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      kind: { type: DataTypes.STRING, allowNull: false },
      ref_id: { type: DataTypes.STRING, allowNull: false },
      content_jsonb: { type: DataTypes.JSONB, allowNull: true },
      content_text: { type: DataTypes.TEXT, allowNull: true },
      size_bytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      sha256: { type: DataTypes.STRING, allowNull: false },
      storage_key: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'runtime_artifacts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'kind', 'ref_id'], unique: true, name: 'runtime_artifacts_tenant_kind_ref_idx' },
        { fields: ['tenant_key', 'kind', 'created_at'], name: 'runtime_artifacts_tenant_kind_created_idx' },
      ],
    });
  }

  return RuntimeArtifact;
}

module.exports = getRuntimeArtifactModel;
