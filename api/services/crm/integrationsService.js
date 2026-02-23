'use strict';

/**
 * External API Integrations
 * Adapters for popular CRM platforms (Salesforce, HubSpot, Pipedrive)
 */

// HubSpot Integration
const hubspotIntegration = {
  async syncAccounts(credentials, direction = 'bidirectional') {
    const apiKey = credentials.api_key;
    const baseUrl = 'https://api.hubapi.com';

    try {
      // Fetch from HubSpot
      const response = await fetch(`${baseUrl}/crm/v3/objects/companies`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const data = await response.json();
      return {
        provider: 'hubspot',
        entity: 'accounts',
        records: data.results.map((r) => ({
          externalId: r.id,
          name: r.properties.name,
          email: r.properties.hs_lead_status,
          industry: r.properties.industry,
        })),
      };
    } catch (err) {
      throw new Error(`HubSpot sync failed: ${err.message}`);
    }
  },

  async syncContacts(credentials, direction = 'bidirectional') {
    const apiKey = credentials.api_key;
    const baseUrl = 'https://api.hubapi.com';

    try {
      const response = await fetch(`${baseUrl}/crm/v3/objects/contacts`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const data = await response.json();
      return {
        provider: 'hubspot',
        entity: 'contacts',
        records: data.results.map((r) => ({
          externalId: r.id,
          name: `${r.properties.firstname || ''} ${r.properties.lastname || ''}`.trim(),
          email: r.properties.email,
          phone: r.properties.phone,
        })),
      };
    } catch (err) {
      throw new Error(`HubSpot sync failed: ${err.message}`);
    }
  },

  async syncOpportunities(credentials, direction = 'bidirectional') {
    const apiKey = credentials.api_key;
    const baseUrl = 'https://api.hubapi.com';

    try {
      const response = await fetch(`${baseUrl}/crm/v3/objects/deals`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const data = await response.json();
      return {
        provider: 'hubspot',
        entity: 'opportunities',
        records: data.results.map((r) => ({
          externalId: r.id,
          title: r.properties.dealname,
          value: parseInt(r.properties.amount) || 0,
          stage: r.properties.dealstage,
        })),
      };
    } catch (err) {
      throw new Error(`HubSpot sync failed: ${err.message}`);
    }
  },
};

// Salesforce Integration
const salesforceIntegration = {
  async authenticate(credentials) {
    const response = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        username: credentials.username,
        password: credentials.password,
      }),
    });

    return response.json();
  },

  async syncAccounts(credentials, direction = 'bidirectional') {
    const auth = await this.authenticate(credentials);
    const instanceUrl = auth.instance_url;
    const accessToken = auth.access_token;

    try {
      const response = await fetch(`${instanceUrl}/services/data/v57.0/query?q=SELECT+Id,Name,BillingCity+FROM+Account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = await response.json();
      return {
        provider: 'salesforce',
        entity: 'accounts',
        records: data.records.map((r) => ({
          externalId: r.Id,
          name: r.Name,
          city: r.BillingCity,
        })),
      };
    } catch (err) {
      throw new Error(`Salesforce sync failed: ${err.message}`);
    }
  },
};

// Pipedrive Integration
const pipedriveIntegration = {
  async syncDeals(credentials, direction = 'bidirectional') {
    const apiToken = credentials.api_token;
    const baseUrl = 'https://api.pipedrive.com/v1';

    try {
      const response = await fetch(`${baseUrl}/deals?api_token=${apiToken}&limit=200`, {
        headers: { Accept: 'application/json' },
      });

      const data = await response.json();
      return {
        provider: 'pipedrive',
        entity: 'opportunities',
        records: data.data.map((d) => ({
          externalId: d.id,
          title: d.title,
          value: d.value || 0,
          stage: d.status,
        })),
      };
    } catch (err) {
      throw new Error(`Pipedrive sync failed: ${err.message}`);
    }
  },
};

const integrations = {
  hubspot: hubspotIntegration,
  salesforce: salesforceIntegration,
  pipedrive: pipedriveIntegration,
};

async function syncIntegration(sequelize, tenantKey, integrationId, entity = 'all') {
  const CrmApiIntegration = sequelize.models.CrmApiIntegration;

  const integration = await CrmApiIntegration.findOne({
    where: { id: integrationId, tenant_key: tenantKey },
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  const providerAdapter = integrations[integration.provider];

  if (!providerAdapter) {
    throw new Error(`Provider "${integration.provider}" not supported`);
  }

  let syncResult;

  if (entity === 'all' || entity === 'accounts') {
    syncResult = await providerAdapter.syncAccounts(integration.credentials, integration.sync_direction);
  } else if (entity === 'opportunities') {
    syncResult = await providerAdapter.syncDeals
      ? providerAdapter.syncDeals(integration.credentials, integration.sync_direction)
      : providerAdapter.syncOpportunities(integration.credentials, integration.sync_direction);
  } else if (entity === 'contacts') {
    syncResult = await providerAdapter.syncContacts(integration.credentials, integration.sync_direction);
  }

  // Update last sync timestamp
  await integration.update({ last_sync_at: new Date() });

  return syncResult;
}

module.exports = {
  integrations,
  syncIntegration,
};
