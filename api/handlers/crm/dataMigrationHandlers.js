'use strict';

/**
 * Data Migration Handlers
 * REST endpoints for bulk import/export and data migration workflows
 */

const dataMigrationService = require('../../services/crm/dataMigrationService');

/**
 * Import data from CSV/JSON
 */
async function importCrmData(req, res) {
  try {
    const { tenantKey, sequelize } = req;
    const { importType, format = 'json' } = req.query;
    const fileContent = req.body.fileContent || '';

    if (!importType) {
      return res.status(400).json({ ok: false, error: 'importType query parameter is required' });
    }

    if (!fileContent) {
      return res.status(400).json({ ok: false, error: 'fileContent body is required' });
    }

    const result = await dataMigrationService.importData(
      sequelize,
      tenantKey,
      importType,
      fileContent,
      format,
    );

    res.json({
      ok: true,
      import: result,
    });
  } catch (err) {
    console.error('importCrmData error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Export data to CSV/JSON
 */
async function exportCrmData(req, res) {
  try {
    const { tenantKey, sequelize } = req;
    const { exportType, format = 'json' } = req.query;

    if (!exportType) {
      return res.status(400).json({ ok: false, error: 'exportType query parameter is required' });
    }

    const result = await dataMigrationService.exportData(
      sequelize,
      tenantKey,
      exportType,
      format,
    );

    // Set appropriate content type
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${exportType}-${new Date().toISOString()}.csv"`);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${exportType}-${new Date().toISOString()}.json"`);
    }

    res.send(result);
  } catch (err) {
    console.error('exportCrmData error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Bulk update records
 */
async function bulkUpdateRecords(req, res) {
  try {
    const { tenantKey, sequelize } = req;
    const { updateType } = req.query;
    const { updates } = req.body;

    if (!updateType) {
      return res.status(400).json({ ok: false, error: 'updateType query parameter is required' });
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'updates array is required and must not be empty' });
    }

    const result = await dataMigrationService.bulkUpdate(
      sequelize,
      tenantKey,
      updateType,
      updates,
    );

    res.json({
      ok: true,
      bulkUpdate: result,
    });
  } catch (err) {
    console.error('bulkUpdateRecords error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Detect duplicates
 */
async function checkDuplicates(req, res) {
  try {
    const { tenantKey, sequelize } = req;
    const { entityType, threshold = 0.8 } = req.query;

    if (!entityType) {
      return res.status(400).json({ ok: false, error: 'entityType query parameter is required' });
    }

    const result = await dataMigrationService.detectDuplicates(
      sequelize,
      tenantKey,
      entityType,
      Number(threshold),
    );

    res.json({
      ok: true,
      duplicateAnalysis: result,
    });
  } catch (err) {
    console.error('checkDuplicates error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Get migration status/schema
 */
async function getMigrationStatus(req, res) {
  try {
    const { tenantKey, sequelize } = req;

    // Count records by entity type
    const counts = {
      accounts: await sequelize.models.CrmAccount.count({ where: { tenant_key: tenantKey } }),
      contacts: await sequelize.models.CrmContact.count({ where: { tenant_key: tenantKey } }),
      leads: await sequelize.models.CrmLead.count({ where: { tenant_key: tenantKey } }),
      pipelines: await sequelize.models.CrmPipeline.count({ where: { tenant_key: tenantKey } }),
      opportunities: await sequelize.models.CrmOpportunity.count({ where: { tenant_key: tenantKey } }),
      activities: await sequelize.models.CrmActivity.count({ where: { tenant_key: tenantKey } }),
    };

    const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);

    res.json({
      ok: true,
      migration: {
        status: 'ready',
        tenantKey,
        recordCounts: counts,
        totalRecords,
        supportedExportFormats: ['json', 'csv'],
        supportedImportFormats: ['json', 'csv'],
        supportedEntityTypes: ['accounts', 'contacts', 'leads', 'opportunities'],
      },
    });
  } catch (err) {
    console.error('getMigrationStatus error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = {
  importCrmData,
  exportCrmData,
  bulkUpdateRecords,
  checkDuplicates,
  getMigrationStatus,
};
