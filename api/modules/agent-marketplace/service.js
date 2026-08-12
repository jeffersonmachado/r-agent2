'use strict';

const logger = require('../../utils/logger');

/**
 * Catálogo de Specialist Agent Profiles (marketplace do Agent OS).
 *
 * Taxonomia alvo (2026-08-09):
 *   PRODUCTION  → agentes de negócio (atendimento, vendas, agenda, cobrança,
 *                 campanhas, voz, operações, conhecimento operacional)
 *   SUPPORT     → diagnóstico da plataforma RAP (incidentes, auditoria/replay)
 *   DEVELOPMENT → engenharia (QA Waves/Mesh, conhecimento de plataforma, dev)
 *
 * "Customer Service" (atendimento ao cliente, PRODUCTION) NÃO se confunde com
 * "Platform Support" (diagnóstico do RAP, SUPPORT).
 *
 * RPA não é agente operacional: não existe RPA Agent no catálogo. RPA é
 * adapter interno de integração (executor), invisível à experiência.
 *
 * `profile` é o Specialist Agent Profile declarativo persistido em
 * corporate_agents.config (JSONB) — sem colunas novas.
 *
 * Aliases legados mantêm compatibilidade de slugs antigos.
 */

const DEFAULT_AGENTS_CATALOG = [
  // ── PRODUCTION ──────────────────────────────────────────────────────────
  {
    name: 'Sales / SDR Agent', slug: 'sdr-agent',
    description: 'Agente de pré-vendas e qualificação de leads',
    category: 'sales',
    capabilities: ['crm.read', 'crm.write', 'schedule.manage', 'messaging.send'],
    tools: ['crm.searchCustomer', 'crm.createLead', 'crm.updateLead', 'schedule.createAppointment', 'messaging.sendWhatsAppMessage'],
    knowledgeSources: ['crm', 'product_docs', 'sales_playbook'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'qualify_and_convert_leads',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'crm.createLead': 'autonomous', 'schedule.createAppointment': 'autonomous' },
      delegation: { allowed: ['scheduling-agent', 'customer-service-agent'] },
      verticals: { inherited: true },
      channels: ['whatsapp', 'inbox', 'voice', 'workspace'],
    },
  },
  {
    name: 'Customer / CRM Agent', slug: 'crm-agent',
    description: 'Agente de gestão de relacionamento com cliente',
    category: 'crm',
    capabilities: ['crm.read', 'crm.write', 'ticket.manage'],
    tools: ['crm.searchCustomer', 'crm.updateLead', 'support.createTicket'],
    knowledgeSources: ['crm', 'customer_history', 'interaction_logs'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'manage_customer_relationship',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'crm.searchCustomer': 'autonomous', 'crm.updateLead': 'policy_based' },
      delegation: { allowed: ['customer-service-agent', 'collection-agent'] },
      verticals: { inherited: true },
    },
  },
  {
    name: 'Customer Service Agent', slug: 'customer-service-agent',
    description: 'Agente de atendimento ao cliente (PRODUCTION — não confundir com Platform Support)',
    category: 'customer_service',
    capabilities: ['ticket.manage', 'knowledge.operational', 'crm.read', 'messaging.send'],
    tools: ['support.createTicket', 'support.transferConversation', 'knowledge.searchOperational', 'crm.searchCustomer', 'messaging.sendWhatsAppMessage'],
    knowledgeSources: ['faq', 'product_docs', 'ticket_history', 'knowledge_base'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'resolve_customer_requests',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'support.createTicket': 'autonomous', 'support.transferConversation': 'policy_based' },
      delegation: { allowed: ['crm-agent', 'scheduling-agent'] },
      verticals: { inherited: true },
    },
  },
  {
    name: 'Scheduling Agent', slug: 'scheduling-agent',
    description: 'Agente de agendamento de compromissos',
    category: 'operations',
    capabilities: ['schedule.read', 'schedule.manage', 'crm.read', 'messaging.send'],
    tools: ['schedule.listAppointments', 'schedule.createAppointment', 'schedule.rescheduleAppointment', 'schedule.cancelAppointment', 'crm.searchCustomer', 'messaging.sendWhatsAppMessage'],
    knowledgeSources: ['calendar', 'business_hours', 'service_catalog'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'manage_customer_appointments',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: {
        'schedule.createAppointment': 'autonomous',
        'schedule.rescheduleAppointment': 'policy_based',
        'schedule.cancelAppointment': 'policy_based',
      },
      delegation: { allowed: ['crm-agent', 'customer-service-agent'] },
      verticals: { inherited: true },
    },
  },
  {
    name: 'Collection / Billing Agent', slug: 'collection-agent',
    description: 'Agente de cobrança e negociação',
    category: 'finance',
    capabilities: ['crm.read', 'messaging.send'],
    tools: ['crm.searchCustomer', 'messaging.sendWhatsAppMessage'],
    knowledgeSources: ['payment_history', 'contracts', 'negotiation_rules'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'recover_receivables',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'messaging.sendWhatsAppMessage': 'policy_based' },
      delegation: { allowed: ['crm-agent'] },
      verticals: { inherited: true },
    },
  },
  {
    name: 'Campaign / Growth Agent', slug: 'campaign-agent',
    description: 'Agente de campanhas de marketing e growth',
    category: 'marketing',
    capabilities: ['campaign.manage', 'crm.read', 'messaging.send'],
    tools: ['campaign.createCampaign', 'crm.searchCustomer', 'messaging.sendWhatsAppMessage'],
    knowledgeSources: ['customer_segments', 'campaign_history', 'marketing_playbook'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'run_growth_campaigns',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'campaign.createCampaign': 'confirmation_required' },
      delegation: { allowed: ['crm-agent'] },
      verticals: { inherited: true },
    },
  },
  {
    name: 'Voice Agent', slug: 'voice-agent',
    description: 'Agente de voz (originação e gestão de chamadas)',
    category: 'voice',
    capabilities: ['voice.call', 'crm.read', 'ticket.manage'],
    tools: ['voice.originateCall', 'crm.searchCustomer', 'support.createTicket'],
    knowledgeSources: ['call_scripts', 'crm'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'handle_voice_interactions',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'voice.originateCall': 'policy_based' },
      delegation: { allowed: ['customer-service-agent'] },
      channels: ['voice', 'pbx'],
      verticals: { inherited: true },
    },
  },
  {
    name: 'Operations Agent', slug: 'operations-agent',
    description: 'Agente de operações (coordena processos duráveis e integrações; executores internos como adapters de integração ficam invisíveis à operação)',
    category: 'operations',
    capabilities: ['crm.read', 'schedule.read', 'ticket.manage', 'workspace.insight'],
    tools: ['crm.searchCustomer', 'schedule.listAppointments', 'support.createTicket', 'workspace.generateInsight'],
    knowledgeSources: ['operational_docs', 'process_catalog'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'coordinate_operational_processes',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'workspace.generateInsight': 'autonomous' },
      processPolicy: { durablePreferred: true },
      delegation: { allowed: ['customer-service-agent', 'scheduling-agent'] },
      verticals: { inherited: true },
    },
  },
  {
    name: 'Operational Knowledge Agent', slug: 'operational-knowledge-agent',
    description: 'Agente de conhecimento operacional (RAG domínio OPERATIONAL, por tenant)',
    category: 'knowledge',
    capabilities: ['knowledge.operational'],
    tools: ['knowledge.searchOperational'],
    knowledgeSources: ['documents', 'faq', 'product_docs', 'ticket_history'],
    classification: 'PRODUCTION',
    profile: {
      goal: 'answer_operational_questions',
      knowledge: { domain: 'OPERATIONAL' },
      autonomy: { 'knowledge.searchOperational': 'autonomous' },
      delegation: { allowed: ['customer-service-agent'] },
      verticals: { inherited: true },
    },
  },

  // ── SUPPORT (diagnóstico da plataforma RAP — nunca atendimento a cliente) ──
  {
    name: 'Incident & Diagnostic Agent', slug: 'incident-diagnostic-agent',
    description: 'Agente de incidentes e diagnóstico da plataforma (suporte ao RAP)',
    category: 'platform_support',
    capabilities: ['support.diagnose', 'knowledge.system'],
    tools: ['knowledge.searchSystem'],
    knowledgeSources: ['system_logs', 'runbooks', 'incident_history'],
    classification: 'SUPPORT',
    profile: {
      goal: 'diagnose_platform_incidents',
      knowledge: { domain: 'SYSTEM' },
      autonomy: { 'knowledge.searchSystem': 'autonomous' },
      delegation: { allowed: ['audit-replay-agent'] },
      channels: ['workspace'],
    },
  },
  {
    name: 'Audit & Replay Agent', slug: 'audit-replay-agent',
    description: 'Agente de auditoria e replay diagnóstico (evidências, logs, trilhas)',
    category: 'platform_support',
    capabilities: ['audit.replay'],
    tools: ['audit.listReplays'],
    knowledgeSources: ['audit_trails', 'evidence_store'],
    classification: 'SUPPORT',
    profile: {
      goal: 'audit_and_replay_diagnostics',
      knowledge: { domain: 'SYSTEM' },
      autonomy: { 'audit.listReplays': 'autonomous' },
      delegation: { allowed: ['incident-diagnostic-agent'] },
      channels: ['workspace'],
    },
  },

  // ── DEVELOPMENT (engenharia — invisível à operação) ──────────────────────
  {
    name: 'QA Engineering Agent', slug: 'qa-engineering-agent',
    description: 'Agente de engenharia de qualidade (QA Waves, QA Mesh, Seeds, cobertura, regressão, replay de engenharia)',
    category: 'qa',
    capabilities: ['qa.waves', 'qa.mesh'],
    tools: ['qa.getWaveStatus'],
    knowledgeSources: ['test_scenarios', 'journey_definitions', 'qa_history'],
    classification: 'DEVELOPMENT',
    profile: {
      goal: 'assure_platform_quality',
      knowledge: { domain: 'SYSTEM' },
      autonomy: { 'qa.getWaveStatus': 'autonomous' },
      delegation: { allowed: ['dev-agent'] },
      channels: ['workspace'],
    },
  },
  {
    name: 'Platform Knowledge Agent', slug: 'platform-knowledge-agent',
    description: 'Agente de conhecimento de plataforma (RAG domínio SYSTEM; nunca mistura com conhecimento operacional)',
    category: 'knowledge',
    capabilities: ['knowledge.system'],
    tools: ['knowledge.searchSystem'],
    knowledgeSources: ['architecture_docs', 'codebase', 'runbooks'],
    classification: 'DEVELOPMENT',
    profile: {
      goal: 'answer_platform_engineering_questions',
      knowledge: { domain: 'SYSTEM' },
      autonomy: { 'knowledge.searchSystem': 'autonomous' },
      delegation: { allowed: ['qa-engineering-agent', 'dev-agent'] },
      channels: ['workspace'],
    },
  },
  {
    name: 'Development Agent', slug: 'dev-agent',
    description: 'Agente de suporte a desenvolvimento',
    category: 'development',
    capabilities: ['qa.mesh'],
    tools: ['qa.getWaveStatus'],
    knowledgeSources: ['codebase', 'architecture_docs', 'coding_standards'],
    classification: 'DEVELOPMENT',
    profile: {
      goal: 'support_engineering_workflows',
      knowledge: { domain: 'SYSTEM' },
      delegation: { allowed: ['qa-engineering-agent'] },
      channels: ['workspace'],
    },
  },
  {
    name: 'Discovery / Engineering Analytics Agent', slug: 'discovery-agent',
    description: 'Agente de descoberta de padrões e analytics de engenharia',
    category: 'analytics',
    capabilities: ['workspace.insight'],
    tools: ['workspace.generateInsight'],
    knowledgeSources: ['metrics', 'journeys', 'market_data'],
    classification: 'DEVELOPMENT',
    profile: {
      goal: 'discover_engineering_patterns',
      knowledge: { domain: 'SYSTEM' },
      delegation: { allowed: ['dev-agent'] },
      channels: ['workspace'],
    },
  },
];

