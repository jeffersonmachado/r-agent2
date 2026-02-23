'use strict';

/**
 * Webhook Handlers
 * REST endpoints for webhook and integration management
 */

const { v4: uuidv4 } = require('uuid');

async function registerWebhook(req, res) {
  try {
    const { name, url, events, headers = {}, retry_attempts = 3, retry_interval_seconds = 60 } = req.body;
    const { tenantKey, user } = req; // From crmAuthMiddleware

    const CrmWebhook = req.sequelize.models.CrmWebhook;

    if (!name || !url || !events || !Array.isArray(events)) {
      return res.status(400).json({
        ok: false,
        error: 'Missing or invalid fields: name, url, events (array)',
      });
    }

    const webhookService = require('./webhookService');
    const webhook = await webhookService.registerWebhook(req.sequelize, tenantKey, {
      name,
      url,
      events,
      headers,
      retry_attempts,
      retry_interval_seconds,
    });

    res.status(201).json({
      ok: true,
      webhook: {
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        createdAt: webhook.createdAt,
        // Secret NOT included in response for security
      },
    });
  } catch (err) {
    console.error('registerWebhook error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listWebhooks(req, res) {
  try {
    const { active } = req.query;
    const { tenantKey } = req;

    const CrmWebhook = req.sequelize.models.CrmWebhook;

    const where = { tenant_key: tenantKey };
    if (active !== undefined) {
      where.active = active === 'true';
    }

    const webhooks = await CrmWebhook.findAll({
      where,
      attributes: { exclude: ['secret'] }, // Never expose secret in list
      order: [['createdAt', 'DESC']],
    });

    res.json({
      ok: true,
      webhooks,
      count: webhooks.length,
    });
  } catch (err) {
    console.error('listWebhooks error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deleteWebhook(req, res) {
  try {
    const { webhookId } = req.params;
    const { tenantKey } = req;

    const CrmWebhook = req.sequelize.models.CrmWebhook;

    const webhook = await CrmWebhook.findOne({
      where: { id: webhookId, tenant_key: tenantKey },
    });

    if (!webhook) {
      return res.status(404).json({ ok: false, error: 'Webhook not found' });
    }

    // Soft delete by setting active = false
    await webhook.update({ active: false });

    res.json({
      ok: true,
      message: 'Webhook deactivated',
      webhook: {
        id: webhook.id,
        name: webhook.name,
        active: webhook.active,
      },
    });
  } catch (err) {
    console.error('deleteWebhook error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function testWebhook(req, res) {
  try {
    const { webhookId } = req.params;
    const { tenantKey } = req;

    const CrmWebhook = req.sequelize.models.CrmWebhook;

    const webhook = await CrmWebhook.findOne({
      where: { id: webhookId, tenant_key: tenantKey },
    });

    if (!webhook) {
      return res.status(404).json({ ok: false, error: 'Webhook not found' });
    }

    const webhookService = require('./webhookService');

    // Try to deliver a test payload
    const testPayload = {
      event: 'test.webhook',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery',
      },
    };

    const delivered = await webhookService.deliverWebhook(webhook, 'test.webhook', testPayload);

    res.json({
      ok: true,
      message: delivered ? 'Webhook delivery successful' : 'Webhook delivery failed',
      status: delivered ? 'delivered' : 'failed',
      testPayload,
    });
  } catch (err) {
    console.error('testWebhook error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getQueueStatus(req, res) {
  try {
    const { webhookId } = req.params;
    const { tenantKey } = req;
    const { status = 'all' } = req.query;

    const CrmWebhookQueue = req.sequelize.models.CrmWebhookQueue;

    const where = { webhook_id: webhookId };
    if (status !== 'all') {
      where.status = status; // pending, success, failed, retry
    }

    const queueItems = await CrmWebhookQueue.findAll({
      where,
      attributes: { exclude: ['payload'] }, // Don't include payload for list view
      include: [{ association: 'webhook', attributes: ['name'] }],
      limit: 100,
      order: [['createdAt', 'DESC']],
    });

    const stats = await CrmWebhookQueue.findAll({
      where: { webhook_id: webhookId },
      attributes: [
        'status',
        [req.sequelize.fn('COUNT', req.sequelize.col('id')), 'count'],
      ],
      group: ['status'],
      raw: true,
    });

    res.json({
      ok: true,
      webhookId,
      stats: stats.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
      recentItems: queueItems,
      count: queueItems.length,
    });
  } catch (err) {
    console.error('getQueueStatus error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function updateWebhook(req, res) {
  try {
    const { webhookId } = req.params;
    const { tenantKey } = req;
    const { name, url, events, headers, retry_attempts, retry_interval_seconds, active } = req.body;

    const CrmWebhook = req.sequelize.models.CrmWebhook;

    const webhook = await CrmWebhook.findOne({
      where: { id: webhookId, tenant_key: tenantKey },
    });

    if (!webhook) {
      return res.status(404).json({ ok: false, error: 'Webhook not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (url) updates.url = url;
    if (events) updates.events = events;
    if (headers) updates.headers = headers;
    if (retry_attempts) updates.retry_attempts = retry_attempts;
    if (retry_interval_seconds) updates.retry_interval_seconds = retry_interval_seconds;
    if (active !== undefined) updates.active = active;

    await webhook.update(updates);

    res.json({
      ok: true,
      webhook: {
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        updatedAt: webhook.updatedAt,
      },
    });
  } catch (err) {
    console.error('updateWebhook error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// Integration handlers

async function createIntegration(req, res) {
  try {
    const { provider, credentials, sync_direction = 'bidirectional' } = req.body;
    const { tenantKey } = req;

    const CrmApiIntegration = req.sequelize.models.CrmApiIntegration;

    if (!provider || !credentials) {
      return res.status(400).json({
        ok: false,
        error: 'Missing fields: provider, credentials',
      });
    }

    const validProviders = ['hubspot', 'salesforce', 'pipedrive', 'custom'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid provider. Valid: ${validProviders.join(', ')}`,
      });
    }

    const integration = await CrmApiIntegration.create({
      tenant_key: tenantKey,
      provider,
      credentials,
      sync_direction,
      last_sync_at: null,
    });

    res.status(201).json({
      ok: true,
      integration: {
        id: integration.id,
        provider: integration.provider,
        sync_direction: integration.sync_direction,
        createdAt: integration.createdAt,
        // credentials NOT included in response
      },
    });
  } catch (err) {
    console.error('createIntegration error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listIntegrations(req, res) {
  try {
    const { tenantKey } = req;

    const CrmApiIntegration = req.sequelize.models.CrmApiIntegration;

    const integrations = await CrmApiIntegration.findAll({
      where: { tenant_key: tenantKey },
      attributes: { exclude: ['credentials'] }, // Never expose credentials
      order: [['createdAt', 'DESC']],
    });

    res.json({
      ok: true,
      integrations,
      count: integrations.length,
    });
  } catch (err) {
    console.error('listIntegrations error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deleteIntegration(req, res) {
  try {
    const { integrationId } = req.params;
    const { tenantKey } = req;

    const CrmApiIntegration = req.sequelize.models.CrmApiIntegration;

    const integration = await CrmApiIntegration.findOne({
      where: { id: integrationId, tenant_key: tenantKey },
    });

    if (!integration) {
      return res.status(404).json({ ok: false, error: 'Integration not found' });
    }

    await integration.destroy();

    res.json({
      ok: true,
      message: 'Integration deleted',
    });
  } catch (err) {
    console.error('deleteIntegration error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function syncIntegrationData(req, res) {
  try {
    const { integrationId } = req.params;
    const { entity = 'all' } = req.query;
    const { tenantKey } = req;

    const integrationsService = require('./integrationsService');

    const result = await integrationsService.syncIntegration(req.sequelize, tenantKey, integrationId, entity);

    res.json({
      ok: true,
      sync: result,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('syncIntegrationData error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  testWebhook,
  getQueueStatus,
  updateWebhook,
  createIntegration,
  listIntegrations,
  deleteIntegration,
  syncIntegrationData,
};
