'use strict';

const getJourneyRegistryModel = require('../../db/models/JourneyRegistry');
const logger = require('../../utils/logger');

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
  const where = { tenant_id: tenantId || 'system' };

  if (filters.domain) where.domain = filters.domain;
  if (filters.status) where.status = filters.status;
  if (filters.criticality) where.criticality = filters.criticality;

  return JourneyRegistry.findAll({ where, order: [['domain', 'ASC'], ['name', 'ASC']] });
}

async function getJourneyById(id, tenantId) {
  const JourneyRegistry = getJourneyRegistryModel();
  return JourneyRegistry.findOne({ where: { id, tenant_id: tenantId || 'system' } });
}

async function createJourney(data) {
  const JourneyRegistry = getJourneyRegistryModel();
  return JourneyRegistry.create({
    tenant_id: data.tenantId || 'system',
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
  const journey = await JourneyRegistry.findOne({ where: { id, tenant_id: tenantId || 'system' } });
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
  return JourneyRegistry.destroy({ where: { id, tenant_id: tenantId || 'system' } });
}

async function seedDefaultJourneys(tenantId) {
  const JourneyRegistry = getJourneyRegistryModel();
  const existing = await JourneyRegistry.count({ where: { tenant_id: tenantId || 'system' } });
  if (existing > 0) return [];

  const created = [];
  for (const j of DEFAULT_JOURNEYS) {
    const journey = await JourneyRegistry.create({
      tenant_id: tenantId || 'system',
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
