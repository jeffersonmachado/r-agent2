const logger = require('../../utils/logger');
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
const getCaseConversation = require('./CaseConversation');
const getOutboundQueueItem = require('./OutboundQueueItem');
const getOutboundAttempt = require('./OutboundAttempt');
const getTicketEvent = require('./TicketEvent');
const getQueueAssignmentState = require('./QueueAssignmentState');
const getEventLedger = require('./EventLedger');
const getExecutionJob = require('./ExecutionJob');
// §M1/§M3: control plane persistente das conexões MCP externas.
const getMcpConnection = require('./McpConnection');
// §B4: agregado persistente da pesquisa competitiva de benchmarks.
const getBenchmarkResearchRun = require('./BenchmarkResearchRun');
const getBenchmarkResearchSubject = require('./BenchmarkResearchSubject');
const getBenchmarkResearchSource = require('./BenchmarkResearchSource');
const getBenchmarkResearchEvidence = require('./BenchmarkResearchEvidence');
const getBenchmarkResearchFinding = require('./BenchmarkResearchFinding');
const getBenchmarkSourceInspection = require('./BenchmarkSourceInspection');
// Propostas de mudança do sample de benchmarks (aprovação humana obrigatória).
const getBenchmarkResearchChangeProposal = require('./BenchmarkResearchChangeProposal');
// Descoberta autônoma de mercado (camada anterior ao Discovery Set de benchmark).
const getMarketDiscoveryRun = require('./MarketDiscoveryRun');
const getMarketArchetype = require('./MarketArchetype');
const getMarketCandidate = require('./MarketCandidate');
const getMarketDiscoverySet = require('./MarketDiscoverySet');
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
const getVerticalProductionBatch = require('./VerticalProductionBatch');
const getPushSubscription = require('./PushSubscription');
const getVerticalAttendance = require('./VerticalAttendance');
const getVerticalSessionBundle = require('./VerticalSessionBundle');
const getVerticalEngagementSignal = require('./VerticalEngagementSignal');
const getVerticalMlModel = require('./VerticalMlModel');
const getBillingTransaction = require('./BillingTransaction');
const getBillingSubscription = require('./BillingSubscription');
const getNotificationDelivery = require('./NotificationDelivery');
const getProject = require('./Project');
const getProjectMember = require('./ProjectMember');
const getProjectList = require('./ProjectList');
const getProjectItem = require('./ProjectItem');
const getProjectComment = require('./ProjectComment');
const getProjectAttachment = require('./ProjectAttachment');
const getProjectActivity = require('./ProjectActivity');
const getProjectMilestone = require('./ProjectMilestone');
const getProjectDependency = require('./ProjectDependency');
const getProjectTemplate = require('./ProjectTemplate');
const getWorkspaceEntity = require('./WorkspaceEntity');
const getWorkspaceTimelineEvent = require('./WorkspaceTimelineEvent');
const getWorkspaceInsight = require('./WorkspaceInsight');
const getWorkspaceAction = require('./WorkspaceAction');
const getWorkspaceEntityLink = require('./WorkspaceEntityLink');
const getAutoCorrectionRun = require('./AutoCorrectionRun');
const getAutoCorrectionAction = require('./AutoCorrectionAction');
const getTask = require('./Task');
const getTimesheetEntry = require('./TimesheetEntry');
const getResource = require('./Resource');
const getResourceAvailability = require('./ResourceAvailability');
const getResourceBooking = require('./ResourceBooking');
const getPaymentEvent = require('./PaymentEvent');
const getCorporateAgent = require('./CorporateAgent');
const getKnowledgeGraphNode = require('./KnowledgeGraphNode');
const getKnowledgeGraphEdge = require('./KnowledgeGraphEdge');
const getJourneyRegistry = require('./JourneyRegistry');
const getLearningRecord = require('./LearningRecord');
const getUserInteractionSession = require('./UserInteractionSession');
const getUserCompetency = require('./UserCompetency');
const getUserLearningProfile = require('./UserLearningProfile');
const getLearningRouteSkillMap = require('./LearningRouteSkillMap');
const getLearningTutorHint = require('./LearningTutorHint');
const getLearningMission = require('./LearningMission');
const getLearningSimulation = require('./LearningSimulation');
const getLearningJourneyFaq = require('./LearningJourneyFaq');
const getUserCertification = require('./UserCertification');
const getLearningMentorPlan = require('./LearningMentorPlan');
const getAiGovernanceRecord = require('./AiGovernanceRecord');
const getAskAiConversation = require('./AskAiConversation');
const getVerticalTemplate = require('./VerticalTemplate');
const getRuntimeArtifact = require('./RuntimeArtifact');
const getCoverageEvidence = require('./CoverageEvidence');
const getGovernanceRun = require('./GovernanceRun');
const getScorecardDimension = require('./ScorecardDimension');
const getScorecardRequirement = require('./ScorecardRequirement');
const getScorecardEvaluation = require('./ScorecardEvaluation');
const getScorecardDimensionResult = require('./ScorecardDimensionResult');
const getScorecardRequirementResult = require('./ScorecardRequirementResult');
const getGovernanceGap = require('./GovernanceGap');
const getGovernanceGateResult = require('./GovernanceGateResult');
const getExecutionTrace = require('./ExecutionTrace');
const getExecutionTraceEvent = require('./ExecutionTraceEvent');
const getGovernanceFinalDecision = require('./GovernanceFinalDecision');
const getReleaseManifestRecord = require('./ReleaseManifestRecord');
const getAgentPolicy = require('./AgentPolicy');
const getAgentPolicyVersion = require('./AgentPolicyVersion');
const getAgentPolicyAssignment = require('./AgentPolicyAssignment');
const getAgentPolicyAttestation = require('./AgentPolicyAttestation');
const getAiProvider = require('./AiProvider');
const getEngineeringTask = require('./EngineeringTask');
const getEngineeringAttempt = require('./EngineeringAttempt');
const getEngineeringTestRun = require('./EngineeringTestRun');
const getEngineeringRegressionRun = require('./EngineeringRegressionRun');
const getEngineeringModelCatalogEntry = require('./EngineeringModelCatalogEntry');
const getEngineeringOperation = require('./EngineeringOperation');
const getEngineeringReview = require('./EngineeringReview');
const getEngineeringTelemetryEvent = require('./EngineeringTelemetryEvent');
const getEngineeringMission = require('./EngineeringMission');
const getEngineeringMissionVersion = require('./EngineeringMissionVersion');
const getEngineeringMissionApproval = require('./EngineeringMissionApproval');
const getEngineeringMissionSettings = require('./EngineeringMissionSettings');
const getEngineeringMissionReview = require('./EngineeringMissionReview');
const getEngineeringMissionIntegration = require('./EngineeringMissionIntegration');
const getEngineeringBugFinding = require('./EngineeringBugFinding');
const getEngineeringBugFindingEvent = require('./EngineeringBugFindingEvent');
const getIntegrationConnection = require('./IntegrationConnection');
const getIntegrationObjectLink = require('./IntegrationObjectLink');
const getIntegrationSyncState = require('./IntegrationSyncState');
const getIntegrationInboundEvent = require('./IntegrationInboundEvent');

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
const CaseConversation = () => getCaseConversation();
const OutboundQueueItem = () => getOutboundQueueItem();
const OutboundAttempt = () => getOutboundAttempt();
const TicketEvent = () => getTicketEvent();
const QueueAssignmentState = () => getQueueAssignmentState();
const EventLedger = () => getEventLedger();
const ExecutionJob = () => getExecutionJob();
const McpConnection = () => getMcpConnection();
// §B4: autoridade persistente da pesquisa de benchmarks (nunca Map em memória).
const BenchmarkResearchRun = () => getBenchmarkResearchRun();
const BenchmarkResearchSubject = () => getBenchmarkResearchSubject();
const BenchmarkResearchSource = () => getBenchmarkResearchSource();
const BenchmarkResearchEvidence = () => getBenchmarkResearchEvidence();
const BenchmarkResearchFinding = () => getBenchmarkResearchFinding();
const BenchmarkSourceInspection = () => getBenchmarkSourceInspection();
const BenchmarkResearchChangeProposal = () => getBenchmarkResearchChangeProposal();
// Autoridade persistente da descoberta de mercado (nunca Map em memória).
const MarketDiscoveryRun = () => getMarketDiscoveryRun();
const MarketArchetype = () => getMarketArchetype();
const MarketCandidate = () => getMarketCandidate();
const MarketDiscoverySet = () => getMarketDiscoverySet();
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
const VerticalProductionBatch = () => getVerticalProductionBatch();
const PushSubscription = () => getPushSubscription();
const VerticalAttendance = () => getVerticalAttendance();
const VerticalSessionBundle = () => getVerticalSessionBundle();
const VerticalEngagementSignal = () => getVerticalEngagementSignal();
const VerticalMlModel = () => getVerticalMlModel();
const BillingTransaction = () => getBillingTransaction();
const BillingSubscription = () => getBillingSubscription();
const NotificationDelivery = () => getNotificationDelivery();
const Project = () => getProject();
const ProjectMember = () => getProjectMember();
const ProjectList = () => getProjectList();
const ProjectItem = () => getProjectItem();
const ProjectComment = () => getProjectComment();
const ProjectAttachment = () => getProjectAttachment();
const ProjectActivity = () => getProjectActivity();
const ProjectMilestone = () => getProjectMilestone();
const ProjectDependency = () => getProjectDependency();
const ProjectTemplate = () => getProjectTemplate();
const WorkspaceEntity = () => getWorkspaceEntity();
const WorkspaceTimelineEvent = () => getWorkspaceTimelineEvent();
const WorkspaceInsight = () => getWorkspaceInsight();
const WorkspaceAction = () => getWorkspaceAction();
const WorkspaceEntityLink = () => getWorkspaceEntityLink();
const AutoCorrectionRun = () => getAutoCorrectionRun();
const AutoCorrectionAction = () => getAutoCorrectionAction();
const Task = () => getTask();
const TimesheetEntry = () => getTimesheetEntry();
const Resource = () => getResource();
const ResourceAvailability = () => getResourceAvailability();
const ResourceBooking = () => getResourceBooking();
const PaymentEvent = () => getPaymentEvent();
const CorporateAgent = () => getCorporateAgent();
const KnowledgeGraphNode = () => getKnowledgeGraphNode();
const KnowledgeGraphEdge = () => getKnowledgeGraphEdge();
const JourneyRegistry = () => getJourneyRegistry();
const LearningRecord = () => getLearningRecord();
const UserInteractionSession = () => getUserInteractionSession();
const UserCompetency = () => getUserCompetency();
const UserLearningProfile = () => getUserLearningProfile();
const LearningRouteSkillMap = () => getLearningRouteSkillMap();
const LearningTutorHint = () => getLearningTutorHint();
const LearningMission = () => getLearningMission();
const LearningSimulation = () => getLearningSimulation();
const LearningJourneyFaq = () => getLearningJourneyFaq();
const UserCertification = () => getUserCertification();
const LearningMentorPlan = () => getLearningMentorPlan();
const AiGovernanceRecord = () => getAiGovernanceRecord();
const AskAiConversation = () => getAskAiConversation();
const VerticalTemplate = () => getVerticalTemplate();
const RuntimeArtifact = () => getRuntimeArtifact();
const CoverageEvidence = () => getCoverageEvidence();
const GovernanceRun = () => getGovernanceRun();
const ScorecardDimension = () => getScorecardDimension();
const ScorecardRequirement = () => getScorecardRequirement();
const ScorecardEvaluation = () => getScorecardEvaluation();
const ScorecardDimensionResult = () => getScorecardDimensionResult();
const ScorecardRequirementResult = () => getScorecardRequirementResult();
const GovernanceGap = () => getGovernanceGap();
const GovernanceGateResult = () => getGovernanceGateResult();
const ExecutionTrace = () => getExecutionTrace();
const ExecutionTraceEvent = () => getExecutionTraceEvent();
const GovernanceFinalDecision = () => getGovernanceFinalDecision();
const ReleaseManifestRecord = () => getReleaseManifestRecord();
const AgentPolicy = () => getAgentPolicy();
const AgentPolicyVersion = () => getAgentPolicyVersion();
const AgentPolicyAssignment = () => getAgentPolicyAssignment();
const AgentPolicyAttestation = () => getAgentPolicyAttestation();
const AiProvider = () => getAiProvider();
const EngineeringTask = () => getEngineeringTask();
const EngineeringAttempt = () => getEngineeringAttempt();
const EngineeringTestRun = () => getEngineeringTestRun();
const EngineeringRegressionRun = () => getEngineeringRegressionRun();
const EngineeringModelCatalogEntry = () => getEngineeringModelCatalogEntry();
const EngineeringOperation = () => getEngineeringOperation();
const EngineeringReview = () => getEngineeringReview();
const EngineeringTelemetryEvent = () => getEngineeringTelemetryEvent();
const EngineeringMission = () => getEngineeringMission();
const EngineeringMissionVersion = () => getEngineeringMissionVersion();
const EngineeringMissionApproval = () => getEngineeringMissionApproval();
const EngineeringMissionSettings = () => getEngineeringMissionSettings();
const EngineeringMissionReview = () => getEngineeringMissionReview();
const EngineeringMissionIntegration = () => getEngineeringMissionIntegration();
const EngineeringBugFinding = () => getEngineeringBugFinding();
const EngineeringBugFindingEvent = () => getEngineeringBugFindingEvent();
const IntegrationConnection = () => getIntegrationConnection();
const IntegrationObjectLink = () => getIntegrationObjectLink();
const IntegrationSyncState = () => getIntegrationSyncState();
const IntegrationInboundEvent = () => getIntegrationInboundEvent();

