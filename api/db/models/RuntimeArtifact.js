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
      run_id: { type: DataTypes.STRING, allowNull: true },
      artifact_type: { type: DataTypes.STRING, allowNull: true },
      artifact_version: { type: DataTypes.STRING, allowNull: true },
      source_fingerprint: { type: DataTypes.STRING(64), allowNull: true },
      immutable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.STRING, allowNull: true },
      producer: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
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
        { fields: ['run_id', 'artifact_type', 'sha256'], name: 'runtime_artifacts_run_type_sha_idx' },
      ],
    });
  }

  return RuntimeArtifact;
}

module.exports = getRuntimeArtifactModel;
