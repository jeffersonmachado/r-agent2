'use strict';

const { WorkspaceInsight } = require('../../db/models');
const logger = require('../../utils/logger');
const nlpService = require('../nlpService');
const WorkspaceTimelineService = require('./WorkspaceTimelineService');
const { safeString, toPlain } = require('./workspaceUtils');

const OPEN_TICKET_STATUSES = new Set(['waiting', 'open', 'assigned', 'in_progress', 'paused']);

class WorkspaceInsightService {
  constructor(deps = {}) {
    this.WorkspaceInsight = deps.WorkspaceInsight || WorkspaceInsight;
    this.timelineService = deps.timelineService || new WorkspaceTimelineService(deps);
    this.nlpService = deps.nlpService || nlpService;
    this.logger = deps.logger || logger;
  }

  buildInsight({ type, description, confidence = 0.7, source = 'system', evidence = [], severity = 'medium' }) {
    return { type, description, confidence, source, evidence, severity };
  }

  async persistedInsights({ tenantId, entityId, limit = 50 }) {
    const rows = await this.WorkspaceInsight().findAll({ where: { tenant_id: tenantId, entity_id: entityId }, order: [['created_at', 'DESC']], limit });
    return rows.map(toPlain);
  }

  async persistInsight({ tenantId, entityId, insight }) {
    const existing = await this.WorkspaceInsight().findOne({
      where: {
        tenant_id: tenantId,
        entity_id: entityId,
        type: insight.type,
        description: insight.description,
        source: insight.source || 'system',
      },
      order: [['created_at', 'DESC']],
    });
    if (existing) return toPlain(existing);
    return toPlain(await this.WorkspaceInsight().create({
      tenant_id: tenantId,
      entity_id: entityId,
      type: insight.type,
      description: insight.description,
      confidence: insight.confidence,
      source: insight.source || 'system',
    }));
  }

  async persistGeneratedInsights({ tenantId, entityId, insights = [] }) {
    const persisted = [];
    for (const insight of insights) {
      persisted.push(await this.persistInsight({ tenantId, entityId, insight }));
    }
    return persisted;
  }

  async generateAiClassifications({ tenantId, entityId, timeline }) {
    const eventsText = (timeline.items || []).slice(0, 20).map((event) => `${event.type}: ${event.summary}`).join('\n');
    if (!eventsText) return [];
    const aiSignals = [];
    try {
      if (this.nlpService && typeof this.nlpService.analyzeText === 'function') {
        const analysis = await this.nlpService.analyzeText(eventsText, true);
        if (analysis?.sentiment === 'negative') {
          aiSignals.push(this.buildInsight({ type: 'risk', description: 'Sentimento negativo detectado nas interacoes recentes.', confidence: 0.68, source: 'AI', severity: 'high' }));
        }
      }
    } catch (err) {
      this.logger.warn('[WorkspaceInsight] nlpService indisponivel', { tenantId, entityId, error: err.message });
    }
    return aiSignals;
  }

  async generateInsights(entityId, options = {}) {
    const tenantId = options.tenantId;
    const timeline = options.timeline || await this.timelineService.getEntityTimeline({ tenantId, entityId, limit: 100, offset: 0 });
    if (!timeline) return null;

    const events = timeline.items || [];
    const now = Date.now();
    const openTickets = events.filter((event) => event.type === 'ticket' && OPEN_TICKET_STATUSES.has(safeString(event.payload?.status).toLowerCase()));
    const failures = events.filter((event) => event.type === 'evidence' && /failure|failed|error|bug|regression|falha|erro/i.test(`${event.summary} ${event.payload?.type || ''} ${event.payload?.category || ''} ${event.payload?.strength || ''}`));
    const slaDelayed = events.filter((event) => event.type === 'ticket' && OPEN_TICKET_STATUSES.has(safeString(event.payload?.status).toLowerCase()) && !event.payload?.first_response_at && ((now - new Date(event.createdAt).getTime()) / 36e5) > 4);
    const messages = events.filter((event) => event.type === 'message');
    const lastAny = events[0];
    const recentMessages = messages.filter((event) => ((now - new Date(event.createdAt).getTime()) / 864e5) <= 14);
    const insights = [];

    if (openTickets.length >= 2) {
      insights.push(this.buildInsight({ type: 'risk', description: `Cliente tem ${openTickets.length} tickets abertos ou em atendimento simultaneo.`, confidence: 0.9, source: 'system', severity: 'high', evidence: openTickets.map(i => i.refId).filter(Boolean) }));
    }
    if (lastAny) {
      const ageDays = (now - new Date(lastAny.createdAt).getTime()) / 864e5;
      if (ageDays > 30) {
        insights.push(this.buildInsight({ type: 'churn', description: `Cliente sem interacao relevante ha ${Math.round(ageDays)} dias.`, confidence: 0.78, source: 'system', severity: 'high', evidence: [lastAny.refId].filter(Boolean) }));
      }
    }
    if (recentMessages.length >= 5 && openTickets.length === 0) {
      insights.push(this.buildInsight({ type: 'upsell', description: 'Cliente ativo e engajado; ha janela para oferta consultiva ou expansao.', confidence: 0.66, source: 'system', severity: 'medium', evidence: recentMessages.slice(0, 5).map(i => i.refId).filter(Boolean) }));
    }
    if (slaDelayed.length > 0) {
      insights.push(this.buildInsight({ type: 'delay', description: `${slaDelayed.length} ticket(s) sem primeira resposta acima da janela operacional.`, confidence: 0.86, source: 'system', severity: 'high', evidence: slaDelayed.map(i => i.refId).filter(Boolean) }));
    }
    if (failures.length > 0) {
      insights.push(this.buildInsight({ type: 'risk', description: `${failures.length} falha(s) QA/RPA relacionadas ao cliente exigem acao tecnica.`, confidence: 0.94, source: 'RPA', severity: 'critical', evidence: failures.map(i => i.refId).filter(Boolean) }));
    }

    const aiInsights = await this.generateAiClassifications({ tenantId, entityId, timeline });
    const generated = [...insights, ...aiInsights];
    const persistedGenerated = await this.persistGeneratedInsights({ tenantId, entityId, insights: generated });
    const persistedExisting = await this.persistedInsights({ tenantId, entityId, limit: 100 });
    const persisted = [...persistedExisting, ...persistedGenerated]
      .filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index);

    return { items: generated, persisted, total: generated.length + persisted.length };
  }
}

module.exports = WorkspaceInsightService;
