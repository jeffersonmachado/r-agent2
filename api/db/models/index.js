/**
 * Index de models - Carrega todos os models e define relacionamentos
 */

const { getSequelize } = require('../sequelize');
const getTenant = require('./Tenant');
const getUser = require('./User');
const getTenantUser = require('./TenantUser');
const getTenantSetting = require('./TenantSetting');
const getTenantAISetting = require('./TenantAISetting');
const getTenantAICredential = require('./TenantAICredential');
const getAuditLog = require('./AuditLog');

// Lazy getters para models
const Tenant = () => getTenant();
const User = () => getUser();
const TenantUser = () => getTenantUser();
const TenantSetting = () => getTenantSetting();
const TenantAISetting = () => getTenantAISetting();
const TenantAICredential = () => getTenantAICredential();
const AuditLog = () => getAuditLog();

// Define relacionamentos
function defineRelationships() {
  const sequelize = getSequelize();
  if (!sequelize) {
    console.warn('[Models] Sequelize não inicializado, relacionamentos não serão definidos');
    return;
  }

  const TenantModel = Tenant();
  const UserModel = User();
  const TenantUserModel = TenantUser();
  const TenantSettingModel = TenantSetting();
  const TenantAISettingModel = TenantAISetting();
  const TenantAICredentialModel = TenantAICredential();
  const AuditLogModel = AuditLog();

  // Tenant <-> User (many-to-many via TenantUser)
  TenantModel.belongsToMany(UserModel, {
    through: TenantUserModel,
    foreignKey: 'tenant_id',
    otherKey: 'user_id',
    as: 'users',
  });

  UserModel.belongsToMany(TenantModel, {
    through: TenantUserModel,
    foreignKey: 'user_id',
    otherKey: 'tenant_id',
    as: 'tenants',
  });

  // Tenant -> TenantSetting (one-to-many)
  TenantModel.hasMany(TenantSettingModel, {
    foreignKey: 'tenant_id',
    as: 'tenantSettings',
  });
  TenantSettingModel.belongsTo(TenantModel, {
    foreignKey: 'tenant_id',
    as: 'tenant',
  });

  // Tenant -> TenantAISetting (one-to-one)
  TenantModel.hasOne(TenantAISettingModel, {
    foreignKey: 'tenant_id',
    as: 'aiSetting',
  });
  TenantAISettingModel.belongsTo(TenantModel, {
    foreignKey: 'tenant_id',
    as: 'tenant',
  });

  // Tenant -> TenantAICredential (one-to-many)
  TenantModel.hasMany(TenantAICredentialModel, {
    foreignKey: 'tenant_id',
    as: 'aiCredentials',
  });
  TenantAICredentialModel.belongsTo(TenantModel, {
    foreignKey: 'tenant_id',
    as: 'tenant',
  });

  // Tenant -> AuditLog (one-to-many, nullable)
  TenantModel.hasMany(AuditLogModel, {
    foreignKey: 'tenant_id',
    as: 'auditLogs',
  });
  AuditLogModel.belongsTo(TenantModel, {
    foreignKey: 'tenant_id',
    as: 'tenant',
  });

  // User -> AuditLog (one-to-many, nullable)
  UserModel.hasMany(AuditLogModel, {
    foreignKey: 'actor_user_id',
    as: 'auditLogs',
  });
  AuditLogModel.belongsTo(UserModel, {
    foreignKey: 'actor_user_id',
    as: 'actor',
  });
}

module.exports = {
  Tenant,
  User,
  TenantUser,
  TenantSetting,
  TenantAISetting,
  TenantAICredential,
  AuditLog,
  defineRelationships,
  // Exporta também as funções getter para uso direto
  getTenant,
  getUser,
  getTenantUser,
  getTenantSetting,
  getTenantAISetting,
  getTenantAICredential,
  getAuditLog,
};
