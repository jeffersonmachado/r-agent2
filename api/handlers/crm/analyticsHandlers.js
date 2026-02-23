'use strict';

const analyticsService = require('../../services/crm/analyticsService');

async function getDashboard(req, res) {
  try {
    const { tenantKey } = req.crmUser;

    const dashboard = await analyticsService.getDashboardMetrics(req.sequelize, tenantKey);

    res.json({
      ok: true,
      dashboard,
    });
  } catch (err) {
    console.error('[getDashboard]', err);
    res.status(500).json({ error: 'dashboard_failed', message: err.message });
  }
}

async function getPipelineReport(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const { pipelineId } = req.params;

    if (!pipelineId) {
      return res.status(400).json({ error: 'invalid_input', message: 'pipelineId is required' });
    }

    const metrics = await analyticsService.getPipelineMetrics(req.sequelize, tenantKey, pipelineId);

    res.json({
      ok: true,
      report: {
        type: 'pipeline',
        pipelineId,
        data: metrics,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[getPipelineReport]', err);
    res.status(500).json({ error: 'pipeline_report_failed', message: err.message });
  }
}

async function getAccountReport(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: 'invalid_input', message: 'accountId is required' });
    }

    const metrics = await analyticsService.getAccountMetrics(req.sequelize, tenantKey, accountId);

    if (!metrics) {
      return res.status(404).json({ error: 'not_found', message: 'Account not found' });
    }

    res.json({
      ok: true,
      report: {
        type: 'account',
        accountId,
        data: metrics,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[getAccountReport]', err);
    res.status(500).json({ error: 'account_report_failed', message: err.message });
  }
}

async function getLeadAnalysis(req, res) {
  try {
    const { tenantKey } = req.crmUser;
    const filters = {
      status: req.query.status,
      source: req.query.source,
    };

    const metrics = await analyticsService.getLeadMetrics(req.sequelize, tenantKey, filters);

    res.json({
      ok: true,
      report: {
        type: 'leads',
        filters,
        data: metrics,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[getLeadAnalysis]', err);
    res.status(500).json({ error: 'lead_analysis_failed', message: err.message });
  }
}

module.exports = {
  getDashboard,
  getPipelineReport,
  getAccountReport,
  getLeadAnalysis,
};
