'use strict';

const crypto = require('crypto');
const { TenantRecommendation } = require('../../db/models');
const googleAdsKeywordInsightService = require('./googleAdsKeywordInsightService');
const googleAdsKeywordActionService = require('./googleAdsKeywordActionService');
const { appendEventV1 } = require('../eventLedgerService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashRecommendationFingerprint(input) {
  return crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex');
}

function normalizePriority(confidence) {
  const score = Number(confidence || 0);
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

function normalizeActionType(action) {
  const normalized = safeToString(action).trim();
  if (normalized === 'remove_or_pause_keyword') return 'pause_keyword';
  return normalized;
}

function mapRecommendationToRow(recommendation, context = {}) {
  const actionType = normalizeActionType(recommendation?.action);
  const term = safeToString(recommendation?.term || recommendation?.keywordText || recommendation?.keywordId);
  const campaignId = safeToString(recommendation?.campaignId);
  const adGroupId = safeToString(recommendation?.adGroupId);
  const keywordId = safeToString(recommendation?.keywordId);
  const fingerprint = hashRecommendationFingerprint({
    actionType,
    term,
    campaignId,
    adGroupId,
    keywordId,
    startDate: context.startDate || null,
    endDate: context.endDate || null,
  });

  return {
    title: `${safeToString(recommendation?.action || 'acao').replace(/_/g, ' ')}: ${term || 'keyword'}`,
    description: safeToString(recommendation?.rationale || 'Recomendação gerada a partir da análise de performance do Google Ads.'),
    actionType,
    priority: normalizePriority(recommendation?.confidence),
    estimatedImpact: {
      confidence: Number(recommendation?.confidence || 0),
      source: safeToString(recommendation?.source || 'ai'),
    },
    metadata: {
      domain: 'marketing_google_ads',
      fingerprint,
      recommendation: safeObject(recommendation),
      analysisWindow: {
        startDate: context.startDate || null,
        endDate: context.endDate || null,
      },
    },
  };
}

async function recordRecommendationEvent({ tenantId, type, recommendation, payload = {} }) {
  return appendEventV1({
    tenantId,
    type,
    source: 'marketing.google_ads.recommendations',
    occurredAt: new Date(),
    subject: {
      type: 'tenant_recommendation',
      id: safeToString(recommendation?.id || payload?.recommendationId || 'unknown'),
    },
    actor: { type: 'system', id: 'marketing_google_ads' },
    payload: {
      recommendationId: recommendation?.id || payload?.recommendationId || null,
      actionType: recommendation?.action_type || payload?.actionType || null,
      data: payload,
    },
  }).catch(() => null);
}

async function listRecommendations({ tenantId, status = null, limit = 100 } = {}) {
  if (!safeToString(tenantId)) return { ok: false, error: 'tenant_required' };

  const RecommendationModel = TenantRecommendation();
  const where = {
    tenant_key: safeToString(tenantId),
  };
  if (status) where.status = safeToString(status);

  const rows = await RecommendationModel.findAll({
    where,
    order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
  });

  const items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
  return { ok: true, total: items.length, items };
}

async function syncRecommendationsFromAnalysis({ tenantId, startDate = null, endDate = null, options = {} } = {}) {
  if (!safeToString(tenantId)) return { ok: false, error: 'tenant_required' };

  const analysis = await googleAdsKeywordInsightService.analyzeKeywordPortfolio({ tenantId, startDate, endDate, options });
  if (!analysis.ok) return analysis;

  const RecommendationModel = TenantRecommendation();
  const existingRows = await RecommendationModel.findAll({
    where: {
      tenant_key: safeToString(tenantId),
      status: ['open', 'approved'],
    },
    order: [['updated_at', 'DESC']],
    limit: 500,
  });
  const existing = new Map(
    (existingRows || []).map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      return [safeToString(json?.metadata?.fingerprint), json];
    }).filter(([key]) => key)
  );

  const created = [];
  let skipped = 0;

  for (const item of analysis.recommendations || []) {
    const mapped = mapRecommendationToRow(item, { startDate, endDate });
    if (existing.has(mapped.metadata.fingerprint)) {
      skipped += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const row = await RecommendationModel.create({
      id: buildId('mktreco'),
      tenant_key: safeToString(tenantId),
      title: mapped.title,
      description: mapped.description,
      action_type: mapped.actionType,
      priority: mapped.priority,
      status: 'open',
      estimated_impact: mapped.estimatedImpact,
      metadata: mapped.metadata,
    });
    const json = row.toJSON ? row.toJSON() : row;
    created.push(json);
    existing.set(mapped.metadata.fingerprint, json);
    // eslint-disable-next-line no-await-in-loop
    await recordRecommendationEvent({
      tenantId,
      type: 'MarketingGoogleAdsRecommendationCreated',
      recommendation: json,
      payload: { fingerprint: mapped.metadata.fingerprint },
    });
  }

  return {
    ok: true,
    created: created.length,
    skipped,
    recommendations: created,
    analysis,
  };
}

