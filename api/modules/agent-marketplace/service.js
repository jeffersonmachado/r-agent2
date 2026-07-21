'use strict';

const logger = require('../../utils/logger');

const DEFAULT_AGENTS_CATALOG = [
  {
    name: 'SDR Agent', slug: 'sdr-agent',
    description: 'Agente de pré-vendas e qualificação de leads',
    category: 'sales',
    capabilities: ['lead_qualification', 'follow_up', 'meeting_scheduling', 'whatsapp_outreach'],
    tools: ['crm_integration', 'calendar', 'whatsapp', 'email'],
    knowledgeSources: ['crm', 'product_docs', 'sales_playbook'],
    classification: 'PRODUCTION',
  },
  {
    name: 'CRM Agent', slug: 'crm-agent',
    description: 'Agente de gestão de relacionamento com cliente',
    category: 'crm',
    capabilities: ['customer_lookup', 'profile_update', 'timeline_management', 'task_creation'],
    tools: ['crm_integration', 'workspace', 'ticket_system'],
    knowledgeSources: ['crm', 'customer_history', 'interaction_logs'],
    classification: 'PRODUCTION',
  },
  {
    name: 'Support Agent', slug: 'support-agent',
    description: 'Agente de suporte e atendimento ao cliente',
    category: 'support',
    capabilities: ['ticket_creation', 'issue_diagnosis', 'faq_lookup', 'handoff_human'],
    tools: ['ticket_system', 'knowledge_base', 'rag_service', 'whatsapp'],
    knowledgeSources: ['faq', 'product_docs', 'ticket_history', 'knowledge_base'],
    classification: 'PRODUCTION',
  },
  {
    name: 'Scheduling Agent', slug: 'scheduling-agent',
    description: 'Agente de agendamento de compromissos',
    category: 'operations',
    capabilities: ['appointment_booking', 'availability_check', 'reminder_send', 'reschedule'],
    tools: ['calendar', 'whatsapp', 'email', 'notification_service'],
    knowledgeSources: ['calendar', 'business_hours', 'service_catalog'],
    classification: 'PRODUCTION',
  },
  {
    name: 'Collection Agent', slug: 'collection-agent',
    description: 'Agente de cobrança e negociação',
    category: 'finance',
    capabilities: ['payment_reminder', 'negotiation', 'payment_plan', 'document_send'],
    tools: ['billing_system', 'whatsapp', 'email', 'payment_gateway'],
    knowledgeSources: ['payment_history', 'contracts', 'negotiation_rules'],
    classification: 'PRODUCTION',
  },
  {
    name: 'Campaign Agent', slug: 'campaign-agent',
    description: 'Agente de campanhas de marketing',
    category: 'marketing',
    capabilities: ['campaign_execution', 'audience_selection', 'message_personalization', 'performance_tracking'],
    tools: ['campaign_engine', 'whatsapp', 'email', 'analytics'],
    knowledgeSources: ['customer_segments', 'campaign_history', 'marketing_playbook'],
    classification: 'PRODUCTION',
  },
  {
    name: 'Knowledge Agent', slug: 'knowledge-agent',
    description: 'Agente de gestão de conhecimento',
    category: 'knowledge',
    capabilities: ['document_indexing', 'knowledge_retrieval', 'content_summarization', 'gap_detection'],
    tools: ['rag_service', 'document_parser', 'vector_store'],
    knowledgeSources: ['documents', 'faq', 'product_docs', 'ticket_history'],
    classification: 'PRODUCTION',
  },
  {
    name: 'QA Agent', slug: 'qa-agent',
    description: 'Agente de garantia de qualidade',
    category: 'qa',
    capabilities: ['scenario_generation', 'regression_detection', 'coverage_analysis', 'governance_check'],
    tools: ['qa_mesh', 'qa_waves', 'replay_engine', 'evidence_collector'],
    knowledgeSources: ['test_scenarios', 'journey_definitions', 'qa_history'],
    classification: 'SUPPORT',
  },
  {
    name: 'Discovery Agent', slug: 'discovery-agent',
    description: 'Agente de descoberta de padrões e insights',
    category: 'analytics',
    capabilities: ['pattern_detection', 'anomaly_detection', 'trend_analysis', 'recommendation_generation'],
    tools: ['analytics_engine', 'data_pipeline', 'ml_models'],
    knowledgeSources: ['metrics', 'journeys', 'customer_data', 'market_data'],
    classification: 'DEVELOPMENT',
  },
  {
    name: 'Dev Agent', slug: 'dev-agent',
    description: 'Agente de suporte a desenvolvimento',
    category: 'development',
    capabilities: ['code_generation', 'test_generation', 'architecture_validation', 'documentation'],
    tools: ['code_analyzer', 'test_runner', 'governance_validator'],
    knowledgeSources: ['codebase', 'architecture_docs', 'coding_standards'],
    classification: 'DEVELOPMENT',
  },
];

function getMarketplaceCatalog() {
  return DEFAULT_AGENTS_CATALOG;
}

function getAgentBySlug(slug) {
  return DEFAULT_AGENTS_CATALOG.find(a => a.slug === slug) || null;
}

function getAgentsByCategory(category) {
  if (!category) return DEFAULT_AGENTS_CATALOG;
  return DEFAULT_AGENTS_CATALOG.filter(a => a.category === category);
}

module.exports = {
  getMarketplaceCatalog,
  getAgentBySlug,
  getAgentsByCategory,
  DEFAULT_AGENTS_CATALOG,
};
