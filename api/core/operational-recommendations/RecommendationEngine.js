'use strict';

const crypto = require('crypto');
const { writeOperationalEventBestEffort } = require('../crm/OperationalEventWriter');
const { buildRecommendationFromSignal } = require('./RecommendationPolicyService');
const { SignalRepository } = require('./SignalRepository');
const { RecommendationStore } = require('./RecommendationStore');
const { QuickActionResolver } = require('./QuickActionResolver');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function normalizeImpactLevel(value) {
  const normalized = String(value || 'medium').trim().toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(normalized)) return normalized;
  return 'medium';
}

function normalizePriority(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso() {
  return new Date().toISOString();
}

function createRecommendationId() {
  return `oprec-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function mapRecommendationStatusEvent(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'accepted') return 'operational_recommendation_accepted';
  if (normalized === 'ignored') return 'operational_recommendation_ignored';
  if (normalized === 'executed') return 'operational_recommendation_executed';
  return 'operational_recommendation_generated';
}

class RecommendationEngine {
  constructor({
    signalRepository,
    recommendationStore,
    quickActionResolver,
    signalService = null,
    recommendationBuilder,
  } = {}) {
    this.signalRepository = signalRepository || new SignalRepository();
    this.recommendationStore = recommendationStore || new RecommendationStore();
    this.quickActionResolver = quickActionResolver || new QuickActionResolver();
    this.signalService = signalService;
    this.recommendationBuilder = typeof recommendationBuilder === 'function'
      ? recommendationBuilder
      : buildRecommendationFromSignal;
  }

  async createRecommendation(payload = {}) {
    return {
      ok: true,
      recommendation: {
        id: `oprec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        type: safeString(payload?.type) || 'review_operational_signal',
        priority: normalizePriority(payload?.priority),
        confidence: normalizeConfidence(payload?.confidence),
        impactLevel: normalizeImpactLevel(payload?.impactLevel || payload?.impact_level),
        targetModule: safeString(payload?.targetModule || payload?.target_module) || 'support',
        description: safeString(payload?.description) || 'Recomendação operacional gerada pelo core.',
        suggestedActions: Array.isArray(payload?.suggestedActions || payload?.suggested_actions)
          ? (payload.suggestedActions || payload.suggested_actions)
          : [],
        context: safeObject(payload?.context),
        sourceSignalId: safeString(payload?.sourceSignalId || payload?.source_signal_id),
        sourceSignalType: safeString(payload?.sourceSignalType || payload?.source_signal_type),
        tenantId: safeString(payload?.tenantId || payload?.tenant_id),
        contactId: safeString(payload?.contactId || payload?.contact_id),
        createdAt: new Date().toISOString(),
      },
    };
  }

  async generateForTenant({ tenantId, includeSignalGeneration = true } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (includeSignalGeneration !== false && this.signalService?.generateTenantSignals) {
      await this.signalService.generateTenantSignals({ tenantId: tenantKey }).catch(() => null);
    }

    const signalsOut = await this.signalRepository.listTenantActiveSignals({
      tenantId: tenantKey,
      limit: 500,
    });
    if (!signalsOut?.ok) return signalsOut;

    return this.generateFromSignals({
      tenantId: tenantKey,
      signals: signalsOut.items || [],
    });
  }

  async generateForContact({ tenantId, contactId, includeSignalGeneration = true } = {}) {
    const tenantKey = safeString(tenantId);
    const contactKey = safeString(contactId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!contactKey) return { ok: false, error: 'contact_required' };

    if (includeSignalGeneration !== false && this.signalService?.generateContactSignals) {
      await this.signalService.generateContactSignals({ tenantId: tenantKey, contactId: contactKey }).catch(() => null);
    }

    const signalsOut = await this.signalRepository.listContactActiveSignals({
      tenantId: tenantKey,
      contactId: contactKey,
      limit: 500,
    });
    if (!signalsOut?.ok) return signalsOut;

    return this.generateFromSignals({
      tenantId: tenantKey,
      signals: signalsOut.items || [],
    });
  }

  async generateFromSignals({ tenantId, signals = [] } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const list = Array.isArray(signals) ? signals : [];
    const recommendations = list.map((signal) => {
      const payload = this.recommendationBuilder(signal);
      const suggestedActions = this.quickActionResolver.resolveSuggestedActions({
        signal,
        recommendationType: payload.type,
        suggestedActions: payload.suggestedActions,
      });

      return {
        id: createRecommendationId(),
        tenant_id: tenantKey,
        contact_id: safeString(signal?.contact_id || signal?.contactId || payload.contactId),
        type: safeString(payload.type) || 'review_operational_signal',
        status: 'open',
        priority: normalizePriority(payload.priority),
        confidence: normalizeConfidence(payload.confidence),
        impact_level: normalizeImpactLevel(payload.impactLevel || payload.impact_level),
        target_module: safeString(payload.targetModule || payload.target_module) || 'support',
        description: safeString(payload.description) || 'Recomendação operacional gerada pelo core.',
        suggested_actions: suggestedActions,
        context_json: safeObject(payload.context),
        source_signal_id: safeString(signal?.id || payload.sourceSignalId || payload.source_signal_id),
        source_signal_type: safeString(signal?.type || payload.sourceSignalType || payload.source_signal_type),
        created_at: nowIso(),
      };
    });

    const out = await this.recommendationStore.upsertRecommendations({
      tenantId: tenantKey,
      recommendations,
    });
    if (!out?.ok) return out;

    for (const item of out.generated || []) {
      writeOperationalEventBestEffort({
        tenantId: tenantKey,
        contactId: item.contact_id || null,
        type: 'operational_recommendation_generated',
        sourceModule: 'operational_recommendations',
        referenceType: 'operational_recommendation',
        referenceId: item.id,
        payload: {
          recommendationType: item.type,
          sourceSignalId: item.source_signal_id,
          sourceSignalType: item.source_signal_type,
          priority: item.priority,
          confidence: item.confidence,
          impactLevel: item.impact_level,
        },
        actorType: 'system',
        actorId: 'operational-recommendations',
        correlationId: item.id,
      }, 'RecommendationEngine.generateFromSignals');
    }

    return out;
  }

  async listTenantRecommendations({ tenantId, limit = 200 } = {}) {
    return this.recommendationStore.listRecommendations({
      tenantId,
      contactId: null,
      limit,
    });
  }

  async listContactRecommendations({ tenantId, contactId, limit = 200 } = {}) {
    return this.recommendationStore.listRecommendations({
      tenantId,
      contactId,
      limit,
    });
  }

  async updateRecommendationStatus({ tenantId, recommendationId, status, actorId = null } = {}) {
    const out = await this.recommendationStore.updateRecommendationStatus({
      tenantId,
      recommendationId,
      status,
    });
    if (!out?.ok) return out;

    const item = out.item;
    writeOperationalEventBestEffort({
      tenantId: safeString(tenantId),
      contactId: item?.contact_id || null,
      type: mapRecommendationStatusEvent(item?.status),
      sourceModule: 'operational_recommendations',
      referenceType: 'operational_recommendation',
      referenceId: item?.id || recommendationId,
      payload: {
        recommendationType: item?.type || null,
        status: item?.status || null,
        sourceSignalId: item?.source_signal_id || null,
      },
      actorType: actorId ? 'user' : 'system',
      actorId: actorId ? String(actorId) : 'operational-recommendations',
      correlationId: item?.id || recommendationId,
    }, 'RecommendationEngine.updateRecommendationStatus');

    try {
      const { operationalMemoryService } = require('../operational-memory');
      await operationalMemoryService.recordRecommendationFeedback({
        tenantId,
        contactId: item?.contact_id || null,
        recommendationId: item?.id || recommendationId,
        status: item?.status || status,
        actorId,
        metadata: {
          recommendationType: item?.type || null,
          sourceSignalId: item?.source_signal_id || null,
        },
      });
    } catch (_) {}

    return out;
  }
}

module.exports = {
  RecommendationEngine,
};