/**
 * Aliases de slugs legados → slug canônico (compatibilidade de instalação).
 * 'support-agent' era atendimento ao cliente com nome ambíguo: agora aponta
 * para o Customer Service Agent. 'qa-agent' misturava SUPPORT com QA Waves:
 * aponta para o QA Engineering Agent (DEVELOPMENT).
 */
const LEGACY_SLUG_ALIASES = Object.freeze({
  'support-agent': 'customer-service-agent',
  'knowledge-agent': 'operational-knowledge-agent',
  'qa-agent': 'qa-engineering-agent',
});

function getMarketplaceCatalog() {
  return DEFAULT_AGENTS_CATALOG;
}

function resolveSlug(slug) {
  const key = String(slug || '').trim();
  return LEGACY_SLUG_ALIASES[key] || key;
}

function getAgentBySlug(slug) {
  const canonical = resolveSlug(slug);
  return DEFAULT_AGENTS_CATALOG.find(a => a.slug === canonical) || null;
}

function getAgentsByCategory(category) {
  if (!category) return DEFAULT_AGENTS_CATALOG;
  return DEFAULT_AGENTS_CATALOG.filter(a => a.category === category);
}

function getAgentsByClassification(classification) {
  if (!classification) return DEFAULT_AGENTS_CATALOG;
  const key = String(classification).toUpperCase();
  return DEFAULT_AGENTS_CATALOG.filter(a => a.classification === key);
}

module.exports = {
  getMarketplaceCatalog,
  getAgentBySlug,
  getAgentsByCategory,
  getAgentsByClassification,
  resolveSlug,
  LEGACY_SLUG_ALIASES,
  DEFAULT_AGENTS_CATALOG,
};