async function updateRecommendationStatus({ tenantId, recommendationId, status, note = null } = {}) {
  if (!safeToString(tenantId)) return { ok: false, error: 'tenant_required' };
  if (!safeToString(recommendationId)) return { ok: false, error: 'recommendation_id_required' };
  const normalizedStatus = safeToString(status);
  if (!['approved', 'rejected', 'open'].includes(normalizedStatus)) {
    return { ok: false, error: 'invalid_status' };
  }

  const RecommendationModel = TenantRecommendation();
  const row = await RecommendationModel.findOne({
    where: { tenant_key: safeToString(tenantId), id: safeToString(recommendationId) },
  });
  if (!row) return { ok: false, error: 'recommendation_not_found' };

  const current = row.toJSON ? row.toJSON() : row;
  const metadata = safeObject(current.metadata);
  const decisionHistory = Array.isArray(metadata.decisionHistory) ? metadata.decisionHistory.slice() : [];
  decisionHistory.push({ status: normalizedStatus, note: safeToString(note) || null, decidedAt: new Date().toISOString() });

  await row.update({
    status: normalizedStatus,
    metadata: {
      ...metadata,
      decisionHistory,
      decisionNote: safeToString(note) || null,
    },
  });

  const updated = row.toJSON ? row.toJSON() : row;
  await recordRecommendationEvent({
    tenantId,
    type: 'MarketingGoogleAdsRecommendationStatusChanged',
    recommendation: updated,
    payload: { status: normalizedStatus, note: safeToString(note) || null },
  });
  return { ok: true, recommendation: updated };
}

async function applyRecommendation({ tenantId, recommendationId, dryRun = null } = {}) {
  if (!safeToString(tenantId)) return { ok: false, error: 'tenant_required' };
  if (!safeToString(recommendationId)) return { ok: false, error: 'recommendation_id_required' };

  const RecommendationModel = TenantRecommendation();
  const row = await RecommendationModel.findOne({
    where: { tenant_key: safeToString(tenantId), id: safeToString(recommendationId) },
  });
  if (!row) return { ok: false, error: 'recommendation_not_found' };

  const current = row.toJSON ? row.toJSON() : row;
  const recommendation = safeObject(current.metadata?.recommendation);
  const payload = {
    action: normalizeActionType(current.action_type),
    campaignId: safeToString(recommendation.campaignId),
    adGroupId: safeToString(recommendation.adGroupId),
    keywordId: safeToString(recommendation.keywordId),
    keywordText: safeToString(recommendation.term || recommendation.keywordText),
    matchType: safeToString(recommendation.matchType || 'PHRASE') || 'PHRASE',
  };
  if (dryRun != null) payload.dryRun = dryRun === true;

  const actionOut = await googleAdsKeywordActionService.applyKeywordAction({
    tenantId,
    action: payload.action,
    payload,
  });

  const metadata = safeObject(current.metadata);
  const applyHistory = Array.isArray(metadata.applyHistory) ? metadata.applyHistory.slice() : [];
  applyHistory.push({
    attemptedAt: new Date().toISOString(),
    ok: actionOut.ok === true,
    dryRun: actionOut?.dryRun === true,
    error: actionOut.ok ? null : safeToString(actionOut.error || 'apply_failed'),
  });

  await row.update({
    status: actionOut.ok ? 'applied' : 'failed',
    metadata: {
      ...metadata,
      applyHistory,
      lastApplyResult: safeObject(actionOut),
    },
  });

  const updated = row.toJSON ? row.toJSON() : row;
  await recordRecommendationEvent({
    tenantId,
    type: actionOut.ok ? 'MarketingGoogleAdsRecommendationApplied' : 'MarketingGoogleAdsRecommendationApplyFailed',
    recommendation: updated,
    payload: { actionOut },
  });

  return {
    ok: actionOut.ok === true,
    recommendation: updated,
    actionResult: actionOut,
    ...(actionOut.ok ? {} : { error: actionOut.error || 'apply_failed' }),
  };
}

module.exports = {
  listRecommendations,
  syncRecommendationsFromAnalysis,
  updateRecommendationStatus,
  applyRecommendation,
};