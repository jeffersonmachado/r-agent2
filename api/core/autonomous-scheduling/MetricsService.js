'use strict';

const { AutonomousGapCampaign, AutonomousGapCandidate } = require('../../db/models');
const { getJson } = require('./shared');

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

async function getMetrics({ tenantId }) {
  const [campaignRows, candidateRows] = await Promise.all([
    AutonomousGapCampaign().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 500 }),
    AutonomousGapCandidate().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 1000 }),
  ]);

  const campaigns = campaignRows.map(getJson);
  const candidates = candidateRows.map(getJson);
  const open = campaigns.filter((item) => ['open', 'running'].includes(String(item.status || ''))).length;
  const filled = campaigns.filter((item) => String(item.status || '') === 'filled').length;
  const expired = campaigns.filter((item) => String(item.status || '') === 'expired').length;
  const completed = campaigns.filter((item) => String(item.status || '') === 'completed').length;
  const accepted = candidates.filter((item) => String(item.invite_status || '') === 'accepted').length;
  const rejected = candidates.filter((item) => String(item.invite_status || '') === 'rejected').length;
  const totalClosed = campaigns.filter((item) => ['filled', 'expired', 'completed', 'cancelled', 'canceled'].includes(String(item.status || ''))).length;

  const fillDurations = campaigns
    .filter((item) => String(item.status || '') === 'filled' && item.closed_at && (item.started_at || item.created_at))
    .map((item) => {
      const start = new Date(item.started_at || item.created_at).getTime();
      const end = new Date(item.closed_at).getTime();
      return end > start ? Math.round((end - start) / 60000) : null;
    })
    .filter((item) => item !== null);

  const avgFillMinutes = fillDurations.length > 0
    ? Math.round(fillDurations.reduce((acc, item) => acc + item, 0) / fillDurations.length)
    : 0;

  return {
    ok: true,
    metrics: {
      campaignsOpen: open,
      campaignsFilled: filled,
      campaignsExpired: expired,
      campaignsCompleted: completed,
      accepts: accepted,
      rejects: rejected,
      fillRate: safeRate(filled, totalClosed),
      acceptRate: safeRate(accepted, Math.max(candidates.filter((item) => ['sent', 'accepted', 'rejected', 'expired'].includes(String(item.invite_status || ''))).length, 1)),
      expirationRate: safeRate(expired, totalClosed),
      avgFillMinutes,
    },
  };
}

module.exports = {
  getMetrics,
};
