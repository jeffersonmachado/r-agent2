'use strict';

const logger = require('../utils/logger');

const { connect, close } = require('./sequelize');
const { buildId } = require('../core/tenant-intelligence/helpers');
const { getMarketKnowledgeService } = require('../core/market-intelligence/MarketKnowledgeService');

async function upsertTenantContext(sequelize, payload) {
  const [rows] = await sequelize.query(
    `SELECT tenant_key FROM tenant_contexts WHERE tenant_key = :tenant_key LIMIT 1`,
    { replacements: payload },
  );

  if (rows[0]?.tenant_key) {
    await sequelize.query(
      `UPDATE tenant_contexts
       SET ramo_atividade = :ramo_atividade,
           objetivo = :objetivo,
           site_oficial = :site_oficial,
           prioridade = :prioridade,
           escopo = CAST(:escopo AS jsonb),
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_key = :tenant_key`,
      {
        replacements: {
          ...payload,
          escopo: JSON.stringify(payload.escopo),
        },
      },
    );
    return 'updated';
  }

  await sequelize.query(
    `INSERT INTO tenant_contexts
       (tenant_key, ramo_atividade, objetivo, site_oficial, prioridade, escopo, created_at, updated_at)
     VALUES
       (:tenant_key, :ramo_atividade, :objetivo, :site_oficial, :prioridade, CAST(:escopo AS jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    {
      replacements: {
        ...payload,
        escopo: JSON.stringify(payload.escopo),
      },
    },
  );
  return 'inserted';
}

async function upsertSnapshot(sequelize, payload) {
  const [rows] = await sequelize.query(
    `SELECT id
       FROM tenant_metric_snapshots
      WHERE tenant_key = :tenant_key
        AND metric_key = :metric_key
      ORDER BY period_end DESC, created_at DESC
      LIMIT 1`,
    { replacements: payload },
  );

  if (rows[0]?.id) {
    await sequelize.query(
      `UPDATE tenant_metric_snapshots
          SET value = :value,
              period_start = :period_start,
              period_end = :period_end,
              dimensions = CAST(:dimensions AS jsonb),
              source = :source,
              metadata = CAST(:metadata AS jsonb),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = :existing_id`,
      {
        replacements: {
          ...payload,
          existing_id: rows[0].id,
          dimensions: JSON.stringify(payload.dimensions),
          metadata: JSON.stringify(payload.metadata),
        },
      },
    );
    return { action: 'updated', id: rows[0].id };
  }

  await sequelize.query(
    `INSERT INTO tenant_metric_snapshots
       (id, tenant_key, metric_key, value, period_start, period_end, dimensions, source, metadata, created_at, updated_at)
     VALUES
       (:id, :tenant_key, :metric_key, :value, :period_start, :period_end, CAST(:dimensions AS jsonb), :source, CAST(:metadata AS jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    {
      replacements: {
        ...payload,
        dimensions: JSON.stringify(payload.dimensions),
        metadata: JSON.stringify(payload.metadata),
      },
    },
  );
  return { action: 'inserted', id: payload.id };
}

async function seedMarketIntelligenceDemo() {
  await connect();
  const { getSequelize } = require('./sequelize');
  const sequelize = getSequelize();

  const tenantKey = 'tenant-demo';
  const [tenantRows] = await sequelize.query(
    `SELECT tenant_key FROM tenants WHERE tenant_key = :tenant_key LIMIT 1`,
    { replacements: { tenant_key: tenantKey } },
  );
  if (!tenantRows[0]?.tenant_key) {
    throw new Error(`tenant ${tenantKey} not found`);
  }

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const tenantContextAction = await upsertTenantContext(sequelize, {
    tenant_key: tenantKey,
    ramo_atividade: 'beauty',
    objetivo: 'reduzir cancelamentos e faltas sem perder conversao',
    site_oficial: 'https://tenant-demo.local',
    prioridade: 'HIGH',
    escopo: ['rag', 'chatbot', 'classificacao_intencao'],
  });

  const snapshots = [
    {
      id: buildId('metric'),
      tenant_key: tenantKey,
      metric_key: 'cancellation_rate',
      value: 0.24,
      period_start: periodStart,
      period_end: periodEnd,
      dimensions: { period: 'month', source_scope: 'homologation_demo' },
      source: 'market_intelligence_demo_seed',
      metadata: { seeded: true, anonymized: false, purpose: 'homologation' },
    },
    {
      id: buildId('metric'),
      tenant_key: tenantKey,
      metric_key: 'no_show_rate',
      value: 0.21,
      period_start: periodStart,
      period_end: periodEnd,
      dimensions: { period: 'month', source_scope: 'homologation_demo' },
      source: 'market_intelligence_demo_seed',
      metadata: { seeded: true, anonymized: false, purpose: 'homologation' },
    },
    {
      id: buildId('metric'),
      tenant_key: tenantKey,
      metric_key: 'conversion_rate',
      value: 0.11,
      period_start: periodStart,
      period_end: periodEnd,
      dimensions: { period: 'month', source_scope: 'homologation_demo' },
      source: 'market_intelligence_demo_seed',
      metadata: { seeded: true, anonymized: false, purpose: 'homologation' },
    },
    {
      id: buildId('metric'),
      tenant_key: tenantKey,
      metric_key: 'attendance_rate',
      value: 0.69,
      period_start: periodStart,
      period_end: periodEnd,
      dimensions: { period: 'month', source_scope: 'homologation_demo' },
      source: 'market_intelligence_demo_seed',
      metadata: { seeded: true, anonymized: false, purpose: 'homologation' },
    },
  ];

  const snapshotSummary = [];
  for (const snapshot of snapshots) {
    // eslint-disable-next-line no-await-in-loop
    snapshotSummary.push(await upsertSnapshot(sequelize, snapshot));
  }

  const service = getMarketKnowledgeService();
  const benchmarks = await service.getBenchmarks(tenantKey, {
    metricKeys: ['cancellation_rate', 'no_show_rate', 'conversion_rate'],
    vertical: 'beauty',
  });
  const predictions = await service.getPredictions(tenantKey, {
    metricKeys: ['attendance_rate', 'cancellation_rate'],
    vertical: 'beauty',
    forceRefresh: true,
  });

  return {
    tenantKey,
    tenantContextAction,
    snapshots: snapshotSummary,
    benchmarks,
    predictions,
  };
}

if (require.main === module) {
  seedMarketIntelligenceDemo()
    .then(async (result) => {
      logger.info(JSON.stringify({ ok: true, result }, null, 2));
      await close();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error(err);
      try { await close(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = {
  seedMarketIntelligenceDemo,
};
