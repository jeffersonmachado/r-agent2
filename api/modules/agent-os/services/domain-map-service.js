'use strict';

/**
 * Domain Map Service - Agrupa models Sequelize por domínios de negócio.
 *
 * Regras de agrupamento baseadas em:
 * - Nomenclatura (prefixos Pbx, Cc, Marketing, Billing, Access, Vertical, etc.)
 * - Relacionamentos (FK para outros models no mesmo domínio)
 * - Contexto operacional (Omnichannel, CRM, Agenda, etc.)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function nowIso() { return new Date().toISOString(); }

/**
 * Domínios oficiais do RAP com seus models.
 */
const DOMAIN_DEFINITIONS = {
  'Omnichannel': {
    description: 'Canais de atendimento, conversas, tickets e filas',
    criticality: 'blocking',
    models: [
      'ChannelConversation', 'ChannelMessage', 'ChannelAccount',
      'Ticket', 'TicketEvent', 'TicketMedia', 'TicketTag',
      'Queue', 'QueueAssignmentState', 'CloseReason',
      'PhysicalQueue', 'PhysicalTicket', 'PhysicalTicketSequence',
      'QuickReply', 'Webhook',
    ],
    entrypoints: ['ChannelConversation', 'Ticket'],
    kpis: ['first_response_time', 'resolution_time', 'queue_depth', 'abandon_rate'],
  },

  'CRM / Growth': {
    description: 'Marketing, leads, campanhas de conversão',
    criticality: 'high',
    models: [
      'MarketingLead', 'MarketingForm', 'MarketingFormSubmission',
      'MarketingEmailCampaign', 'MarketingEmailSend',
      'MarketingLink', 'MarketingLinkClick',
      'MarketingScoringRule', 'MarketingAdConversion',
      'MarketingAdsKeywordMetric', 'MarketingAdsSearchTermMetric',
      'CcCampaign', 'CcCampaignListItem', 'CcScheduledCallback',
      'CcClick2CallRequest', 'CcPauseReason', 'CcContactReason',
      'TenantGoal', 'TenantInsight', 'TenantRecommendation',
      'TenantMetricSnapshot', 'TenantInsightEvidence',
    ],
    entrypoints: ['MarketingLead', 'CcCampaign'],
    kpis: ['conversion_rate', 'lead_response_time', 'campaign_roi', 'nps'],
  },

  'Agenda / Scheduling': {
    description: 'Agendamento de recursos e bookings',
    criticality: 'high',
    models: [
      'Schedule', 'Resource', 'ResourceAvailability', 'ResourceBooking',
      'PaymentEvent', 'Task', 'TimesheetEntry',
    ],
    entrypoints: ['Schedule', 'ResourceBooking'],
    kpis: ['booking_rate', 'no_show_rate', 'utilization', 'revenue_per_slot'],
  },

  'Food / Delivery': {
    description: 'Pedidos e entregas',
    criticality: 'medium',
    models: [
      'Order', 'Delivery',
    ],
    entrypoints: ['Order'],
    kpis: ['delivery_time', 'order_accuracy', 'cancel_rate'],
  },

  'PBX / Voice': {
    description: 'Telefonia, URA, filas de chamada, CDR',
    criticality: 'blocking',
    models: [
      'PbxCdr', 'PbxQueue', 'PbxQueueMember', 'PbxExtension',
      'PbxTrunk', 'PbxRoute', 'PbxRouteBase', 'PbxCallRule',
      'PbxBlockRule', 'PbxConfigVersion', 'PbxCarrier',
      'PbxCategory', 'PbxCategoryType', 'PbxGroup',
      'PbxConferenceRoom', 'PbxHoliday', 'PbxDid',
      'PbxFaxRoute', 'PbxAudioAsset', 'PbxRecording',
      'PbxTenant',
    ],
    entrypoints: ['PbxCdr', 'PbxQueue'],
    kpis: ['call_volume', 'abandon_rate', 'wait_time', 'talk_time'],
  },

  'Automation': {
    description: 'Fluxos, processos e execuções automatizadas',
    criticality: 'blocking',
    models: [
      'Flow', 'FlowExecution', 'FlowTemplate',
      'NodeExecution', 'ProcessExecutionEvent',
      'ProcessCompiledDefinition', 'Execution', 'ExecutionJob',
      'OutboundQueueItem', 'NotificationDelivery',
    ],
    entrypoints: ['Flow', 'FlowExecution'],
    kpis: ['execution_success_rate', 'flow_latency', 'node_failure_rate'],
  },

  'Governance / Evidence': {
    description: 'Auditoria, evidências, event ledger, compliance',
    criticality: 'blocking',
    models: [
      'AuditLog', 'AuditEvent', 'AuditReport',
      'Evidence', 'EventLedger', 'GenerationAudit',
      'AutoCorrectionRun', 'AutoCorrectionAction',
    ],
    entrypoints: ['AuditLog', 'Evidence'],
    kpis: ['audit_coverage', 'evidence_completeness', 'correction_success_rate'],
  },

  'Agent OS': {
    description: 'Agentes corporativos, knowledge graph, jornadas, aprendizado',
    criticality: 'high',
    models: [
      'CorporateAgent', 'JourneyRegistry', 'KnowledgeGraphNode',
      'KnowledgeGraphEdge', 'LearningRecord', 'AiGovernanceRecord',
      'VerticalTemplate',
    ],
    entrypoints: ['CorporateAgent', 'JourneyRegistry'],
    kpis: ['agent_success_rate', 'journey_coverage', 'learning_accuracy'],
  },

  'Access / Fitness': {
    description: 'Controle de acesso, dispositivos, credenciais, check-in',
    criticality: 'high',
    models: [
      'AccessSubject', 'AccessMembership', 'AccessCredential',
      'AccessPolicy', 'AccessDevice', 'AccessDecision', 'AccessEvent',
      'VerticalAttendance', 'VerticalJourneyEvent',
      'VerticalSessionBundle', 'VerticalEngagementSignal',
    ],
    entrypoints: ['AccessSubject', 'AccessEvent'],
    kpis: ['checkin_rate', 'access_denial_rate', 'device_utilization'],
  },

  'Tenant / Core': {
    description: 'Tenants, usuários, configurações base',
    criticality: 'blocking',
    models: [
      'Tenant', 'User', 'TenantUser', 'TenantSetting',
      'TenantAISetting', 'TenantAICredential', 'TenantContext',
      'TenantExclusion', 'Session', 'Department',
      'PublicAccessToken',
    ],
    entrypoints: ['Tenant', 'User'],
    kpis: ['tenant_count', 'user_activity', 'session_duration'],
  },

  'Workspace': {
    description: 'Workspace 360, entidades, timeline, insights, ações',
    criticality: 'high',
    models: [
      'WorkspaceEntity', 'WorkspaceTimelineEvent', 'WorkspaceInsight',
      'WorkspaceAction', 'WorkspaceEntityLink',
    ],
    entrypoints: ['WorkspaceEntity'],
    kpis: ['entity_linkage', 'insight_quality', 'action_completion_rate'],
  },

  'Billing / Payments': {
    description: 'Assinaturas, transações, billing',
    criticality: 'high',
    models: [
      'BillingSubscription', 'BillingTransaction', 'PaymentEvent',
    ],
    entrypoints: ['BillingSubscription', 'PaymentEvent'],
    kpis: ['mrr', 'churn_rate', 'payment_success_rate'],
  },

  'Projects': {
    description: 'Gestão de projetos e tarefas',
    criticality: 'medium',
    models: [
      'Project', 'ProjectMember', 'ProjectList', 'ProjectItem',
      'ProjectComment', 'ProjectAttachment', 'ProjectActivity',
      'ProjectMilestone', 'ProjectDependency', 'ProjectTemplate',
    ],
    entrypoints: ['Project'],
    kpis: ['on_time_delivery', 'task_completion_rate', 'velocity'],
  },

  'Market Intelligence': {
    description: 'Métricas de mercado, benchmarks, padrões, playbooks',
    criticality: 'low',
    models: [
      'MarketMetricAggregate', 'MarketBenchmark', 'MarketPattern',
      'MarketPrediction', 'MarketPlaybook',
    ],
    entrypoints: ['MarketMetricAggregate'],
    kpis: ['prediction_accuracy', 'benchmark_freshness'],
  },

  'RAG / Documents': {
    description: 'Documentos RAG, busca vetorial',
    criticality: 'medium',
    models: [
      'RagDocument', 'RagDocumentFile',
    ],
    entrypoints: ['RagDocument'],
    kpis: ['document_index_rate', 'retrieval_accuracy'],
  },

  'Legacy': {
    description: 'Modelos legados (não geram jornadas automáticas)',
    criticality: 'low',
    models: [
      'LegacyRchatbot', 'LegacyRchatbotPattern', 'LegacyRchatbotResponse',
      'LegacyRchatbotAction', 'LegacyMonHost', 'LegacyMonService',
      'LegacyMonOs', 'LegacyMonApp',
    ],
    entrypoints: [],
    kpis: [],
    skipJourneyInference: true,
  },
};

