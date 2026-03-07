'use strict';

const { detectOpenGaps } = require('../GapDetectionService');
const { createCampaign } = require('../AutonomousCampaignService');
const logger = require('../../../utils/logger');

async function runDetectGapsJob({ tenantId, ownerId = null, teamId = null, now = new Date(), gapPatch = null }) {
  const gaps = await detectOpenGaps({ tenantId, ownerId, teamId, now });
  let created = 0;
  const campaigns = [];
  const normalizedGapPatch = gapPatch && typeof gapPatch === 'object'
    ? Object.fromEntries(Object.entries(gapPatch).filter(([, value]) => value !== undefined))
    : null;
  for (const item of gaps.items || []) {
    const gap = normalizedGapPatch
      ? { ...item, ...normalizedGapPatch, metadata: { ...(item.metadata || {}), ...(normalizedGapPatch.metadata || {}) } }
      : item;
    const out = await createCampaign({ tenantId, gap });
    if (out.created) created += 1;
    campaigns.push(out.campaign);
  }
  logger.info('[AutonomousScheduling] detectGapsJob finalizado', { tenantId, detected: gaps.items?.length || 0, created });
  return { ok: true, detected: gaps.items?.length || 0, created, campaigns };
}

module.exports = { runDetectGapsJob };
