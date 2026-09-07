'use strict';

/**
 * Vertical Recommendation Service (shared: beauty + fitness)
 *
 * Provides operational recommendations using AI/ML scoring.
 * REQUIRES AI/ML provider. No heuristic fallback.
 * Always provides explanability ("reason" field).
 */

const { computeEngagementSignal } = require('./engagementEngine');
const { getSessionBalance } = require('./billingOrchestrationService');
const { getRecentAttendances } = require('./engagementEngine');

// ── Beauty ────────────────────────────────────────────────────────────────

/**
 * Beauty: compute no-show risk and suggest action.
 */
async function beautyNoShowRisk({ tenantId, subjectId, membershipId, billingStatus = 'active', noShowCount = 0, totalAppointments = 0 }) {
  const signal = await computeEngagementSignal({
    tenantId,
    vertical: 'beauty',
    subjectId,
    membershipId,
    billingStatus,
    noShowCount,
    totalAppointments,
  });

  const score = signal.score;
  let action = 'none';
  let reason = 'Low no-show history; no action needed.';

  if (score >= 0.7) {
    action = 'send_confirmation_reminder';
    reason = `High no-show risk (score=${score.toFixed(2)}). Historical no-show rate is elevated or subject has been very inactive.`;
  } else if (score >= 0.4) {
    action = 'send_soft_reminder';
    reason = `Moderate no-show risk (score=${score.toFixed(2)}). A soft reminder is recommended.`;
  }

  return {
    subjectId,
    vertical: 'beauty',
    signalType: signal.signal_type,
    score,
    action,
    reason,
    evidence: { noShowCount, totalAppointments, daysSinceLastVisit: signal.days_since_last_visit, computedBy: 'ai_ml_required' },
  };
}

/**
 * Beauty: suggest re-engagement action.
 */
async function beautyReengagementSuggestion({ tenantId, subjectId, membershipId, billingStatus = 'active' }) {
  const signal = await computeEngagementSignal({ tenantId, vertical: 'beauty', subjectId, membershipId, billingStatus });

  if (signal.signal_type === 'inactive' || signal.days_since_last_visit >= 60) {
    return {
      subjectId,
      vertical: 'beauty',
      suggestion: 'reactivation_campaign',
      reason: `Subject has not visited in ${signal.days_since_last_visit} days. Consider sending a reactivation offer.`,
      evidence: signal,
    };
  }
  if (signal.days_since_last_visit >= 30) {
    return {
      subjectId,
      vertical: 'beauty',
      suggestion: 'follow_up_outreach',
      reason: `Subject last visited ${signal.days_since_last_visit} days ago. A follow-up message is appropriate.`,
      evidence: signal,
    };
  }
  return {
    subjectId,
    vertical: 'beauty',
    suggestion: 'none',
    reason: 'Subject is recently active. No re-engagement needed.',
    evidence: signal,
  };
}

/**
 * Beauty: upsell suggestion (offer package/subscription).
 */
async function beautyUpsellSuggestion({ tenantId, subjectId, vertical = 'beauty' }) {
  const balance = await getSessionBalance({ tenantId, vertical, subjectId });
  const recents = await getRecentAttendances({ tenantId, vertical, subjectId, windowDays: 90 });
  const freq = recents.length;

  if (!balance.hasBundle && freq >= 3) {
    return {
      subjectId,
      suggestion: 'offer_subscription',
      reason: `Subject has ${freq} visits in the last 90 days but no active package. A subscription could improve retention and revenue.`,
      evidence: { frequency90d: freq, hasBundle: false },
    };
  }
  if (balance.hasBundle && balance.remaining !== null && balance.remaining <= 1) {
    return {
      subjectId,
      suggestion: 'renew_package',
      reason: `Session bundle nearing exhaustion (${balance.remaining} remaining). Time to renew.`,
      evidence: { remaining: balance.remaining, bundleId: balance.bundleId },
    };
  }
  if (balance.hasBundle && balance.bundleType === 'package' && freq >= 5) {
    return {
      subjectId,
      suggestion: 'upgrade_to_subscription',
      reason: `Subject is a frequent visitor with a package. An unlimited subscription may be more cost-effective and reduce churn risk.`,
      evidence: { frequency90d: freq },
    };
  }
  return { subjectId, suggestion: 'none', reason: 'No upsell opportunity detected.', evidence: {} };
}

