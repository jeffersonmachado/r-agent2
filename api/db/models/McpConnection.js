/**
 * Model McpConnection - mcp_connections (tenant_key-based)
 *
 * CONTROL PLANE persistente das conexões MCP externas (§M1/§M3).
 *
 * O que este model NÃO guarda: segredo. Apenas `credential_ref` — o valor é
 * resolvido pelo mecanismo oficial de credenciais em tempo de uso (§M4).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let McpConnection = null;

function getMcpConnectionModel() {
  if (!McpConnection) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    McpConnection = sequelize.define('McpConnection', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      endpoint: { type: DataTypes.STRING, allowNull: false },
      transport: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'http' },
      auth_type: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'bearer' },
      credential_ref: { type: DataTypes.STRING, allowNull: true },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      classification_ceiling: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'PRODUCTION' },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'CONFIGURED' },
      last_discovery_at: { type: DataTypes.DATE, allowNull: true },
      last_health_at: { type: DataTypes.DATE, allowNull: true },
      last_success_at: { type: DataTypes.DATE, allowNull: true },
      last_failure_at: { type: DataTypes.DATE, allowNull: true },
      schema_fingerprint: { type: DataTypes.STRING(128), allowNull: true },
      consecutive_failures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'control-plane' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'mcp_connections',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'name'], name: 'mcp_connections_tenant_name_uq', unique: true },
        { fields: ['tenant_key', 'enabled'], name: 'mcp_connections_tenant_enabled_idx' },
        { fields: ['status'], name: 'mcp_connections_status_idx' },
      ],
    });
  }
  return McpConnection;
}

// Convenção dos models do projeto: o módulo exporta a FACTORY diretamente
// (`module.exports = getXModel`), e `api/db/models/index.js` a envolve.
module.exports = getMcpConnectionModel;
