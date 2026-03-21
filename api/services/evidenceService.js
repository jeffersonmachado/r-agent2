'use strict';

const { Op } = require('sequelize');
const { Evidence, ChannelConversation, EventLedger } = require('../db/models');
const { createEvidenceIdentityService } = require('./evidenceIdentityService');
const { createEvidenceTimelineService } = require('./evidenceTimelineService');
const { createEvidenceExtractionService } = require('./evidenceExtractionService');
const {
  ensureTenantId,
  safeString,
  createId,
  createHash,
  normalizeText,
  overlapScore,
  uniqEntities,
  toArray,
} = require('./evidenceUtils');

function createEvidenceService(deps = {}) {
  const EvidenceModel = deps.Evidence || Evidence;
  const ChannelConversationModel = deps.ChannelConversation || ChannelConversation;
  const EventLedgerModel = deps.EventLedger || EventLedger;
  const identityService = deps.identityService || createEvidenceIdentityService(deps);
  const timelineService = deps.timelineService || createEvidenceTimelineService(deps);
  const extractionService = deps.extractionService || createEvidenceExtractionService(deps);

  async function resolveIdentity(args) {
    return identityService.resolveIdentity(args);
  }

  async function getTimeline(args) {
    const identityResult = args.identity
      ? { ok: true, identity: args.identity }
      : await resolveIdentity(args);
    if (!identityResult.ok) {
      return { ok: false, identity: null, items: [] };
    }
    return timelineService.getTimeline({ ...args, identity: identityResult.identity });
  }

  function buildEvidenceRecord({ tenantId, identity, sourceItem, evidence }) {
    const normalizedExcerpt = normalizeText(evidence.excerpt || evidence.summary || sourceItem.text || '');
    const idempotencyKey = createHash([
      tenantId,
      identity.entityType,
      identity.entityId,
      safeString(sourceItem.sourceType || sourceItem.source),
      safeString(sourceItem.id),
      normalizedExcerpt,
    ].join('|'));

    return {
      id: createId('evd'),
      tenant_key: tenantId,
      entity_type: identity.entityType,
      entity_id: identity.entityId,
      related_entities: uniqEntities([
        ...(identity.relatedEntities || []),
        ...(evidence.relatedEntities || []),
        safeString(sourceItem.ticketId) ? { type: 'ticket', id: sourceItem.ticketId } : null,
        safeString(sourceItem.conversationId) ? { type: 'conversation', id: sourceItem.conversationId } : null,
      ]),
      source_type: safeString(sourceItem.sourceType || sourceItem.source || 'system'),
      source_id: safeString(sourceItem.id),
      source_ref: {
        ticketId: sourceItem.ticketId || null,
        conversationId: sourceItem.conversationId || null,
        source: sourceItem.source || null,
        metadata: sourceItem.metadata || {},
      },
      category: evidence.category,
      type: evidence.type,
      theme: evidence.theme,
      summary: evidence.summary,
      excerpt: evidence.excerpt,
      normalized_text: evidence.normalizedText,
      occurred_at: sourceItem.timestamp || new Date(),
      indexed_at: new Date(),
      confidence: evidence.confidence,
      strength: evidence.strength,
      actor_type: evidence.actorType || sourceItem.actorType || null,
      actor_id: evidence.actorId || sourceItem.actorId || null,
      attachments: toArray(evidence.attachments),
      metadata: {
        ...evidence.metadata,
        title: sourceItem.title || null,
      },
      idempotency_key: idempotencyKey,
    };
  }

  async function extractEvidenceFromSource(args = {}) {
    const tenantId = ensureTenantId(args.tenantId);
    const identityResult = args.identity
      ? { ok: true, identity: args.identity }
      : await resolveIdentity(args);
    if (!identityResult.ok || !args.sourceItem) {
      return { ok: false, identity: identityResult.identity || null, evidence: [] };
    }
    const extracted = extractionService.extractEvidenceFromSource(args.sourceItem, args.options || {});
    return {
      ok: true,
      tenantId,
      identity: identityResult.identity,
      evidence: extracted.map((item) => buildEvidenceRecord({
        tenantId,
        identity: identityResult.identity,
        sourceItem: args.sourceItem,
        evidence: item,
      })),
    };
  }

  async function indexEvidence(args = {}) {
    const tenantId = ensureTenantId(args.tenantId);
    const records = toArray(args.records || args.evidence);
    if (records.length === 0) {
      return { ok: true, created: [], existing: [], total: 0 };
    }
    const created = [];
    const existing = [];
    for (const record of records) {
      try {
        const row = await EvidenceModel().create({
          ...record,
          tenant_key: tenantId,
        });
        created.push(row.toJSON ? row.toJSON() : row);
      } catch (err) {
        const isUnique = String(err?.name || '').toLowerCase().includes('unique')
          || String(err?.message || '').toLowerCase().includes('unique')
          || String(err?.original?.code || '') === '23505';
        if (!isUnique) throw err;
        const found = await EvidenceModel().findOne({
          where: {
            tenant_key: tenantId,
            idempotency_key: record.idempotency_key,
          },
        });
        if (found) existing.push(found.toJSON ? found.toJSON() : found);
      }
    }
    return {
      ok: true,
      created,
      existing,
      total: created.length + existing.length,
    };
  }

  function buildQueryTokens(args = {}) {
    return normalizeText([
      args.query,
      args.context?.lastUserMessage,
      args.context?.theme,
      toArray(args.filters?.theme).join(' '),
      toArray(args.filters?.type).join(' '),
      toArray(args.filters?.category).join(' '),
    ].filter(Boolean).join(' '));
  }

  function scoreEvidence({ row, identity, queryText, filters }) {
    let score = 0;
    const matchedBy = [];
    if (row.entity_type === identity.entityType && row.entity_id === identity.entityId) {
      score += 40;
      matchedBy.push('entity_exact');
    }
    const related = uniqEntities(row.related_entities || []);
    if (related.some((item) => item.type === identity.entityType && item.id === identity.entityId)) {
      score += 18;
      matchedBy.push('entity_related');
    }
    if (toArray(filters?.theme).includes(row.theme)) {
      score += 25;
      matchedBy.push('theme_exact');
    }
    if (toArray(filters?.type).includes(row.type)) {
      score += 18;
      matchedBy.push('type_exact');
    }
    if (toArray(filters?.category).includes(row.category)) {
      score += 14;
      matchedBy.push('category_exact');
    }
    const overlap = overlapScore(queryText, `${row.summary} ${row.excerpt} ${row.normalized_text}`);
    if (overlap > 0) {
      score += Math.round(overlap * 20);
      matchedBy.push('text_overlap');
    }
    const strengthWeight = {
      weak: 2,
      moderate: 6,
      strong: 10,
      formal: 14,
    };
    score += strengthWeight[row.strength] || 0;
    if (row.source_type === 'event_ledger' || row.source_type === 'document') {
      score += 10;
      matchedBy.push('formal_source');
    }
    if (row.actor_type === 'agent' || row.actor_type === 'system') {
      score += 6;
      matchedBy.push('trusted_actor');
    }
    if (toArray(row.attachments).length > 0) {
      score += 4;
      matchedBy.push('has_attachment');
    }
    const ageDays = Math.max(0, Math.floor((Date.now() - new Date(row.occurred_at).getTime()) / 86400000));
    score += Math.max(0, 8 - Math.min(ageDays / 90, 8));
    score += Math.round((Number(row.confidence) || 0) * 10);
    return {
      score: Math.round(score),
      matchedBy,
    };
  }

  async function searchEvidence(args = {}) {
    const tenantId = ensureTenantId(args.tenantId);
    const identityResult = args.identity
      ? { ok: true, identity: args.identity }
      : await resolveIdentity({ tenantId, ...(args.context || {}), ...args });
    if (!identityResult.ok) {
      return {
        ok: false,
        identity: null,
        best: null,
        alternatives: [],
        reasoning: { matchedBy: [], score: 0 },
      };
    }
    const identity = identityResult.identity;
    const related = uniqEntities(identity.relatedEntities || []);
    const entityFilters = [
      { entity_type: identity.entityType, entity_id: identity.entityId },
      ...related.map((item) => ({ entity_type: item.type, entity_id: item.id })),
    ];
    const where = {
      tenant_key: tenantId,
      [Op.or]: entityFilters,
    };
    if (toArray(args.filters?.category).length > 0) where.category = { [Op.in]: args.filters.category };
    if (toArray(args.filters?.type).length > 0) where.type = { [Op.in]: args.filters.type };
    if (toArray(args.filters?.theme).length > 0) where.theme = { [Op.in]: args.filters.theme };
    if (args.options?.includeWeak !== true) {
      where.strength = { [Op.in]: ['moderate', 'strong', 'formal'] };
    }

    const rows = await EvidenceModel().findAll({
      where,
      order: [['occurred_at', 'DESC']],
      limit: Math.max((Number(args.options?.limit) || 5) * 10, 20),
    });
    const queryText = buildQueryTokens(args);
    const scored = (rows || []).map((row) => {
      const item = row.toJSON ? row.toJSON() : row;
      const reasoning = scoreEvidence({
        row: item,
        identity,
        queryText,
        filters: args.filters || {},
      });
      return {
        ...item,
        reasoning,
      };
    }).sort((a, b) => b.reasoning.score - a.reasoning.score);

    const limit = Math.max(Number(args.options?.limit) || 5, 1);
    const best = scored[0] || null;
    const alternatives = best ? scored.slice(1, limit) : [];

    return {
      ok: true,
      identity,
      best,
      alternatives,
      reasoning: best ? best.reasoning : { matchedBy: [], score: 0 },
    };
  }

  async function findBestEvidenceForContext(args = {}) {
    return searchEvidence(args);
  }

  async function backfillEvidenceForEntity(args = {}) {
    const tenantId = ensureTenantId(args.tenantId);
    const identityResult = await resolveIdentity({ tenantId, ...(args.context || {}), ...args });
    if (!identityResult.ok) {
      return { ok: false, identity: null, dryRun: !!args.dryRun, created: 0, existing: 0, extracted: 0 };
    }
    const timeline = await getTimeline({ tenantId, identity: identityResult.identity, ...(args.context || {}), ...args });
    const extractedRecords = [];
    for (const item of timeline.items || []) {
      const extracted = extractionService.extractEvidenceFromSource(item, { includeWeak: args.includeWeak === true });
      for (const evidence of extracted) {
        extractedRecords.push(buildEvidenceRecord({
          tenantId,
          identity: identityResult.identity,
          sourceItem: item,
          evidence,
        }));
      }
    }
    if (args.dryRun) {
      return {
        ok: true,
        identity: identityResult.identity,
        dryRun: true,
        created: 0,
        existing: 0,
        extracted: extractedRecords.length,
        samples: extractedRecords.slice(0, 10),
      };
    }
    const indexed = await indexEvidence({ tenantId, records: extractedRecords });
    return {
      ok: true,
      identity: identityResult.identity,
      dryRun: false,
      created: indexed.created.length,
      existing: indexed.existing.length,
      extracted: extractedRecords.length,
    };
  }

  async function backfillEvidenceForTenant(args = {}) {
    const tenantId = ensureTenantId(args.tenantId);
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
    const entityInputs = [];
    const contextInputs = [];

    try {
      const conversations = await ChannelConversationModel().findAll({
        where: { tenant_key: tenantId },
        order: [['last_message_at', 'DESC']],
        limit,
      });
      for (const row of conversations || []) {
        const item = row.toJSON ? row.toJSON() : row;
        contextInputs.push({
          conversationId: item.id,
          phone: safeString(item.external_id),
        });
      }
    } catch (_) {}

    try {
      const events = await EventLedgerModel().findAll({
        where: { tenant_key: tenantId },
        order: [['occurred_at', 'DESC']],
        limit,
      });
      for (const row of events || []) {
        const item = row.toJSON ? row.toJSON() : row;
        if (item.subject_type && item.subject_id) {
          entityInputs.push({
            entityType: item.subject_type,
            entityId: item.subject_id,
          });
        }
      }
    } catch (_) {}

    const dedupedEntities = uniqEntities(
      entityInputs.map((item) => item.entityType && item.entityId
        ? { type: item.entityType, id: item.entityId }
        : null),
    );
    const dedupedContexts = uniqEntities(
      contextInputs.map((item) => item.conversationId ? { type: 'conversation', id: item.conversationId } : null),
    ).map((item) => contextInputs.find((ctx) => ctx.conversationId === item.id)).filter(Boolean);

    const results = [];
    for (const entity of dedupedEntities) {
      results.push(await backfillEvidenceForEntity({
        tenantId,
        entityType: entity.type,
        entityId: entity.id,
        dryRun: args.dryRun,
        includeWeak: args.includeWeak,
      }));
    }
    for (const context of dedupedContexts) {
      results.push(await backfillEvidenceForEntity({
        tenantId,
        conversationId: context.conversationId,
        phone: context.phone,
        context,
        dryRun: args.dryRun,
        includeWeak: args.includeWeak,
      }));
    }

    return {
      ok: true,
      dryRun: !!args.dryRun,
      processed: results.length,
      created: results.reduce((sum, item) => sum + (item.created || 0), 0),
      existing: results.reduce((sum, item) => sum + (item.existing || 0), 0),
      extracted: results.reduce((sum, item) => sum + (item.extracted || 0), 0),
      items: results,
    };
  }

  async function getEntityHistory(args = {}) {
    const tenantId = ensureTenantId(args.tenantId);
    const identityResult = args.identity
      ? { ok: true, identity: args.identity }
      : await resolveIdentity({ tenantId, ...(args.context || {}), ...args });
    if (!identityResult.ok) {
      return { ok: false, identity: null, timeline: [], evidence: [] };
    }
    const timeline = await getTimeline({ tenantId, identity: identityResult.identity, ...(args.context || {}), ...args });
    const evidence = await searchEvidence({
      tenantId,
      identity: identityResult.identity,
      context: args.context || args,
      filters: args.filters || {},
      query: args.query || '',
      options: { limit: Number(args.limit) || 5, includeWeak: args.includeWeak === true },
    });
    return {
      ok: true,
      identity: identityResult.identity,
      timeline: timeline.items || [],
      evidence,
    };
  }

  return {
    resolveIdentity,
    getTimeline,
    getEntityHistory,
    extractEvidenceFromSource,
    indexEvidence,
    searchEvidence,
    findBestEvidenceForContext,
    backfillEvidenceForEntity,
    backfillEvidenceForTenant,
  };
}

module.exports = createEvidenceService();
module.exports.createEvidenceService = createEvidenceService;
