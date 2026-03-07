'use strict';

const { Op } = require('sequelize');
const { OperationalSchedule } = require('../../db/models');
const schedulingService = require('../../services/schedulingService');
const { getPolicy } = require('./AutonomousSchedulePolicyService');
const { getJson } = require('./shared');
const { resolvePolicy } = require('./runtime');
const logger = require('../../utils/logger');

function buildGap(current, next, diffMin, policy) {
  const serviceType = (current.metadata || {}).serviceType || (next.metadata || {}).serviceType || policy.settings?.serviceType || null;
  return {
    source: 'detected_gap',
    contextType: current.context_type || next.context_type || 'system',
    contextId: current.context_id || next.context_id || current.id,
    serviceType,
    ownerId: current.owner_id || next.owner_id || policy.settings?.preferredOwnerId || null,
    teamId: current.team_id || next.team_id || null,
    gapStartAt: new Date(current.end_at).toISOString(),
    gapEndAt: new Date(next.start_at).toISOString(),
    timezone: current.timezone || next.timezone || 'UTC',
    metadata: {
      previousScheduleId: current.id,
      nextScheduleId: next.id,
      detectedMinutes: diffMin,
      minGapDurationMinutes: policy.minGapDurationMinutes,
      minNoticeMinutes: policy.minNoticeMinutes,
    },
  };
}

function detectInternalGaps(rows, policy, now) {
  const out = [];
  const sorted = rows.slice().sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const start = new Date(current.end_at);
    const end = new Date(next.start_at);
    const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
    const noticeMin = Math.round((start.getTime() - now.getTime()) / 60000);
    if (diffMin >= policy.minGapDurationMinutes && noticeMin >= policy.minNoticeMinutes) {
      const gap = buildGap(current, next, diffMin, policy);
      logger.info('[AutonomousScheduling] gap detectado', {
        ownerId: gap.ownerId || null,
        teamId: gap.teamId || null,
        startAt: gap.gapStartAt,
        endAt: gap.gapEndAt,
        contextType: gap.contextType,
        contextId: gap.contextId,
      });
      out.push(gap);
    }
  }
  return out;
}

async function detectOpenGaps({ tenantId, now = new Date(), ownerId = null, teamId = null }) {
  const policy = resolvePolicy(await getPolicy(tenantId));
  if (!policy.enabled || !policy.autoFillEnabled) return { ok: true, items: [] };

  const horizonEnd = new Date(now.getTime() + (policy.fillHorizonHours * 3600 * 1000));
  const where = {
    tenant_key: String(tenantId),
    status: { [Op.in]: ['scheduled', 'in_progress'] },
    start_at: { [Op.gte]: now, [Op.lte]: horizonEnd },
  };
  if (ownerId) where.owner_id = String(ownerId);
  if (teamId) where.team_id = String(teamId);

  const rows = await OperationalSchedule().findAll({ where, order: [['owner_id', 'ASC'], ['team_id', 'ASC'], ['start_at', 'ASC']] });
  const byScope = new Map();
  for (const row of rows) {
    const json = getJson(row);
    const key = `${json.owner_id || ''}::${json.team_id || ''}`;
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key).push(json);
  }

  const items = [];
  for (const scopedRows of byScope.values()) {
    items.push(...detectInternalGaps(scopedRows, policy, now));
  }

  if (items.length === 0 && policy.fillHorizonHours > 0) {
    try {
      const availability = await schedulingService.getAvailability({
        tenantId,
        mode: ownerId || teamId ? 'team_based' : 'free',
        startAt: now.toISOString(),
        endAt: horizonEnd.toISOString(),
        ownerId: ownerId || policy.settings?.preferredOwnerId || null,
        teamId,
        timezone: 'UTC',
      });
      for (const slot of availability?.slots || []) {
        const start = new Date(slot.startAt);
        const end = new Date(slot.endAt);
        const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
        const noticeMin = Math.round((start.getTime() - now.getTime()) / 60000);
        if (diffMin >= policy.minGapDurationMinutes && noticeMin >= policy.minNoticeMinutes) {
          items.push({
            source: 'detected_gap',
            contextType: 'system',
            contextId: ownerId ? `owner:${ownerId}` : (teamId ? `team:${teamId}` : 'availability'),
            serviceType: policy.settings?.serviceType || null,
            ownerId: ownerId || slot.ownerId || policy.settings?.preferredOwnerId || null,
            teamId: teamId || null,
            gapStartAt: start.toISOString(),
            gapEndAt: end.toISOString(),
            timezone: slot.timezone || 'UTC',
            metadata: {
              availabilityDerived: true,
              detectedMinutes: diffMin,
              minGapDurationMinutes: policy.minGapDurationMinutes,
              minNoticeMinutes: policy.minNoticeMinutes,
            },
          });
        }
      }
    } catch (_) {
      // fallback silencioso: sem disponibilidade calculada não impede o fluxo
    }
  }

  logger.info('[AutonomousScheduling] detecção concluída', {
    tenantId,
    ownerId: ownerId || null,
    teamId: teamId || null,
    found: items.length,
  });

  return { ok: true, items };
}

module.exports = { detectOpenGaps };
