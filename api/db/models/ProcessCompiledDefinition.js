const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ProcessCompiledDefinition = null;

function getProcessCompiledDefinitionModel() {
  if (!ProcessCompiledDefinition) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    ProcessCompiledDefinition = sequelize.define('ProcessCompiledDefinition', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: true },
      process_id: { type: DataTypes.STRING, allowNull: false },
      process_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      source_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'compiled' },
      source_definition: { type: DataTypes.JSONB, allowNull: true },
      compiled_definition: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'process_compiled_definitions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'process_id', 'process_version'], name: 'process_compiled_definitions_tenant_process_version_uq', unique: true },
        { fields: ['process_id', 'process_version'], name: 'process_compiled_definitions_process_version_idx' },
      ],
    });
  }

  return ProcessCompiledDefinition;
}

module.exports = getProcessCompiledDefinitionModel;
