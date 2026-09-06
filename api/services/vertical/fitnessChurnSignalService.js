'use strict';

/**
 * Sinal de churn/inatividade da vertical Fitness para o Workspace
 * (Customer 360).
 *
 * O engagement engine já computa sinais de engajamento com ML real
 * (churnModelService → vertical_engagement_signals), mas nada disso
 * aparecia para o operador. Este serviço resolve telefone do contato →
 * subject fitness → sinal mais recente, para virar insight operacional e
 * Next Best Action.
 *
 * Fonte durável: vertical_engagement_signals (score calculado por modelo
 * de regressão logística treinado com o histórico real do tenant).
 */

const { Op } = require('sequelize');
const models = require('../../db/models');
const { findSubjectsByPhone } = require('./noShowSignalService');

const SIGNAL_LOOKBACK_DAYS = 30;
const SIGNAL_TYPES = ['churn_risk', 'low_frequency', 'inactive'];

/**
 * Sinal de engajamento fitness mais recente do contato (por telefone).
 * @returns {Promise<null|{signalId: string, signalType: string, score: number|null,
 *   daysSinceLastVisit: number|null, frequency30d: number|null, computedAt: string, computedBy: string|null}>}
 */
async function latestFitnessSignalByPhone({ tenantId, phone, lookbackDays = SIGNAL_LOOKBACK_DAYS } = {}) {
  if (!tenantId || !phone) return null;
  const subjects = await findSubjectsByPhone({ tenantId, phone }).catch(() => []);
  const subjectIds = subjects
    .map((item) => String((item.toJSON ? item.toJSON() : item).id || ''))
    .filter(Boolean);
  if (subjectIds.length === 0) return null;

  const since = new Date(Date.now() - Math.max(1, Number(lookbackDays) || SIGNAL_LOOKBACK_DAYS) * 864e5);
  const SignalModel = models.VerticalEngagementSignal();
  const row = await SignalModel.findOne({
    where: {
      tenant_key: String(tenantId),
      vertical: 'fitness',
      signal_type: { [Op.in]: SIGNAL_TYPES },
      subject_id: { [Op.in]: subjectIds },
      computed_at: { [Op.gte]: since },
    },
    order: [['computed_at', 'DESC']],
  }).catch(() => null);
  if (!row) return null;

  const signal = row.toJSON ? row.toJSON() : row;
  const metadata = signal.metadata && typeof signal.metadata === 'object' ? signal.metadata : {};
  return {
    signalId: signal.id || null,
    signalType: signal.signal_type,
    score: typeof signal.score === 'number' ? signal.score : null,
    daysSinceLastVisit: typeof signal.days_since_last_visit === 'number' ? signal.days_since_last_visit : null,
    frequency30d: typeof signal.frequency_last_30d === 'number' ? signal.frequency_last_30d : null,
    computedAt: signal.computed_at ? new Date(signal.computed_at).toISOString() : null,
    computedBy: metadata.computed_by || null,
  };
}

module.exports = {
  latestFitnessSignalByPhone,
  SIGNAL_LOOKBACK_DAYS,
  SIGNAL_TYPES,
};
