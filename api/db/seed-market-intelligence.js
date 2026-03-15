'use strict';

const { connect, close } = require('./sequelize');
const { buildId } = require('../core/tenant-intelligence/helpers');

async function upsertByKeys(sequelize, table, keyFields, payload) {
  const whereClause = keyFields.map((field) => `${field} = :${field}`).join(' AND ');
  const [rows] = await sequelize.query(
    `SELECT id FROM ${table} WHERE ${whereClause} LIMIT 1`,
    { replacements: payload },
  );

  if (rows[0]?.id) {
    const updateFields = Object.keys(payload)
      .filter((field) => field !== 'id')
      .map((field) => `${field} = :${field}`)
      .join(', ');

    await sequelize.query(
      `UPDATE ${table}
       SET ${updateFields}, updated_at = CURRENT_TIMESTAMP
       WHERE id = :existingId`,
      {
        replacements: {
          ...payload,
          existingId: rows[0].id,
        },
      },
    );
    return { action: 'updated', id: rows[0].id };
  }

  const fields = Object.keys(payload);
  const placeholders = fields.map((field) => `:${field}`).join(', ');
  await sequelize.query(
    `INSERT INTO ${table} (${fields.join(', ')}, created_at, updated_at)
     VALUES (${placeholders}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    { replacements: payload },
  );
  return { action: 'inserted', id: payload.id };
}

async function seedMarketIntelligence() {
  await connect();
  const { getSequelize } = require('./sequelize');
  const sequelize = getSequelize();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const aggregates = [
    {
      id: buildId('market-agg'),
      vertical: 'global',
      region: 'global',
      metric_key: 'cancellation_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.17,
      median_value: 0.16,
      p90_value: 0.24,
      sample_size: 84,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'global',
      region: 'global',
      metric_key: 'conversion_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.18,
      median_value: 0.17,
      p90_value: 0.29,
      sample_size: 77,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'beauty',
      region: 'global',
      metric_key: 'no_show_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.14,
      median_value: 0.12,
      p90_value: 0.22,
      sample_size: 31,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'beauty',
      region: 'global',
      metric_key: 'cancellation_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.15,
      median_value: 0.14,
      p90_value: 0.21,
      sample_size: 29,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'beauty',
      region: 'global',
      metric_key: 'attendance_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.81,
      median_value: 0.83,
      p90_value: 0.93,
      sample_size: 27,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'global',
      region: 'global',
      metric_key: 'attendance_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.79,
      median_value: 0.8,
      p90_value: 0.91,
      sample_size: 66,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'beauty',
      region: 'global',
      metric_key: 'churn_rate',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 0.09,
      median_value: 0.08,
      p90_value: 0.15,
      sample_size: 23,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-agg'),
      vertical: 'global',
      region: 'global',
      metric_key: 'avg_response_time',
      period_start: monthStart,
      period_end: monthEnd,
      avg_value: 4.2,
      median_value: 3.8,
      p90_value: 7.1,
      sample_size: 91,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true, unit: 'minutes' }),
    },
  ];

  const patterns = [
    {
      id: buildId('market-pattern'),
      vertical: 'beauty',
      pattern_type: 'churn_signal',
      description: 'clientes com duas faltas seguidas apresentam alto risco de abandono',
      confidence: 0.82,
      evidence: JSON.stringify({ signal: 'double_no_show', anonymized: true }),
      detected_at: now,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-pattern'),
      vertical: 'global',
      pattern_type: 'conversion_peak_window',
      description: 'respostas em menos de 5 minutos tendem a elevar a conversao em janelas comerciais',
      confidence: 0.74,
      evidence: JSON.stringify({ signal: 'fast_first_response', anonymized: true }),
      detected_at: now,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-pattern'),
      vertical: 'beauty',
      pattern_type: 'reschedule_recovery',
      description: 'oferecer remarcacao em ate 15 minutos apos o cancelamento reduz perda de receita em segmentos de agenda',
      confidence: 0.71,
      evidence: JSON.stringify({ signal: 'fast_reschedule_offer', anonymized: true }),
      detected_at: now,
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
  ];

  const playbooks = [
    {
      id: buildId('market-playbook'),
      vertical: 'beauty',
      problem_type: 'no_show',
      playbook_name: 'double_confirmation_flow',
      description: 'confirmacao em duas etapas com lembrete no dia anterior e no dia do atendimento',
      success_rate: 0.67,
      evidence: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-playbook'),
      vertical: 'global',
      problem_type: 'cancellation',
      playbook_name: 'reschedule_recovery_flow',
      description: 'oferecer remarcacao guiada imediatamente apos pedido de cancelamento',
      success_rate: 0.58,
      evidence: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
    {
      id: buildId('market-playbook'),
      vertical: 'beauty',
      problem_type: 'conversion',
      playbook_name: 'first_response_under_five_minutes',
      description: 'priorizar primeiro retorno em menos de 5 minutos durante horario comercial',
      success_rate: 0.61,
      evidence: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
      metadata: JSON.stringify({ source: 'bootstrap_v1', anonymized: true }),
    },
  ];

  const summary = [];

  for (const row of aggregates) {
    // eslint-disable-next-line no-await-in-loop
    summary.push(['market_metric_aggregates', await upsertByKeys(
      sequelize,
      'market_metric_aggregates',
      ['vertical', 'region', 'metric_key', 'period_start', 'period_end'],
      row,
    )]);
  }

  for (const row of patterns) {
    // eslint-disable-next-line no-await-in-loop
    summary.push(['market_patterns', await upsertByKeys(
      sequelize,
      'market_patterns',
      ['vertical', 'pattern_type', 'description'],
      row,
    )]);
  }

  for (const row of playbooks) {
    // eslint-disable-next-line no-await-in-loop
    summary.push(['market_playbooks', await upsertByKeys(
      sequelize,
      'market_playbooks',
      ['vertical', 'problem_type', 'playbook_name'],
      row,
    )]);
  }

  return summary;
}

if (require.main === module) {
  seedMarketIntelligence()
    .then(async (summary) => {
      console.log(JSON.stringify({ ok: true, summary }, null, 2));
      await close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      try { await close(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = {
  seedMarketIntelligence,
};
