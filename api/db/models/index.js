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
const getRagDocumentFile = require('./RagDocumentFile');
const getTenantExclusion = require('./TenantExclusion');
const getQueue = require('./Queue');
const getCloseReason = require('./CloseReason');
const getTicketTag = require('./TicketTag');
const getFlowTemplate = require('./FlowTemplate');
const getChannelAccount = require('./ChannelAccount');
const getChannelConversation = require('./ChannelConversation');
const getChannelMessage = require('./ChannelMessage');
const getOutboundQueueItem = require('./OutboundQueueItem');
const getTicketEvent = require('./TicketEvent');
const getQueueAssignmentState = require('./QueueAssignmentState');
const getEventLedger = require('./EventLedger');
const getExecutionJob = require('./ExecutionJob');
const getSchedule = require('./Schedule');
const getPublicAccessToken = require('./PublicAccessToken');
const getFlowExecution = require('./FlowExecution');
const getNodeExecution = require('./NodeExecution');
const getProcessExecutionEvent = require('./ProcessExecutionEvent');
const getProcessCompiledDefinition = require('./ProcessCompiledDefinition');
const getOrder = require('./Order');
const getDelivery = require('./Delivery');
const getPhysicalQueue = require('./PhysicalQueue');
const getPhysicalTicket = require('./PhysicalTicket');
const getPhysicalTicketSequence = require('./PhysicalTicketSequence');
const getAccessSubject = require('./AccessSubject');
const getAccessMembership = require('./AccessMembership');
const getEvidence = require('./Evidence');
const getAccessCredential = require('./AccessCredential');
const getAccessPolicy = require('./AccessPolicy');
const getAccessDevice = require('./AccessDevice');
const getAccessDecision = require('./AccessDecision');
const getAccessEvent = require('./AccessEvent');
const getPbxTenant = require('./PbxTenant');
const getPbxExtension = require('./PbxExtension');
const getPbxTrunk = require('./PbxTrunk');
const getPbxRoute = require('./PbxRoute');
const getPbxQueue = require('./PbxQueue');
const getPbxQueueMember = require('./PbxQueueMember');
const getPbxCallRule = require('./PbxCallRule');
const getPbxConfigVersion = require('./PbxConfigVersion');
const getPbxCarrier = require('./PbxCarrier');
const getPbxRouteBase = require('./PbxRouteBase');
const getPbxCategoryType = require('./PbxCategoryType');
const getPbxCategory = require('./PbxCategory');
const getPbxBlockRule = require('./PbxBlockRule');
const getPbxGroup = require('./PbxGroup');
const getPbxConferenceRoom = require('./PbxConferenceRoom');
const getPbxHoliday = require('./PbxHoliday');
const getPbxDid = require('./PbxDid');
const getPbxFaxRoute = require('./PbxFaxRoute');
const getPbxAudioAsset = require('./PbxAudioAsset');
const getPbxRecording = require('./PbxRecording');
const getPbxCdr = require('./PbxCdr');
const getCcPauseReason = require('./CcPauseReason');
const getCcContactReason = require('./CcContactReason');
const getCcCampaign = require('./CcCampaign');
const getCcCampaignListItem = require('./CcCampaignListItem');
const getCcScheduledCallback = require('./CcScheduledCallback');
const getCcClick2CallRequest = require('./CcClick2CallRequest');
const getLegacyRchatbot = require('./LegacyRchatbot');
const getLegacyRchatbotPattern = require('./LegacyRchatbotPattern');
const getLegacyRchatbotResponse = require('./LegacyRchatbotResponse');
const getLegacyRchatbotAction = require('./LegacyRchatbotAction');
const getLegacyMonHost = require('./LegacyMonHost');
const getLegacyMonService = require('./LegacyMonService');
const getLegacyMonOs = require('./LegacyMonOs');
const getLegacyMonApp = require('./LegacyMonApp');
const getMarketingForm = require('./MarketingForm');
const getMarketingLead = require('./MarketingLead');
const getMarketingFormSubmission = require('./MarketingFormSubmission');
const getMarketingScoringRule = require('./MarketingScoringRule');
const getMarketingEmailCampaign = require('./MarketingEmailCampaign');
const getMarketingEmailSend = require('./MarketingEmailSend');
const getMarketingLink = require('./MarketingLink');
const getMarketingLinkClick = require('./MarketingLinkClick');
const getMarketingAdConversion = require('./MarketingAdConversion');
const getMarketingAdsKeywordMetric = require('./MarketingAdsKeywordMetric');
const getMarketingAdsSearchTermMetric = require('./MarketingAdsSearchTermMetric');
const getTenantGoal = require('./TenantGoal');
const getTenantMetricSnapshot = require('./TenantMetricSnapshot');
const getTenantInsight = require('./TenantInsight');
const getTenantInsightEvidence = require('./TenantInsightEvidence');
const getTenantRecommendation = require('./TenantRecommendation');
const getMarketMetricAggregate = require('./MarketMetricAggregate');
const getMarketBenchmark = require('./MarketBenchmark');
const getMarketPattern = require('./MarketPattern');
const getMarketPrediction = require('./MarketPrediction');
const getMarketPlaybook = require('./MarketPlaybook');
const getVerticalJourneyEvent = require('./VerticalJourneyEvent');
const getVerticalAttendance = require('./VerticalAttendance');
const getVerticalSessionBundle = require('./VerticalSessionBundle');
const getVerticalEngagementSignal = require('./VerticalEngagementSignal');
const getBillingTransaction = require('./BillingTransaction');
const getBillingSubscription = require('./BillingSubscription');
const getNotificationDelivery = require('./NotificationDelivery');

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
const RagDocumentFile = () => getRagDocumentFile();
const TenantExclusion = () => getTenantExclusion();
const Queue = () => getQueue();
const CloseReason = () => getCloseReason();
const TicketTag = () => getTicketTag();
const FlowTemplate = () => getFlowTemplate();
const ChannelAccount = () => getChannelAccount();
const ChannelConversation = () => getChannelConversation();
const ChannelMessage = () => getChannelMessage();
const OutboundQueueItem = () => getOutboundQueueItem();
const TicketEvent = () => getTicketEvent();
const QueueAssignmentState = () => getQueueAssignmentState();
const EventLedger = () => getEventLedger();
const ExecutionJob = () => getExecutionJob();
const Schedule = () => getSchedule();
const PublicAccessToken = () => getPublicAccessToken();
const FlowExecution = () => getFlowExecution();
const NodeExecution = () => getNodeExecution();
const ProcessExecutionEvent = () => getProcessExecutionEvent();
const ProcessCompiledDefinition = () => getProcessCompiledDefinition();
const Order = () => getOrder();
const Delivery = () => getDelivery();
const PhysicalQueue = () => getPhysicalQueue();
const PhysicalTicket = () => getPhysicalTicket();
const PhysicalTicketSequence = () => getPhysicalTicketSequence();
const AccessSubject = () => getAccessSubject();
const AccessMembership = () => getAccessMembership();
const Evidence = () => getEvidence();
const AccessCredential = () => getAccessCredential();
const AccessPolicy = () => getAccessPolicy();
const AccessDevice = () => getAccessDevice();
const AccessDecision = () => getAccessDecision();
const AccessEvent = () => getAccessEvent();
const PbxTenant = () => getPbxTenant();
const PbxExtension = () => getPbxExtension();
const PbxTrunk = () => getPbxTrunk();
const PbxRoute = () => getPbxRoute();
const PbxQueue = () => getPbxQueue();
const PbxQueueMember = () => getPbxQueueMember();
const PbxCallRule = () => getPbxCallRule();
const PbxConfigVersion = () => getPbxConfigVersion();
const PbxCarrier = () => getPbxCarrier();
const PbxRouteBase = () => getPbxRouteBase();
const PbxCategoryType = () => getPbxCategoryType();
const PbxCategory = () => getPbxCategory();
const PbxBlockRule = () => getPbxBlockRule();
const PbxGroup = () => getPbxGroup();
const PbxConferenceRoom = () => getPbxConferenceRoom();
const PbxHoliday = () => getPbxHoliday();
const PbxDid = () => getPbxDid();
const PbxFaxRoute = () => getPbxFaxRoute();
const PbxAudioAsset = () => getPbxAudioAsset();
const PbxRecording = () => getPbxRecording();
const PbxCdr = () => getPbxCdr();
const CcPauseReason = () => getCcPauseReason();
const CcContactReason = () => getCcContactReason();
const CcCampaign = () => getCcCampaign();
const CcCampaignListItem = () => getCcCampaignListItem();
const CcScheduledCallback = () => getCcScheduledCallback();
const CcClick2CallRequest = () => getCcClick2CallRequest();
const LegacyRchatbot = () => getLegacyRchatbot();
const LegacyRchatbotPattern = () => getLegacyRchatbotPattern();
const LegacyRchatbotResponse = () => getLegacyRchatbotResponse();
const LegacyRchatbotAction = () => getLegacyRchatbotAction();
const LegacyMonHost = () => getLegacyMonHost();
const LegacyMonService = () => getLegacyMonService();
const LegacyMonOs = () => getLegacyMonOs();
const LegacyMonApp = () => getLegacyMonApp();
const MarketingForm = () => getMarketingForm();
const MarketingLead = () => getMarketingLead();
const MarketingFormSubmission = () => getMarketingFormSubmission();
const MarketingScoringRule = () => getMarketingScoringRule();
const MarketingEmailCampaign = () => getMarketingEmailCampaign();
const MarketingEmailSend = () => getMarketingEmailSend();
const MarketingLink = () => getMarketingLink();
const MarketingLinkClick = () => getMarketingLinkClick();
const MarketingAdConversion = () => getMarketingAdConversion();
const MarketingAdsKeywordMetric = () => getMarketingAdsKeywordMetric();
const MarketingAdsSearchTermMetric = () => getMarketingAdsSearchTermMetric();
const TenantGoal = () => getTenantGoal();
const TenantMetricSnapshot = () => getTenantMetricSnapshot();
const TenantInsight = () => getTenantInsight();
const TenantInsightEvidence = () => getTenantInsightEvidence();
const TenantRecommendation = () => getTenantRecommendation();
const MarketMetricAggregate = () => getMarketMetricAggregate();
const MarketBenchmark = () => getMarketBenchmark();
const MarketPattern = () => getMarketPattern();
const MarketPrediction = () => getMarketPrediction();
const MarketPlaybook = () => getMarketPlaybook();
const VerticalJourneyEvent = () => getVerticalJourneyEvent();
const VerticalAttendance = () => getVerticalAttendance();
const VerticalSessionBundle = () => getVerticalSessionBundle();
const VerticalEngagementSignal = () => getVerticalEngagementSignal();
const BillingTransaction = () => getBillingTransaction();
const BillingSubscription = () => getBillingSubscription();
const NotificationDelivery = () => getNotificationDelivery();

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
  const QueueModel = Queue();
  const CloseReasonModel = CloseReason();
  const TicketTagModel = TicketTag();
  const FlowTemplateModel = FlowTemplate();
  const ChannelAccountModel = ChannelAccount();
  const ChannelConversationModel = ChannelConversation();
  const ChannelMessageModel = ChannelMessage();
  const OutboundQueueItemModel = OutboundQueueItem();
  const TenantInsightModel = TenantInsight();
  const TenantInsightEvidenceModel = TenantInsightEvidence();
  const TenantRecommendationModel = TenantRecommendation();
  const TenantGoalModel = TenantGoal();

  TenantInsightModel.hasMany(TenantInsightEvidenceModel, {
    foreignKey: 'insight_id',
    as: 'evidences',
  });
  TenantInsightEvidenceModel.belongsTo(TenantInsightModel, {
    foreignKey: 'insight_id',
    as: 'insight',
  });

  TenantInsightModel.hasMany(TenantRecommendationModel, {
    foreignKey: 'insight_id',
    as: 'recommendations',
  });
  TenantRecommendationModel.belongsTo(TenantInsightModel, {
    foreignKey: 'insight_id',
    as: 'insight',
  });

  TenantGoalModel.hasMany(TenantRecommendationModel, {
    foreignKey: 'goal_id',
    as: 'recommendations',
  });
  TenantRecommendationModel.belongsTo(TenantGoalModel, {
    foreignKey: 'goal_id',
    as: 'goal',
  });

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
  // No explicit relationships for Queue (tenant_key-based)
  // No explicit relationships for CloseReason/TicketTag (tenant_key-based)
  // No explicit relationships for FlowTemplate (tenant_key-based)
  // No explicit relationships for ChannelAccount/ChannelConversation/ChannelMessage/OutboundQueueItem (tenant_key-based)
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
  RagDocumentFile,
  TenantExclusion,
  Queue,
  CloseReason,
  TicketTag,
  FlowTemplate,
  ChannelAccount,
  ChannelConversation,
  ChannelMessage,
  OutboundQueueItem,
  TicketEvent,
  QueueAssignmentState,
  EventLedger,
  ExecutionJob,
  Schedule,
  PublicAccessToken,
  FlowExecution,
  NodeExecution,
  ProcessExecutionEvent,
  ProcessCompiledDefinition,
  Order,
  Delivery,
  PhysicalQueue,
  PhysicalTicket,
  PhysicalTicketSequence,
  AccessSubject,
  AccessMembership,
  Evidence,
  AccessCredential,
  AccessPolicy,
  AccessDevice,
  AccessDecision,
  AccessEvent,
  PbxTenant,
  PbxExtension,
  PbxTrunk,
  PbxRoute,
  PbxQueue,
  PbxQueueMember,
  PbxCallRule,
  PbxConfigVersion,
  PbxCarrier,
  PbxRouteBase,
  PbxCategoryType,
  PbxCategory,
  PbxBlockRule,
  PbxGroup,
  PbxConferenceRoom,
  PbxHoliday,
  PbxDid,
  PbxFaxRoute,
  PbxAudioAsset,
  PbxRecording,
  PbxCdr,
  CcPauseReason,
  CcContactReason,
  CcCampaign,
  CcCampaignListItem,
  CcScheduledCallback,
  CcClick2CallRequest,
  LegacyRchatbot,
  LegacyRchatbotPattern,
  LegacyRchatbotResponse,
  LegacyRchatbotAction,
  LegacyMonHost,
  LegacyMonService,
  LegacyMonOs,
  LegacyMonApp,
  MarketingForm,
  MarketingLead,
  MarketingFormSubmission,
  MarketingScoringRule,
  MarketingEmailCampaign,
  MarketingEmailSend,
  MarketingLink,
  MarketingLinkClick,
  MarketingAdConversion,
  MarketingAdsKeywordMetric,
  MarketingAdsSearchTermMetric,
  TenantGoal,
  TenantMetricSnapshot,
  TenantInsight,
  TenantInsightEvidence,
  TenantRecommendation,
  MarketMetricAggregate,
  MarketBenchmark,
  MarketPattern,
  MarketPrediction,
  MarketPlaybook,
  VerticalJourneyEvent,
  VerticalAttendance,
  VerticalSessionBundle,
  VerticalEngagementSignal,
  BillingTransaction,
  BillingSubscription,
  NotificationDelivery,
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
  getRagDocumentFile,
  getTenantExclusion,
  getQueue,
  getCloseReason,
  getTicketTag,
  getFlowTemplate,
  getChannelAccount,
  getChannelConversation,
  getChannelMessage,
  getOutboundQueueItem,
  getTicketEvent,
  getQueueAssignmentState,
  getEventLedger,
  getExecutionJob,
  getSchedule,
  getPublicAccessToken,
  getFlowExecution,
  getNodeExecution,
  getProcessExecutionEvent,
  getProcessCompiledDefinition,
  getOrder,
  getDelivery,
  getPhysicalQueue,
  getPhysicalTicket,
  getPhysicalTicketSequence,
  getAccessSubject,
  getAccessMembership,
  getEvidence,
  getAccessCredential,
  getAccessPolicy,
  getAccessDevice,
  getAccessDecision,
  getAccessEvent,
  getPbxTenant,
  getPbxExtension,
  getPbxTrunk,
  getPbxRoute,
  getPbxQueue,
  getPbxQueueMember,
  getPbxCallRule,
  getPbxConfigVersion,
  getPbxCarrier,
  getPbxRouteBase,
  getPbxCategoryType,
  getPbxCategory,
  getPbxBlockRule,
  getPbxGroup,
  getPbxConferenceRoom,
  getPbxHoliday,
  getPbxDid,
  getPbxFaxRoute,
  getPbxAudioAsset,
  getPbxRecording,
  getPbxCdr,
  getCcPauseReason,
  getCcContactReason,
  getCcCampaign,
  getCcCampaignListItem,
  getCcScheduledCallback,
  getCcClick2CallRequest,
  getLegacyRchatbot,
  getLegacyRchatbotPattern,
  getLegacyRchatbotResponse,
  getLegacyRchatbotAction,
  getLegacyMonHost,
  getLegacyMonService,
  getLegacyMonOs,
  getLegacyMonApp,
  getMarketingForm,
  getMarketingLead,
  getMarketingFormSubmission,
  getMarketingScoringRule,
  getMarketingEmailCampaign,
  getMarketingEmailSend,
  getMarketingLink,
  getMarketingLinkClick,
  getMarketingAdConversion,
  getMarketingAdsKeywordMetric,
  getMarketingAdsSearchTermMetric,
  getTenantGoal,
  getTenantMetricSnapshot,
  getTenantInsight,
  getTenantInsightEvidence,
  getTenantRecommendation,
  getMarketMetricAggregate,
  getMarketBenchmark,
  getMarketPattern,
  getMarketPrediction,
  getMarketPlaybook,
  getVerticalJourneyEvent,
  getVerticalAttendance,
  getVerticalSessionBundle,
  getVerticalEngagementSignal,
  getBillingTransaction,
  getBillingSubscription,
  getNotificationDelivery,
};
