'use strict';

/**
 * CRM Analytics & Reporting Service
 * Generates metrics, dashboards, and reports for operational CRM
 */

async function getPipelineMetrics(sequelize, tenantKey, pipelineId) {
  const CrmOpportunity = sequelize.models.CrmOpportunity;

  const opportunities = await CrmOpportunity.findAll({
    where: { tenant_key: tenantKey, pipeline_id: pipelineId },
    raw: true,
  });

  const stages = {};
  const totalValue = opportunities.reduce((sum, opp) => sum + (opp.value || 0), 0);
  const avgProbability = opportunities.length > 0
    ? opportunities.reduce((sum, opp) => sum + (opp.probability || 0), 0) / opportunities.length
    : 0;

  opportunities.forEach((opp) => {
    if (!stages[opp.stage_id]) {
      stages[opp.stage_id] = {
        count: 0,
        value: 0,
        avgProbability: 0,
        opportunities: [],
      };
    }
    stages[opp.stage_id].count += 1;
    stages[opp.stage_id].value += opp.value || 0;
    stages[opp.stage_id].opportunities.push(opp);
  });

  // Calculate average probability per stage
  Object.keys(stages).forEach((stageId) => {
    const stageOpps = stages[stageId].opportunities;
    stages[stageId].avgProbability = stageOpps.length > 0
      ? stageOpps.reduce((sum, opp) => sum + (opp.probability || 0), 0) / stageOpps.length
      : 0;
  });

  return {
    pipelineId,
    totalOpportunities: opportunities.length,
    totalValue,
    avgProbability,
    weightedValue: Object.keys(stages).reduce((sum, stageId) => {
      const stage = stages[stageId];
      return sum + stage.value * (stage.avgProbability / 100);
    }, 0),
    stages,
  };
}

async function getAccountMetrics(sequelize, tenantKey, accountId) {
  const CrmAccount = sequelize.models.CrmAccount;
  const CrmContact = sequelize.models.CrmContact;
  const CrmOpportunity = sequelize.models.CrmOpportunity;
  const CrmActivity = sequelize.models.CrmActivity;

  const account = await CrmAccount.findOne({
    where: { tenant_key: tenantKey, id: accountId },
  });

  if (!account) return null;

  const [contacts, opportunities, activities] = await Promise.all([
    CrmContact.count({ where: { tenant_key: tenantKey, account_id: accountId } }),
    CrmOpportunity.findAll({
      where: { tenant_key: tenantKey, account_id: accountId },
      raw: true,
    }),
    CrmActivity.count({ where: { tenant_key: tenantKey, subject_id: accountId } }),
  ]);

  const totalOpportunityValue = opportunities.reduce((sum, opp) => sum + (opp.value || 0), 0);
  const closedWonValue = opportunities
    .filter((opp) => opp.stage_id === 'closed_won')
    .reduce((sum, opp) => sum + (opp.value || 0), 0);

  return {
    accountId,
    accountName: account.name,
    contactsCount: contacts,
    opportunitiesCount: opportunities.length,
    totalOpportunityValue,
    closedWonValue,
    activitiesCount: activities,
    lastUpdated: account.updated_at,
  };
}

async function getLeadMetrics(sequelize, tenantKey, filters = {}) {
  const CrmLead = sequelize.models.CrmLead;

  const where = { tenant_key: tenantKey };
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;

  const leads = await CrmLead.findAll({ where, raw: true });

  const byStatus = {};
  const bySource = {};
  const scoreDistribution = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };

  leads.forEach((lead) => {
    // Group by status
    if (!byStatus[lead.status]) byStatus[lead.status] = 0;
    byStatus[lead.status] += 1;

    // Group by source
    if (!bySource[lead.source]) bySource[lead.source] = 0;
    bySource[lead.source] += 1;

    // Score distribution
    const score = lead.score || 0;
    if (score <= 20) scoreDistribution['0-20'] += 1;
    else if (score <= 40) scoreDistribution['21-40'] += 1;
    else if (score <= 60) scoreDistribution['41-60'] += 1;
    else if (score <= 80) scoreDistribution['61-80'] += 1;
    else scoreDistribution['81-100'] += 1;
  });

  return {
    totalLeads: leads.length,
    avgScore: leads.length > 0 ? (leads.reduce((s, l) => s + (l.score || 0), 0) / leads.length).toFixed(1) : 0,
    byStatus,
    bySource,
    scoreDistribution,
  };
}

