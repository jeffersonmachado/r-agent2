'use strict';

const getJourneyRegistryModel = require('../../db/models/JourneyRegistry');
const logger = require('../../utils/logger');

// Fail-closed: o service exige tenant explícito do caller (o boundary HTTP
// garante); sem tenant, lança TENANT_REQUIRED em vez de persistir/consultar o
// tenant 'system' por fallback silencioso.
function requireTenantId(tenantId) {
  const tid = typeof tenantId === 'string' ? tenantId.trim() : tenantId;
  if (!tid) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  return tid;
}

const DEFAULT_JOURNEYS = [
  { domain: 'sales', name: 'Lead Conversion', slug: 'lead-conversion', description: 'Converter leads em clientes', criticality: 'high' },
  { domain: 'service', name: 'Appointment Scheduling', slug: 'appointment-scheduling', description: 'Agendamento de compromissos', criticality: 'high' },
  { domain: 'fitness', name: 'Fitness Check-in', slug: 'fitness-checkin', description: 'Check-in em academia', criticality: 'medium' },
  { domain: 'support', name: 'Customer Support', slug: 'customer-support', description: 'Suporte ao cliente', criticality: 'high' },
  { domain: 'finance', name: 'Billing', slug: 'billing', description: 'Cobrança e faturamento', criticality: 'critical' },
  { domain: 'finance', name: 'Collection', slug: 'collection', description: 'Cobrança de inadimplentes', criticality: 'medium' },
  { domain: 'success', name: 'Retention', slug: 'retention', description: 'Retenção de clientes', criticality: 'high' },
];

async function listJourneys({ tenantId, filters = {} }) {
  const JourneyRegistry = getJourneyRegistryModel();
  const where = { tenant_id: requireTenantId(tenantId) };

  if (filters.domain) where.domain = filters.domain;
  if (filters.status) where.status = filters.status;
  if (filters.criticality) where.criticality = filters.criticality;

  return JourneyRegistry.findAll({ where, order: [['domain', 'ASC'], ['name', 'ASC']] });
}

async function getJourneyById(id, tenantId) {
  const JourneyRegistry = getJourneyRegistryModel();
  return JourneyRegistry.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
}

async function createJourney(data) {
  const JourneyRegistry = getJourneyRegistryModel();
  return JourneyRegistry.create({
    tenant_id: requireTenantId(data.tenantId),
    domain: data.domain,
    name: data.name,
    slug: data.slug,
    description: data.description || null,
    owner: data.owner || null,
    criticality: data.criticality || 'medium',
    sla: data.sla || {},
    kpis: data.kpis || {},
    successCriteria: data.successCriteria || [],
    scenarios: data.scenarios || [],
    status: data.status || 'draft',
  });
}

async function updateJourney(id, data, tenantId) {
  const JourneyRegistry = getJourneyRegistryModel();
  const journey = await JourneyRegistry.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
  if (!journey) return null;

  const updatableFields = [
    'domain', 'name', 'slug', 'description', 'owner', 'criticality',
    'sla', 'kpis', 'successCriteria', 'scenarios', 'status', 'metrics',
  ];
  for (const field of updatableFields) {
    if (data[field] !== undefined) journey[field] = data[field];
  }
  await journey.save();
  return journey;
}

async function deleteJourney(id, tenantId) {
  const JourneyRegistry = getJourneyRegistryModel();
  return JourneyRegistry.destroy({ where: { id, tenant_id: requireTenantId(tenantId) } });
}

async function seedDefaultJourneys(tenantId) {
  const JourneyRegistry = getJourneyRegistryModel();
  const existing = await JourneyRegistry.count({ where: { tenant_id: requireTenantId(tenantId) } });
  if (existing > 0) return [];

  const created = [];
  for (const j of DEFAULT_JOURNEYS) {
    const journey = await JourneyRegistry.create({
      tenant_id: requireTenantId(tenantId),
      ...j,
      sla: { responseTime: '5min', resolutionTime: '1h' },
      kpis: { csat: 90, resolutionRate: 95 },
      successCriteria: ['completed', 'customer_satisfied'],
      status: 'active',
    });
    created.push(journey);
  }
  logger.info(`[JourneyRegistry] Seeded ${created.length} default journeys`);
  return created;
}

module.exports = {
  listJourneys,
  getJourneyById,
  createJourney,
  updateJourney,
  deleteJourney,
  seedDefaultJourneys,
  DEFAULT_JOURNEYS,
};
