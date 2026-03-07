'use strict';

const { listOpenCampaigns, runCampaign } = require('../AutonomousCampaignService');
const logger = require('../../../utils/logger');

async function runFillGapCampaignsJob({ tenantId }) {
  const list = await listOpenCampaigns({ tenantId, limit: 100 });
  const results = [];
  for (const campaign of list.items || []) {
    results.push(await runCampaign({ tenantId, campaignId: campaign.id }));
  }
  logger.info('[AutonomousScheduling] fillGapCampaignsJob finalizado', { tenantId, campaigns: results.length });
  return { ok: true, campaigns: results.length, results };
}

module.exports = { runFillGapCampaignsJob };