// Define relacionamentos
function defineRelationships() {
  const sequelize = getSequelize();
  if (!sequelize) {
    logger.warn('[Models] Sequelize não inicializado, relacionamentos não serão definidos');
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
  const ProjectModel = Project();
  const ProjectMemberModel = ProjectMember();
  const ProjectListModel = ProjectList();
  const ProjectItemModel = ProjectItem();
  const ProjectCommentModel = ProjectComment();
  const ProjectAttachmentModel = ProjectAttachment();
  const ProjectActivityModel = ProjectActivity();
  const ProjectMilestoneModel = ProjectMilestone();
  const ProjectDependencyModel = ProjectDependency();
  const ProjectTemplateModel = ProjectTemplate();
  const WorkspaceEntityModel = WorkspaceEntity();
  const WorkspaceTimelineEventModel = WorkspaceTimelineEvent();
  const WorkspaceInsightModel = WorkspaceInsight();
  const WorkspaceActionModel = WorkspaceAction();
  const WorkspaceEntityLinkModel = WorkspaceEntityLink();
  const AutoCorrectionRunModel = AutoCorrectionRun();
  const AutoCorrectionActionModel = AutoCorrectionAction();
  const TaskModel = Task();
  const TimesheetEntryModel = TimesheetEntry();
  const ResourceModel = Resource();
  const ResourceAvailabilityModel = ResourceAvailability();
  const ResourceBookingModel = ResourceBooking();
  const PaymentEventModel = PaymentEvent();
  const CorporateAgentModel = CorporateAgent();
  const KnowledgeGraphNodeModel = KnowledgeGraphNode();
  const KnowledgeGraphEdgeModel = KnowledgeGraphEdge();
  const JourneyRegistryModel = JourneyRegistry();
  const LearningRecordModel = LearningRecord();
  const AiGovernanceRecordModel = AiGovernanceRecord();
  const VerticalTemplateModel = VerticalTemplate();

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

  TenantModel.hasMany(ProjectModel, {
    foreignKey: 'tenant_id',
    as: 'projects',
  });
  ProjectModel.belongsTo(TenantModel, {
    foreignKey: 'tenant_id',
    as: 'tenant',
  });

  UserModel.hasMany(ProjectModel, {
    foreignKey: 'owner_user_id',
    as: 'ownedProjects',
  });
  ProjectModel.belongsTo(UserModel, {
    foreignKey: 'owner_user_id',
    as: 'owner',
  });

  ProjectModel.hasMany(ProjectMemberModel, {
    foreignKey: 'project_id',
    as: 'members',
  });
  ProjectMemberModel.belongsTo(ProjectModel, {
    foreignKey: 'project_id',
    as: 'project',
  });
  UserModel.hasMany(ProjectMemberModel, {
    foreignKey: 'user_id',
    as: 'projectMemberships',
  });
  ProjectMemberModel.belongsTo(UserModel, {
    foreignKey: 'user_id',
    as: 'user',
  });

  ProjectModel.hasMany(ProjectListModel, {
    foreignKey: 'project_id',
    as: 'lists',
  });
  ProjectListModel.belongsTo(ProjectModel, {
    foreignKey: 'project_id',
    as: 'project',
  });

  ProjectModel.hasMany(ProjectMilestoneModel, {
    foreignKey: 'project_id',
    as: 'milestones',
  });
  ProjectMilestoneModel.belongsTo(ProjectModel, {
    foreignKey: 'project_id',
    as: 'project',
  });

  ProjectModel.hasMany(ProjectItemModel, {
    foreignKey: 'project_id',
    as: 'items',
  });
  ProjectItemModel.belongsTo(ProjectModel, {
    foreignKey: 'project_id',
    as: 'project',
  });
  ProjectListModel.hasMany(ProjectItemModel, {
    foreignKey: 'list_id',
    as: 'items',
  });
  ProjectItemModel.belongsTo(ProjectListModel, {
    foreignKey: 'list_id',
    as: 'list',
  });
  ProjectMilestoneModel.hasMany(ProjectItemModel, {
    foreignKey: 'milestone_id',
    as: 'items',
  });
  ProjectItemModel.belongsTo(ProjectMilestoneModel, {
    foreignKey: 'milestone_id',
    as: 'milestone',
  });
  ProjectItemModel.hasMany(ProjectItemModel, {
    foreignKey: 'parent_item_id',
    as: 'children',
  });
  ProjectItemModel.belongsTo(ProjectItemModel, {
    foreignKey: 'parent_item_id',
    as: 'parent',
  });
  UserModel.hasMany(ProjectItemModel, {
    foreignKey: 'assignee_user_id',
    as: 'assignedProjectItems',
  });
  ProjectItemModel.belongsTo(UserModel, {
    foreignKey: 'assignee_user_id',
    as: 'assignee',
  });

  WorkspaceEntityModel.hasMany(WorkspaceTimelineEventModel, {
    foreignKey: 'entity_id',
    as: 'timelineEvents',
  });
  WorkspaceTimelineEventModel.belongsTo(WorkspaceEntityModel, {
    foreignKey: 'entity_id',
    as: 'entity',
  });
  WorkspaceEntityModel.hasMany(WorkspaceInsightModel, {
    foreignKey: 'entity_id',
    as: 'insights',
  });
  WorkspaceInsightModel.belongsTo(WorkspaceEntityModel, {
    foreignKey: 'entity_id',
    as: 'entity',
  });
  WorkspaceEntityModel.hasMany(WorkspaceActionModel, {
    foreignKey: 'entity_id',
    as: 'actions',
  });
  WorkspaceActionModel.belongsTo(WorkspaceEntityModel, {
    foreignKey: 'entity_id',
    as: 'entity',
  });

  WorkspaceEntityModel.hasMany(WorkspaceEntityLinkModel, {
    foreignKey: 'entity_id',
    as: 'entityLinks',
  });
  WorkspaceEntityLinkModel.belongsTo(WorkspaceEntityModel, {
    foreignKey: 'entity_id',
    as: 'entity',
  });
  AutoCorrectionRunModel.hasMany(AutoCorrectionActionModel, {
    foreignKey: 'run_id',
    as: 'actions',
  });
  AutoCorrectionActionModel.belongsTo(AutoCorrectionRunModel, {
    foreignKey: 'run_id',
    as: 'run',
  });
  WorkspaceEntityModel.hasMany(TaskModel, {
    foreignKey: 'entity_id',
    as: 'workspaceTasks',
  });
  TaskModel.belongsTo(WorkspaceEntityModel, {
    foreignKey: 'entity_id',
    as: 'entity',
  });
  WorkspaceEntityModel.hasMany(TimesheetEntryModel, {
    foreignKey: 'entity_id',
    as: 'timesheetEntries',
  });
  WorkspaceEntityModel.hasMany(PaymentEventModel, {
    foreignKey: 'entity_id',
    as: 'paymentEvents',
  });
  ResourceModel.hasMany(ResourceAvailabilityModel, {
    foreignKey: 'resource_id',
    as: 'availability',
  });
  ResourceAvailabilityModel.belongsTo(ResourceModel, {
    foreignKey: 'resource_id',
    as: 'resource',
  });
  ResourceModel.hasMany(ResourceBookingModel, {
    foreignKey: 'resource_id',
    as: 'bookings',
  });
  ResourceBookingModel.belongsTo(ResourceModel, {
    foreignKey: 'resource_id',
    as: 'resource',
  });
  UserModel.hasMany(ProjectItemModel, {
    foreignKey: 'reporter_user_id',
    as: 'reportedProjectItems',
  });
  ProjectItemModel.belongsTo(UserModel, {
    foreignKey: 'reporter_user_id',
    as: 'reporter',
  });

  ProjectItemModel.hasMany(ProjectCommentModel, {
    foreignKey: 'item_id',
    as: 'comments',
  });
  ProjectCommentModel.belongsTo(ProjectItemModel, {
    foreignKey: 'item_id',
    as: 'item',
  });
  UserModel.hasMany(ProjectCommentModel, {
    foreignKey: 'author_user_id',
    as: 'projectComments',
  });
  ProjectCommentModel.belongsTo(UserModel, {
    foreignKey: 'author_user_id',
    as: 'author',
  });

  ProjectItemModel.hasMany(ProjectAttachmentModel, {
    foreignKey: 'item_id',
    as: 'attachments',
  });
  ProjectAttachmentModel.belongsTo(ProjectItemModel, {
    foreignKey: 'item_id',
    as: 'item',
  });

  ProjectModel.hasMany(ProjectActivityModel, {
    foreignKey: 'project_id',
    as: 'activities',
  });
  ProjectActivityModel.belongsTo(ProjectModel, {
    foreignKey: 'project_id',
    as: 'project',
  });
  ProjectItemModel.hasMany(ProjectActivityModel, {
    foreignKey: 'item_id',
    as: 'activities',
  });
  ProjectActivityModel.belongsTo(ProjectItemModel, {
    foreignKey: 'item_id',
    as: 'item',
  });

  ProjectItemModel.hasMany(ProjectDependencyModel, {
    foreignKey: 'predecessor_item_id',
    as: 'blockingDependencies',
  });
  ProjectItemModel.hasMany(ProjectDependencyModel, {
    foreignKey: 'successor_item_id',
    as: 'blockedByDependencies',
  });
  ProjectDependencyModel.belongsTo(ProjectItemModel, {
    foreignKey: 'predecessor_item_id',
    as: 'predecessor',
  });
  ProjectDependencyModel.belongsTo(ProjectItemModel, {
    foreignKey: 'successor_item_id',
    as: 'successor',
  });

  TenantModel.hasMany(ProjectTemplateModel, {
    foreignKey: 'tenant_id',
    as: 'projectTemplates',
  });
  ProjectTemplateModel.belongsTo(TenantModel, {
    foreignKey: 'tenant_id',
    as: 'tenant',
  });

  // Knowledge Graph relationships
  KnowledgeGraphNodeModel.hasMany(KnowledgeGraphEdgeModel, {
    foreignKey: 'source_node_id',
    as: 'outgoingEdges',
  });
  KnowledgeGraphEdgeModel.belongsTo(KnowledgeGraphNodeModel, {
    foreignKey: 'source_node_id',
    as: 'sourceNode',
  });
  KnowledgeGraphNodeModel.hasMany(KnowledgeGraphEdgeModel, {
    foreignKey: 'target_node_id',
    as: 'incomingEdges',
  });
  KnowledgeGraphEdgeModel.belongsTo(KnowledgeGraphNodeModel, {
    foreignKey: 'target_node_id',
    as: 'targetNode',
  });

  const EngineeringTaskModel = EngineeringTask();
  const EngineeringAttemptModel = EngineeringAttempt();
  const EngineeringTestRunModel = EngineeringTestRun();
  const EngineeringRegressionRunModel = EngineeringRegressionRun();
  const EngineeringReviewModel = EngineeringReview();
  const EngineeringTelemetryEventModel = EngineeringTelemetryEvent();

  EngineeringTaskModel.hasMany(EngineeringAttemptModel, { foreignKey: 'task_id', as: 'attempts' });
  EngineeringAttemptModel.belongsTo(EngineeringTaskModel, { foreignKey: 'task_id', as: 'task' });
  EngineeringAttemptModel.hasMany(EngineeringTestRunModel, { foreignKey: 'attempt_id', as: 'testRuns' });
  EngineeringTestRunModel.belongsTo(EngineeringAttemptModel, { foreignKey: 'attempt_id', as: 'attempt' });
  EngineeringAttemptModel.hasMany(EngineeringRegressionRunModel, { foreignKey: 'attempt_id', as: 'regressionRuns' });
  EngineeringRegressionRunModel.belongsTo(EngineeringAttemptModel, { foreignKey: 'attempt_id', as: 'attempt' });
  EngineeringAttemptModel.hasMany(EngineeringReviewModel, { foreignKey: 'attempt_id', as: 'reviews' });
  EngineeringReviewModel.belongsTo(EngineeringAttemptModel, { foreignKey: 'attempt_id', as: 'attempt' });
  EngineeringTaskModel.hasMany(EngineeringTelemetryEventModel, { foreignKey: 'task_id', as: 'telemetryEvents' });
  EngineeringTelemetryEventModel.belongsTo(EngineeringTaskModel, { foreignKey: 'task_id', as: 'task' });

  // Engineering Mission Compiler: mission → versões de MissionSpec → aprovações.
  const EngineeringMissionModel = EngineeringMission();
  const EngineeringMissionVersionModel = EngineeringMissionVersion();
  const EngineeringMissionApprovalModel = EngineeringMissionApproval();

  EngineeringMissionModel.hasMany(EngineeringMissionVersionModel, { foreignKey: 'mission_id', as: 'versions' });
  EngineeringMissionVersionModel.belongsTo(EngineeringMissionModel, { foreignKey: 'mission_id', as: 'mission' });
  EngineeringMissionModel.hasMany(EngineeringMissionApprovalModel, { foreignKey: 'mission_id', as: 'approvals' });
  EngineeringMissionApprovalModel.belongsTo(EngineeringMissionModel, { foreignKey: 'mission_id', as: 'mission' });
  // A task de execução é ligada por id (sem FK rígida: a missão pode sobreviver a várias tasks).
  EngineeringMissionModel.belongsTo(EngineeringTaskModel, { foreignKey: 'linked_task_id', as: 'linkedTask', constraints: false });
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
  CaseConversation,
  OutboundQueueItem,
  OutboundAttempt,
  TicketEvent,
  QueueAssignmentState,
  EventLedger,
  ExecutionJob,
  McpConnection,
  BenchmarkResearchRun,
  BenchmarkResearchSubject,
  BenchmarkResearchSource,
  BenchmarkResearchEvidence,
  BenchmarkResearchFinding,
  BenchmarkSourceInspection,
  BenchmarkResearchChangeProposal,
  MarketDiscoveryRun,
  MarketArchetype,
  MarketCandidate,
  MarketDiscoverySet,
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
  VerticalProductionBatch,
  PushSubscription,
  VerticalAttendance,
  VerticalSessionBundle,
  VerticalEngagementSignal,
  VerticalMlModel,
  BillingTransaction,
  BillingSubscription,
  NotificationDelivery,
  Project,
  ProjectMember,
  ProjectList,
  ProjectItem,
  ProjectComment,
  ProjectAttachment,
  ProjectActivity,
  ProjectMilestone,
  ProjectDependency,
  ProjectTemplate,
  WorkspaceEntity,
  WorkspaceTimelineEvent,
  WorkspaceInsight,
  WorkspaceAction,
  WorkspaceEntityLink,
  AutoCorrectionRun,
  AutoCorrectionAction,
  Task,
  TimesheetEntry,
  Resource,
  ResourceAvailability,
  ResourceBooking,
  PaymentEvent,
  CorporateAgent,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  JourneyRegistry,
  LearningRecord,
  UserInteractionSession,
  UserCompetency,
  UserLearningProfile,
  LearningRouteSkillMap,
  LearningTutorHint,
  LearningMission,
  LearningSimulation,
  LearningJourneyFaq,
  UserCertification,
  LearningMentorPlan,
  AiGovernanceRecord,
  AskAiConversation,
  VerticalTemplate,
  RuntimeArtifact,
  CoverageEvidence,
  GovernanceRun,
  ScorecardDimension,
  ScorecardRequirement,
  ScorecardEvaluation,
  ScorecardDimensionResult,
  ScorecardRequirementResult,
  GovernanceGap,
  GovernanceGateResult,
  ExecutionTrace,
  ExecutionTraceEvent,
  GovernanceFinalDecision,
  ReleaseManifestRecord,
  AgentPolicy,
  AgentPolicyVersion,
  AgentPolicyAssignment,
  AgentPolicyAttestation,
  AiProvider,
  IntegrationConnection,
  IntegrationObjectLink,
  IntegrationSyncState,
  IntegrationInboundEvent,
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
  getOutboundAttempt,
  getTicketEvent,
  getQueueAssignmentState,
  getEventLedger,
  getExecutionJob,
  getMcpConnection,
  getBenchmarkResearchRun,
  getBenchmarkResearchSubject,
  getBenchmarkResearchSource,
  getBenchmarkResearchEvidence,
  getBenchmarkResearchFinding,
  getBenchmarkSourceInspection,
  getBenchmarkResearchChangeProposal,
  getMarketDiscoveryRun,
  getMarketArchetype,
  getMarketCandidate,
  getMarketDiscoverySet,
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
  getVerticalProductionBatch,
  getPushSubscription,
  getVerticalAttendance,
  getVerticalSessionBundle,
  getVerticalEngagementSignal,
  getVerticalMlModel,
  getBillingTransaction,
  getBillingSubscription,
  getNotificationDelivery,
  getProject,
  getProjectMember,
  getProjectList,
  getProjectItem,
  getProjectComment,
  getProjectAttachment,
  getProjectActivity,
  getProjectMilestone,
  getProjectDependency,
  getProjectTemplate,
  getWorkspaceEntity,
  getWorkspaceTimelineEvent,
  getWorkspaceInsight,
  getWorkspaceAction,
  getWorkspaceEntityLink,
  getAutoCorrectionRun,
  getAutoCorrectionAction,
  getTask,
  getTimesheetEntry,
  getResource,
  getResourceAvailability,
  getResourceBooking,
  getPaymentEvent,
  getCorporateAgent,
  getKnowledgeGraphNode,
  getKnowledgeGraphEdge,
  getJourneyRegistry,
  getLearningRecord,
  getUserInteractionSession,
  getUserCompetency,
  getUserLearningProfile,
  getLearningRouteSkillMap,
  getLearningTutorHint,
  getLearningMission,
  getLearningSimulation,
  getLearningJourneyFaq,
  getUserCertification,
  getLearningMentorPlan,
  getAiGovernanceRecord,
  getAskAiConversation,
  getVerticalTemplate,
  getRuntimeArtifact,
  getCoverageEvidence,
  getGovernanceRun,
  getScorecardDimension,
  getScorecardRequirement,
  getScorecardEvaluation,
  getScorecardDimensionResult,
  getScorecardRequirementResult,
  getGovernanceGap,
  getGovernanceGateResult,
  getExecutionTrace,
  getExecutionTraceEvent,
  getGovernanceFinalDecision,
  getReleaseManifestRecord,
  getAgentPolicy,
  getAgentPolicyVersion,
  getAgentPolicyAssignment,
  getAgentPolicyAttestation,
  getAiProvider,
  getIntegrationConnection,
  getIntegrationObjectLink,
  getIntegrationSyncState,
  getIntegrationInboundEvent,
  EngineeringTask,
  EngineeringAttempt,
  EngineeringTestRun,
  EngineeringRegressionRun,
  EngineeringModelCatalogEntry,
  EngineeringOperation,
  EngineeringReview,
  EngineeringTelemetryEvent,
  EngineeringMission,
  EngineeringMissionVersion,
  EngineeringMissionApproval,
  getEngineeringMission,
  getEngineeringMissionVersion,
  getEngineeringMissionApproval,
  EngineeringMissionSettings,
  getEngineeringMissionSettings,
  EngineeringMissionReview,
  EngineeringMissionIntegration,
  EngineeringBugFinding,
  EngineeringBugFindingEvent,
  getEngineeringMissionReview,
  getEngineeringMissionIntegration,
  getEngineeringBugFinding,
  getEngineeringBugFindingEvent,
  getEngineeringTask,
  getEngineeringAttempt,
  getEngineeringTestRun,
  getEngineeringRegressionRun,
  getEngineeringModelCatalogEntry,
  getEngineeringOperation,
  getEngineeringReview,
  getEngineeringTelemetryEvent,
};
