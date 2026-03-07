'use strict';

const { AutonomousGapCampaign, AutonomousGapCandidate, OperationalSchedule } = require('../../db/models');
const { getJson } = require('./shared');
const { structuredReason } = require('./runtime');

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function bucketHour(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCHours();
}

function weekdayOf(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCDay();
}

function campaignDimension(campaign) {
  return {
    verticalTemplate: campaign?.metadata?.verticalTemplate || 'beauty',
    serviceType: campaign?.service_type || campaign?.serviceType || null,
    ownerId: campaign?.owner_id || campaign?.ownerId || null,
    teamId: campaign?.team_id || campaign?.teamId || null,
    weekday: weekdayOf(campaign?.gap_start_at || campaign?.gapStartAt),
    hourBucket: bucketHour(campaign?.gap_start_at || campaign?.gapStartAt),
  };
}

function metricKey(parts) {
  return [
    parts.verticalTemplate || 'beauty',
    parts.serviceType || 'all',
    parts.ownerId || 'all',
    parts.teamId || 'all',
    Number.isInteger(parts.weekday) ? parts.weekday : 'all',
    Number.isInteger(parts.hourBucket) ? parts.hourBucket : 'all',
  ].join('|');
}

function filterByDimension(item, verticalTemplate, serviceType) {
  if (verticalTemplate && (item?.metadata?.verticalTemplate || 'beauty') !== verticalTemplate) return false;
  if (serviceType && String(item?.service_type || item?.serviceType || '') !== String(serviceType)) return false;
  return true;
}

async function getAggregatedMetrics({ tenantId, verticalTemplate = null, serviceType = null }) {
  const [campaignRows, candidateRows, scheduleRows] = await Promise.all([
    AutonomousGapCampaign().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 1000 }),
    AutonomousGapCandidate().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 3000 }),
    OperationalSchedule().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 1000 }),
  ]);

  const campaigns = campaignRows
    .map(getJson)
    .filter((item) => filterByDimension(item, verticalTemplate, serviceType));
  const candidates = candidateRows.map(getJson);
  const schedules = scheduleRows.map(getJson);
  const byCampaignId = new Map(campaigns.map((item) => [String(item.id), item]));
  const groups = new Map();

  for (const campaign of campaigns) {
    const dim = campaignDimension(campaign);
    const key = metricKey(dim);
    if (!groups.has(key)) {
      groups.set(key, { ...dim, campaigns: [], candidates: [], noShows: 0 });
    }
    groups.get(key).campaigns.push(campaign);
  }

  for (const candidate of candidates) {
    const campaign = byCampaignId.get(String(candidate.campaign_id || candidate.campaignId));
    if (!campaign) continue;
    const key = metricKey(campaignDimension(campaign));
    if (!groups.has(key)) continue;
    groups.get(key).candidates.push(candidate);
  }

  for (const schedule of schedules) {
    const campaignId = schedule?.metadata?.autonomousScheduling?.campaignId || null;
    if (!campaignId) continue;
    const campaign = byCampaignId.get(String(campaignId));
    if (!campaign) continue;
    const key = metricKey(campaignDimension(campaign));
    if (!groups.has(key)) continue;
    if (String(schedule.status || '').toLowerCase() === 'no_show') {
      groups.get(key).noShows += 1;
    }
  }

  const items = Array.from(groups.values()).map((group) => {
    const totalCampaigns = group.campaigns.length;
    const totalCandidates = group.candidates.length;
    const campaignsOpen = group.campaigns.filter((item) => ['open', 'running'].includes(String(item.status || '').toLowerCase())).length;
    const campaignsFilled = group.campaigns.filter((item) => String(item.status || '').toLowerCase() === 'filled').length;
    const campaignsExpired = group.campaigns.filter((item) => String(item.status || '').toLowerCase() === 'expired').length;
    const accepts = group.candidates.filter((item) => String(item.invite_status || '').toLowerCase() === 'accepted').length;
    const fillDurations = group.campaigns
      .filter((item) => item.closed_at && (item.started_at || item.created_at))
      .map((item) => {
        const start = new Date(item.started_at || item.created_at).getTime();
        const end = new Date(item.closed_at).getTime();
        return end > start ? Math.round((end - start) / 60000) : null;
      })
      .filter((item) => item !== null);
    const fillRate = safeRate(campaignsFilled, totalCampaigns);
    const acceptRate = safeRate(accepts, totalCandidates);
    const expirationRate = safeRate(campaignsExpired, totalCampaigns);
    const noShowRate = safeRate(group.noShows, Math.max(campaignsFilled, 1));
    return {
      verticalTemplate: group.verticalTemplate,
      serviceType: group.serviceType,
      ownerId: group.ownerId,
      teamId: group.teamId,
      weekday: group.weekday,
      hourBucket: group.hourBucket,
      campaignsOpen,
      campaignsFilled,
      campaignsExpired,
      acceptedCandidates: accepts,
      fillRate,
      acceptRate,
      expirationRate,
      avgFillMinutes: fillDurations.length > 0 ? Math.round(fillDurations.reduce((acc, item) => acc + item, 0) / fillDurations.length) : 0,
      noShowRate,
      reasons: [
        structuredReason('high_idle_risk', 'Fill rate baixo para esta combinação operacional.', { active: fillRate < 55 }),
        structuredReason('high_no_show_risk', 'No-show ou expiração estão pressionando o preenchimento.', { active: noShowRate >= 20 || expirationRate >= 35 }),
      ],
    };
  });

  items.sort((a, b) => {
    if ((b.campaignsOpen || 0) !== (a.campaignsOpen || 0)) return (b.campaignsOpen || 0) - (a.campaignsOpen || 0);
    if ((a.fillRate || 0) !== (b.fillRate || 0)) return (a.fillRate || 0) - (b.fillRate || 0);
    return String(a.serviceType || '').localeCompare(String(b.serviceType || ''));
  });

  return { ok: true, items };
}

module.exports = {
  getAggregatedMetrics,
  campaignDimension,
  metricKey,
};