/**
 * Beauty: suggest best schedule time based on visit history.
 */
async function beautyBestScheduleSuggestion({ tenantId, subjectId }) {
  const recents = await getRecentAttendances({ tenantId, vertical: 'beauty', subjectId, windowDays: 180 });
  if (recents.length < 3) {
    return {
      subjectId,
      suggestion: 'no_data',
      reason: 'Insufficient visit history to suggest optimal schedule. At least 3 visits required.',
      evidence: { visits: recents.length },
    };
  }

  // aggregrate by weekday + hour
  const hourCounts = {};
  recents.forEach((a) => {
    const d = new Date(a.checked_in_at || a.created_at);
    const slot = `${d.getDay()}_${d.getHours()}`;
    hourCounts[slot] = (hourCounts[slot] || 0) + 1;
  });
  const bestSlot = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [day, hour] = bestSlot[0].split('_');
  return {
    subjectId,
    suggestion: 'preferred_slot',
    preferredDay: DAYS[Number(day)],
    preferredHour: `${hour}:00`,
    reason: `Based on ${recents.length} historical visits, ${DAYS[Number(day)]} around ${hour}:00 is the preferred slot.`,
    evidence: { slotCounts: hourCounts, visits: recents.length },
  };
}

// ── Fitness ───────────────────────────────────────────────────────────────

/**
 * Fitness: compute churn/evasion risk and suggest retention action.
 */
async function fitnessChurnRisk({ tenantId, subjectId, membershipId, billingStatus = 'active' }) {
  const signal = await computeEngagementSignal({
    tenantId,
    vertical: 'fitness',
    subjectId,
    membershipId,
    billingStatus,
  });

  const score = signal.score;
  let action = 'none';
  let reason = 'Subject is engaged. No retention action needed.';

  if (score >= 0.7) {
    action = 'immediate_retention_outreach';
    reason = `High churn risk (score=${score.toFixed(2)}). Days since last visit: ${signal.days_since_last_visit}. Immediate outreach is recommended.`;
  } else if (score >= 0.4) {
    action = 'schedule_reengagement';
    reason = `Moderate churn risk (score=${score.toFixed(2)}). Consider scheduling a re-engagement follow-up.`;
  }

  return {
    subjectId,
    vertical: 'fitness',
    signalType: signal.signal_type,
    score,
    action,
    reason,
    evidence: { daysSinceLastVisit: signal.days_since_last_visit, frequency30d: signal.frequency_last_30d, billingStatus, computedBy: 'ai_ml_required' },
  };
}

/**
 * Fitness: low-frequency action suggestion.
 */
async function fitnessLowFrequencySuggestion({ tenantId, subjectId }) {
  const signal = await computeEngagementSignal({ tenantId, vertical: 'fitness', subjectId });
  const freq = signal.frequency_last_30d;

  if (freq === 0) {
    return {
      subjectId,
      suggestion: 'urgent_return_campaign',
      reason: `Zero visits in last 30 days. Subject is at high risk of cancellation.`,
      evidence: signal,
    };
  }
  if (freq < 2) {
    return {
      subjectId,
      suggestion: 'frequency_incentive',
      reason: `Only ${freq} visit(s) in last 30 days. Consider a check-in challenge or frequency incentive.`,
      evidence: signal,
    };
  }
  return { subjectId, suggestion: 'none', reason: `Frequency is adequate (${freq} visits/30d).`, evidence: signal };
}

/**
 * Fitness: suggest action for blocked/delinquent subject.
 */
function fitnessBlockFollowUpSuggestion({ membershipId, billingStatus, blockCount = 0 }) {
  if (!['blocked', 'delinquent'].includes(billingStatus)) {
    return { suggestion: 'none', reason: 'Subject is not blocked or delinquent.' };
  }
  if (blockCount >= 3) {
    return {
      membershipId,
      suggestion: 'manual_contact_priority',
      reason: `Subject has been blocked/delinquent ${blockCount} time(s). Manual high-priority outreach recommended.`,
      evidence: { blockCount, billingStatus },
    };
  }
  return {
    membershipId,
    suggestion: 'automated_payment_reminder',
    reason: `Subject is ${billingStatus}. Send an automated payment reminder.`,
    evidence: { blockCount, billingStatus },
  };
}