/**
 * Constrói o domain map a partir da introspecção de models.
 */
function buildDomainMap(introspectionReport) {
  const models = introspectionReport.models || [];
  const modelNames = new Set(models.map(m => m.modelName));
  const domains = [];
  const assignedModels = new Set();

  for (const [domainName, domainDef] of Object.entries(DOMAIN_DEFINITIONS)) {
    const domainModels = [];
    const missingModels = [];

    for (const modelName of domainDef.models) {
      if (modelNames.has(modelName)) {
        const modelMeta = models.find(m => m.modelName === modelName);
        domainModels.push({
          modelName,
          tableName: modelMeta?.tableName || null,
          totalAttributes: modelMeta?.totalAttributes || 0,
          totalRequired: modelMeta?.totalRequired || 0,
          hasStatusField: Object.keys(modelMeta?.statusFields || {}).length > 0,
          hasJsonb: Object.keys(modelMeta?.jsonbFields || {}).length > 0,
          primaryKeys: modelMeta?.primaryKeys || [],
        });
        assignedModels.add(modelName);
      } else {
        missingModels.push(modelName);
      }
    }

    domains.push({
      domain: domainName,
      description: domainDef.description,
      criticality: domainDef.criticality,
      entrypoints: domainDef.entrypoints,
      kpis: domainDef.kpis,
      skipJourneyInference: domainDef.skipJourneyInference || false,
      modelCount: domainModels.length,
      expectedModelCount: domainDef.models.length,
      missingModels,
      models: domainModels,
    });
  }

  // Models não atribuídos
  const unassigned = models
    .filter(m => !assignedModels.has(m.modelName))
    .map(m => m.modelName);

  return {
    generatedAt: nowIso(),
    totalDomains: domains.length,
    totalModelsAssigned: assignedModels.size,
    totalModelsUnassigned: unassigned.length,
    unassignedModels: unassigned,
    domains,
  };
}

module.exports = {
  DOMAIN_DEFINITIONS,
  buildDomainMap,
};