async function getDashboardMetrics(sequelize, tenantKey) {
  const CrmAccount = sequelize.models.CrmAccount;
  const CrmContact = sequelize.models.CrmContact;
  const CrmLead = sequelize.models.CrmLead;
  const CrmOpportunity = sequelize.models.CrmOpportunity;
  const CrmActivity = sequelize.models.CrmActivity;

  const [accounts, contacts, leads, opportunities, activities] = await Promise.all([
    CrmAccount.count({ where: { tenant_key: tenantKey } }),
    CrmContact.count({ where: { tenant_key: tenantKey } }),
    CrmLead.count({ where: { tenant_key: tenantKey } }),
    CrmOpportunity.findAll({ where: { tenant_key: tenantKey }, raw: true }),
    CrmActivity.count({ where: { tenant_key: tenantKey } }),
  ]);

  const totalOpportunityValue = opportunities.reduce((sum, opp) => sum + (opp.value || 0), 0);
  const closedWonValue = opportunities
    .filter((opp) => opp.stage_id === 'closed_won')
    .reduce((sum, opp) => sum + (opp.value || 0), 0);
  const avgDealSize = opportunities.length > 0 ? (totalOpportunityValue / opportunities.length).toFixed(2) : 0;

  // Calculate win rate
  const closedOpportunities = opportunities.filter((opp) => opp.stage_id === 'closed_won' || opp.stage_id === 'closed_lost');
  const winRate = closedOpportunities.length > 0
    ? ((opportunities.filter((o) => o.stage_id === 'closed_won').length / closedOpportunities.length) * 100).toFixed(1)
    : 0;

  // Stage distribution
  const stageDistribution = {};
  opportunities.forEach((opp) => {
    if (!stageDistribution[opp.stage_id]) stageDistribution[opp.stage_id] = 0;
    stageDistribution[opp.stage_id] += 1;
  });

  // Recent activities (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentActivities = await CrmActivity.count({
    where: {
      tenant_key: tenantKey,
      created_at: { [sequelize.Sequelize.Op.gte]: sevenDaysAgo },
    },
  });

  return {
    summary: {
      totalAccounts: accounts,
      totalContacts: contacts,
      totalLeads: leads,
      totalOpportunities: opportunities.length,
      totalActivities: activities,
    },
    opportunity: {
      totalValue: totalOpportunityValue,
      closedWonValue,
      avgDealSize,
      winRate: `${winRate}%`,
      stageDistribution,
    },
    activity: {
      thisWeekCount: recentActivities,
      totalCount: activities,
    },
  };
}

async function generateReport(sequelize, tenantKey, reportType, filters = {}) {
  const generatedAt = new Date();

  let reportData;

  switch (reportType) {
    case 'pipeline_summary':
      reportData = await getPipelineMetrics(sequelize, tenantKey, filters.pipelineId);
      break;

    case 'account_summary':
      reportData = await getAccountMetrics(sequelize, tenantKey, filters.accountId);
      break;

    case 'lead_analysis':
      reportData = await getLeadMetrics(sequelize, tenantKey, filters);
      break;

    case 'dashboard':
      reportData = await getDashboardMetrics(sequelize, tenantKey);
      break;

    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }

  return {
    type: reportType,
    generatedAt,
    filters,
    data: reportData,
  };
}

module.exports = {
  getPipelineMetrics,
  getAccountMetrics,
  getLeadMetrics,
  getDashboardMetrics,
  generateReport,
};