// ── Clinic ────────────────────────────────────────────────────────────────

/**
 * Clinic: compute consultation no-show (falta) risk and suggest action.
 */
async function clinicNoShowRisk({ tenantId, subjectId, membershipId, billingStatus = 'active', noShowCount = 0, totalAppointments = 0 }) {
  const signal = await computeEngagementSignal({
    tenantId,
    vertical: 'clinic',
    subjectId,
    membershipId,
    billingStatus,
    noShowCount,
    totalAppointments,
  });

  const score = signal.score;
  let action = 'none';
  let reason = 'Histórico de faltas baixo; nenhuma ação necessária.';

  if (score >= 0.7) {
    action = 'send_confirmation_reminder';
    reason = `Alto risco de falta (score=${score.toFixed(2)}). Recomenda-se confirmação ativa da consulta e lembrete reforçado.`;
  } else if (score >= 0.4) {
    action = 'send_soft_reminder';
    reason = `Risco moderado de falta (score=${score.toFixed(2)}). Um lembrete leve é recomendado.`;
  }

  return {
    subjectId,
    vertical: 'clinic',
    signalType: signal.signal_type,
    score,
    action,
    reason,
    evidence: { noShowCount, totalAppointments, daysSinceLastVisit: signal.days_since_last_visit, computedBy: 'ai_ml_required' },
  };
}

/**
 * Clinic: recall (retorno) suggestion based on factual attendance history.
 *
 * This is a deterministic business rule (days since last consultation vs.
 * recall window), not a risk score — so it does NOT depend on the ML
 * provider. Risk scoring (no-show) stays fail-closed via clinicNoShowRisk.
 */
async function clinicRecallSuggestion({ tenantId, subjectId }) {
  const recents = await getRecentAttendances({ tenantId, vertical: 'clinic', subjectId, windowDays: 150 });
  let lastAt = recents[0] ? new Date(recents[0].checked_in_at || recents[0].created_at) : null;

  if (!lastAt) {
    // Fora da janela: busca a última consulta real sem limite de janela
    const { getSequelize } = require('../../db/sequelize');
    if (getSequelize()) {
      const { VerticalAttendance } = require('../../db/models');
      const row = await VerticalAttendance().findOne({
        where: { tenant_key: tenantId, vertical: 'clinic', subject_id: String(subjectId) },
        order: [['checked_in_at', 'DESC']],
      }).catch(() => null);
      const data = row && row.toJSON ? row.toJSON() : row;
      if (data) lastAt = new Date(data.checked_in_at || data.created_at);
    }
  }

  if (!lastAt || !Number.isFinite(lastAt.getTime())) {
    return {
      subjectId,
      vertical: 'clinic',
      suggestion: 'none',
      reason: 'Sem histórico de consultas; recall se aplica apenas a pacientes com atendimento anterior.',
      evidence: { daysSinceLastVisit: null },
    };
  }

  const days = Math.floor((Date.now() - lastAt.getTime()) / 86400000);
  const evidence = { daysSinceLastVisit: days, lastConsultationAt: lastAt.toISOString(), computedBy: 'business_rule' };

  if (days >= 150) {
    return {
      subjectId,
      vertical: 'clinic',
      suggestion: 'send_recall',
      reason: `Paciente sem consulta há ${days} dias. Enviar recall para agendamento de retorno.`,
      evidence,
    };
  }
  if (days >= 90) {
    return {
      subjectId,
      vertical: 'clinic',
      suggestion: 'pre_recall_outreach',
      reason: `Última consulta há ${days} dias. Um contato preventivo aproxima o retorno antes do recall formal.`,
      evidence,
    };
  }
  return {
    subjectId,
    vertical: 'clinic',
    suggestion: 'none',
    reason: 'Paciente com acompanhamento em dia. Nenhum recall necessário.',
    evidence,
  };
}

module.exports = {
  beautyNoShowRisk,
  beautyReengagementSuggestion,
  beautyUpsellSuggestion,
  beautyBestScheduleSuggestion,
  fitnessChurnRisk,
  fitnessLowFrequencySuggestion,
  fitnessBlockFollowUpSuggestion,
  clinicNoShowRisk,
  clinicRecallSuggestion,
};
