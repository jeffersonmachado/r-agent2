'use strict';

const getVerticalTemplateModel = require('../../db/models/VerticalTemplate');
const logger = require('../../utils/logger');

// Fail-closed: o service exige tenant explícito do caller (o boundary HTTP
// garante); sem tenant, lança TENANT_REQUIRED em vez de persistir/consultar o
// tenant 'system' por fallback silencioso.
function requireTenantId(tenantId) {
  const tid = typeof tenantId === 'string' ? tenantId.trim() : tenantId;
  if (!tid) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  return tid;
}

const DEFAULT_TEMPLATES = [
  {
    category: 'Beauty', name: 'Beauty', slug: 'beauty',
    description: 'Template para salões de beleza e barbearias',
    icon: '💇', color: '#ec4899',
    journeys: ['lead-conversion', 'appointment-scheduling', 'customer-support', 'billing', 'retention'],
    agents: ['sdr-agent', 'crm-agent', 'support-agent', 'scheduling-agent'],
    kpis: ['agendamentos', 'faturamento', 'retencao', 'csat'],
  },
  {
    category: 'Fitness', name: 'Fitness', slug: 'fitness',
    description: 'Template para academias e estúdios',
    icon: '🏋️', color: '#10b981',
    journeys: ['lead-conversion', 'fitness-checkin', 'billing', 'retention'],
    agents: ['sdr-agent', 'crm-agent', 'support-agent'],
    kpis: ['checkins', 'adesao', 'retencao', 'csat'],
  },
  {
    category: 'Food', name: 'Food', slug: 'food',
    description: 'Template para restaurantes e delivery',
    icon: '🍽️', color: '#f97316',
    journeys: ['customer-support', 'billing', 'retention'],
    agents: ['support-agent', 'crm-agent'],
    kpis: ['pedidos', 'faturamento', 'csat', 'tempo-entrega'],
  },
  {
    category: 'Clinic', name: 'Clinic', slug: 'clinic',
    description: 'Template para clínicas e consultórios',
    icon: '🏥', color: '#14b8a6',
    journeys: ['appointment-scheduling', 'customer-support', 'billing', 'retention'],
    agents: ['scheduling-agent', 'support-agent', 'crm-agent'],
    kpis: ['consultas', 'faturamento', 'csat'],
  },
  {
    category: 'Bakery', name: 'Bakery', slug: 'bakery',
    description: 'Template para padarias e confeitarias',
    icon: '🥖', color: '#eab308',
    journeys: ['bakery-encomendas', 'bakery-balcao-retirada', 'bakery-producao-fornada', 'bakery-estoque-perdas', 'bakery-reativacao-cliente'],
    agents: ['support-agent', 'crm-agent', 'scheduling-agent'],
    kpis: ['vendas', 'ticket-medio', 'utilizacao-forno', 'fulfillment', 'perda-descarte', 'retencao', 'csat'],
  },
  {
    category: 'Services', name: 'Services', slug: 'services',
    description: 'Template para prestadores de serviços',
    icon: '🔧', color: '#3b82f6',
    journeys: ['lead-conversion', 'appointment-scheduling', 'billing', 'retention'],
    agents: ['sdr-agent', 'scheduling-agent', 'support-agent'],
    kpis: ['servicos', 'faturamento', 'csat'],
  },
  {
    category: 'Retail', name: 'Retail', slug: 'retail',
    description: 'Template para lojas e varejo',
    icon: '🛍️', color: '#ef4444',
    journeys: ['lead-conversion', 'customer-support', 'billing', 'retention'],
    agents: ['sdr-agent', 'crm-agent', 'support-agent'],
    kpis: ['vendas', 'faturamento', 'csat', 'ticket-medio'],
  },
];

async function listTemplates({ tenantId, filters = {} }) {
  const VerticalTemplate = getVerticalTemplateModel();
  const where = { tenant_id: requireTenantId(tenantId) };

  if (filters.category) where.category = filters.category;
  if (filters.status) where.status = filters.status;

  return VerticalTemplate.findAll({ where, order: [['category', 'ASC']] });
}

async function getTemplateById(id, tenantId) {
  const VerticalTemplate = getVerticalTemplateModel();
  return VerticalTemplate.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
}

async function createTemplate(data) {
  const VerticalTemplate = getVerticalTemplateModel();
  return VerticalTemplate.create({
    tenant_id: requireTenantId(data.tenantId),
    name: data.name,
    slug: data.slug,
    category: data.category,
    description: data.description || null,
    icon: data.icon || null,
    color: data.color || null,
    journeys: data.journeys || [],
    agents: data.agents || [],
    knowledge: data.knowledge || [],
    automations: data.automations || [],
    kpis: data.kpis || [],
    config: data.config || {},
  });
}

async function updateTemplate(id, data, tenantId) {
  const VerticalTemplate = getVerticalTemplateModel();
  const tmpl = await VerticalTemplate.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
  if (!tmpl) return null;

  const updatableFields = [
    'name', 'slug', 'category', 'description', 'icon', 'color',
    'journeys', 'agents', 'knowledge', 'automations', 'kpis', 'config', 'status',
  ];
  for (const field of updatableFields) {
    if (data[field] !== undefined) tmpl[field] = data[field];
  }
  await tmpl.save();
  return tmpl;
}

async function seedDefaultTemplates(tenantId) {
  const VerticalTemplate = getVerticalTemplateModel();
  const existing = await VerticalTemplate.count({ where: { tenant_id: requireTenantId(tenantId) } });
  if (existing > 0) return [];

  const created = [];
  for (const t of DEFAULT_TEMPLATES) {
    const tmpl = await VerticalTemplate.create({
      tenant_id: requireTenantId(tenantId),
      ...t,
      status: 'published',
    });
    created.push(tmpl);
  }
  logger.info(`[VerticalTemplates] Seeded ${created.length} default templates`);
  return created;
}

module.exports = {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  seedDefaultTemplates,
  DEFAULT_TEMPLATES,
};
