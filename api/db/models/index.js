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
const getSession = require('./Session');
const getExecution = require('./Execution');
const getAuditEvent = require('./AuditEvent');
const getGenerationAudit = require('./GenerationAudit');
const getAuditReport = require('./AuditReport');
const getTicket = require('./Ticket');
const getFlow = require('./Flow');
const getTenantContext = require('./TenantContext');
const getDepartment = require('./Department');
const getQuickReply = require('./QuickReply');
const getWebhook = require('./Webhook');
const getRagDocument = require('./RagDocument');

// Lazy getters para models
const Tenant = () => getTenant();
const User = () => getUser();
const TenantUser = () => getTenantUser();
const TenantSetting = () => getTenantSetting();
const TenantAISetting = () => getTenantAISetting();
const TenantAICredential = () => getTenantAICredential();
const AuditLog = () => getAuditLog();
const Session = () => getSession();
const Execution = () => getExecution();
const AuditEvent = () => getAuditEvent();
const GenerationAudit = () => getGenerationAudit();
const AuditReport = () => getAuditReport();
const Ticket = () => getTicket();
const Flow = () => getFlow();
const TenantContext = () => getTenantContext();
const Department = () => getDepartment();
const QuickReply = () => getQuickReply();
const Webhook = () => getWebhook();
const RagDocument = () => getRagDocument();

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
  const SessionModel = Session();
  const ExecutionModel = Execution();
  const AuditEventModel = AuditEvent();
  const GenerationAuditModel = GenerationAudit();
  const AuditReportModel = AuditReport();
  const TicketModel = Ticket();
  const FlowModel = Flow();
  const TenantContextModel = TenantContext();
  const DepartmentModel = Department();
  const QuickReplyModel = QuickReply();
  const WebhookModel = Webhook();
  const RagDocumentModel = RagDocument();

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

  // User -> Session (one-to-many)
  UserModel.hasMany(SessionModel, {
    foreignKey: 'user_id',
    as: 'sessions',
  });
  SessionModel.belongsTo(UserModel, {
    foreignKey: 'user_id',
    as: 'user',
  });

  // No explicit relationships for Execution (stored as JSONB)

  // User -> AuditEvent (one-to-many)
  UserModel.hasMany(AuditEventModel, {
    foreignKey: 'actor_user_id',
    as: 'auditEvents',
  });
  AuditEventModel.belongsTo(UserModel, {
    foreignKey: 'actor_user_id',
    as: 'actor',
  });

  // No explicit relationships for GenerationAudit/AuditReport (JSONB payloads)

  // No explicit relationships for Ticket (tenant_key-based)
  // No explicit relationships for Flow (tenant_key-based)
  // No explicit relationships for TenantContext/Department/QuickReply/Webhook/RagDocument (tenant_key-based)
}

module.exports = {
  Tenant,
  User,
  TenantUser,
  TenantSetting,
  TenantAISetting,
  TenantAICredential,
  AuditLog,
  Session,
  Execution,
  AuditEvent,
  GenerationAudit,
  AuditReport,
  Ticket,
  Flow,
  TenantContext,
  Department,
  QuickReply,
  Webhook,
  RagDocument,
  defineRelationships,
  // Exporta também as funções getter para uso direto
  getTenant,
  getUser,
  getTenantUser,
  getTenantSetting,
  getTenantAISetting,
  getTenantAICredential,
  getAuditLog,
  getSession,
  getExecution,
  getAuditEvent,
  getGenerationAudit,
  getAuditReport,
  getTicket,
  getFlow,
  getTenantContext,
  getDepartment,
  getQuickReply,
  getWebhook,
  getRagDocument,
};
