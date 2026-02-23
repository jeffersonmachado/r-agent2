'use strict';

/**
 * CRM API Express App
 * Standalone Express app for all CRM routes
 * Can be mounted or called as middleware from main server
 */

const express = require('express');
const app = require('express')();

const crmHandlers = require('./handlers/crm/crmHandlers');
const rbacHandlers = require('./handlers/crm/rbacHandlers');
const analyticsHandlers = require('./handlers/crm/analyticsHandlers');
const webhookHandlers = require('./handlers/crm/webhookHandlers');
const { crmAuthMiddleware, requireCrmPermission, requireResourcePermission, logCrmAudit } = require('./middleware/crmAuth');

// Attach database connection to all requests
app.use((req, res, next) => {
  try {
    const { getSequelize } = require('./db/sequelize');
    const sequelize = getSequelize();
    
    if (sequelize) {
      req.sequelize = sequelize;
    } else {
      console.warn('[CRM API] Sequelize not initialized yet');
    }
  } catch (err) {
    console.warn('[CRM API] Could not attach sequelize:', err.message);
  }
  next();
});

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'crm-api', timestamp: new Date().toISOString() });
});

// Apply auth middleware to all CRM routes
// TEMPORARIAMENTE DESABILITADO: causando timeout por falta de associações Sequelize
// app.use(crmAuthMiddleware);

/**
 * ============ CRM CORE ENDPOINTS ============
 */

// Accounts
app.post('/accounts', requireCrmPermission('crm:accounts:write'), async (req, res, next) => {
  await crmHandlers.createAccount(req, res);
  logCrmAudit('account_created', 'account')(req, res, next);
});
app.get('/accounts', requireCrmPermission('crm:accounts:read'), crmHandlers.listAccounts);
app.get('/accounts/:accountId', requireCrmPermission('crm:accounts:read'), crmHandlers.getAccount);
app.put('/accounts/:accountId', requireCrmPermission('crm:accounts:write'), async (req, res, next) => {
  await crmHandlers.updateAccount(req, res);
  logCrmAudit('account_updated', 'account')(req, res, next);
});
app.delete('/accounts/:accountId', requireCrmPermission('crm:accounts:delete'), async (req, res, next) => {
  await crmHandlers.deleteAccount(req, res);
  logCrmAudit('account_deleted', 'account')(req, res, next);
});

// Contacts
app.post('/contacts', requireCrmPermission('crm:contacts:write'), async (req, res, next) => {
  await crmHandlers.createContact(req, res);
  logCrmAudit('contact_created', 'contact')(req, res, next);
});
app.get('/contacts', requireCrmPermission('crm:contacts:read'), crmHandlers.listContacts);
app.get('/contacts/:contactId', requireCrmPermission('crm:contacts:read'), crmHandlers.getContact);
app.put('/contacts/:contactId', requireCrmPermission('crm:contacts:write'), async (req, res, next) => {
  await crmHandlers.updateContact(req, res);
  logCrmAudit('contact_updated', 'contact')(req, res, next);
});
app.delete('/contacts/:contactId', requireCrmPermission('crm:contacts:delete'), async (req, res, next) => {
  await crmHandlers.deleteContact(req, res);
  logCrmAudit('contact_deleted', 'contact')(req, res, next);
});

// Leads
app.post('/leads', requireCrmPermission('crm:leads:write'), async (req, res, next) => {
  await crmHandlers.createLead(req, res);
  logCrmAudit('lead_created', 'lead')(req, res, next);
});
app.get('/leads', requireCrmPermission('crm:leads:read'), crmHandlers.listLeads);
app.get('/leads/:leadId', requireCrmPermission('crm:leads:read'), crmHandlers.getLead);
app.put('/leads/:leadId', requireCrmPermission('crm:leads:write'), async (req, res, next) => {
  await crmHandlers.updateLead(req, res);
  logCrmAudit('lead_updated', 'lead')(req, res, next);
});
app.delete('/leads/:leadId', requireCrmPermission('crm:leads:delete'), async (req, res, next) => {
  await crmHandlers.deleteLead(req, res);
  logCrmAudit('lead_deleted', 'lead')(req, res, next);
});

// Pipelines
app.post('/pipelines', requireCrmPermission('crm:pipelines:write'), async (req, res, next) => {
  await crmHandlers.createPipeline(req, res);
  logCrmAudit('pipeline_created', 'pipeline')(req, res, next);
});
app.get('/pipelines', requireCrmPermission('crm:pipelines:read'), crmHandlers.listPipelines);
app.get('/pipelines/:pipelineId', requireCrmPermission('crm:pipelines:read'), crmHandlers.getPipeline);
app.put('/pipelines/:pipelineId', requireCrmPermission('crm:pipelines:write'), async (req, res, next) => {
  await crmHandlers.updatePipeline(req, res);
  logCrmAudit('pipeline_updated', 'pipeline')(req, res, next);
});
app.delete('/pipelines/:pipelineId', requireCrmPermission('crm:pipelines:delete'), async (req, res, next) => {
  await crmHandlers.deletePipeline(req, res);
  logCrmAudit('pipeline_deleted', 'pipeline')(req, res, next);
});

// Opportunities
app.post('/opportunities', requireCrmPermission('crm:opportunities:write'), async (req, res, next) => {
  await crmHandlers.createOpportunity(req, res);
  logCrmAudit('opportunity_created', 'opportunity')(req, res, next);
});
app.get('/opportunities', requireCrmPermission('crm:opportunities:read'), crmHandlers.listOpportunities);
app.get('/opportunities/:opportunityId', requireCrmPermission('crm:opportunities:read'), crmHandlers.getOpportunity);
app.put('/opportunities/:opportunityId', requireCrmPermission('crm:opportunities:write'), async (req, res, next) => {
  await crmHandlers.updateOpportunity(req, res);
  logCrmAudit('opportunity_updated', 'opportunity')(req, res, next);
});
app.post('/opportunities/:opportunityId/move-stage', requireCrmPermission('crm:opportunities:write'), async (req, res, next) => {
  await crmHandlers.moveOpportunityStage(req, res);
  logCrmAudit('opportunity_stage_changed', 'opportunity')(req, res, next);
});
app.delete('/opportunities/:opportunityId', requireCrmPermission('crm:opportunities:delete'), async (req, res, next) => {
  await crmHandlers.deleteOpportunity(req, res);
  logCrmAudit('opportunity_deleted', 'opportunity')(req, res, next);
});

// Activities
app.post('/activities', requireCrmPermission('crm:activities:write'), async (req, res, next) => {
  await crmHandlers.createActivity(req, res);
  logCrmAudit('activity_created', 'activity')(req, res, next);
});
app.get('/activities', requireCrmPermission('crm:activities:read'), crmHandlers.listActivities);
app.get('/timeline/:entityType/:entityId', requireCrmPermission('crm:activities:read'), crmHandlers.getTimeline);

/**
 * ============ RBAC ENDPOINTS ============
 */

app.post('/roles', requireCrmPermission('crm:roles:write'), async (req, res, next) => {
  await rbacHandlers.createRole(req, res);
  logCrmAudit('role_created', 'role')(req, res, next);
});
app.get('/roles', requireCrmPermission('crm:roles:read'), rbacHandlers.listRoles);
app.get('/roles/:roleId', requireCrmPermission('crm:roles:read'), rbacHandlers.getRole);
app.put('/roles/:roleId', requireCrmPermission('crm:roles:write'), async (req, res, next) => {
  await rbacHandlers.updateRole(req, res);
  logCrmAudit('role_updated', 'role')(req, res, next);
});

app.post('/users/:userId/roles', requireCrmPermission('crm:roles:write'), async (req, res, next) => {
  await rbacHandlers.assignUserToRole(req, res);
  logCrmAudit('user_role_assigned', 'user_role')(req, res, next);
});
app.get('/users/:userId/roles', requireCrmPermission('crm:roles:read'), rbacHandlers.listUserRoles);

app.post('/resources/:resourceType/:resourceId/permissions', requireCrmPermission('crm:roles:write'), async (req, res, next) => {
  await rbacHandlers.grantResourcePermission(req, res);
  logCrmAudit('resource_permission_granted', 'resource_permission')(req, res, next);
});

app.get('/audit-logs', requireCrmPermission('crm:audit:read'), rbacHandlers.getAuditLog);

/**
 * ============ ANALYTICS ENDPOINTS ============
 */

app.get('/analytics/dashboard', requireCrmPermission('crm:analytics:read'), analyticsHandlers.getDashboard);
app.get('/analytics/pipeline/:pipelineId', requireCrmPermission('crm:analytics:read'), analyticsHandlers.getPipelineReport);
app.get('/analytics/account/:accountId', requireCrmPermission('crm:analytics:read'), analyticsHandlers.getAccountReport);
app.get('/analytics/leads', requireCrmPermission('crm:analytics:read'), analyticsHandlers.getLeadAnalysis);

/**
 * ============ WEBHOOK ENDPOINTS ============
 */

app.post('/webhooks', requireCrmPermission('crm:webhooks:write'), async (req, res, next) => {
  await webhookHandlers.registerWebhook(req, res);
  logCrmAudit('webhook_created', 'webhook')(req, res, next);
});
app.get('/webhooks', requireCrmPermission('crm:webhooks:read'), webhookHandlers.listWebhooks);
app.put('/webhooks/:webhookId', requireCrmPermission('crm:webhooks:write'), async (req, res, next) => {
  await webhookHandlers.updateWebhook(req, res);
  logCrmAudit('webhook_updated', 'webhook')(req, res, next);
});
app.delete('/webhooks/:webhookId', requireCrmPermission('crm:webhooks:delete'), async (req, res, next) => {
  await webhookHandlers.deleteWebhook(req, res);
  logCrmAudit('webhook_deleted', 'webhook')(req, res, next);
});
app.post('/webhooks/:webhookId/test', requireCrmPermission('crm:webhooks:write'), webhookHandlers.testWebhook);
app.get('/webhooks/:webhookId/queue', requireCrmPermission('crm:webhooks:read'), webhookHandlers.getQueueStatus);

/**
 * ============ INTEGRATION ENDPOINTS ============
 */

app.post('/integrations', requireCrmPermission('crm:integrations:write'), async (req, res, next) => {
  await webhookHandlers.createIntegration(req, res);
  logCrmAudit('integration_created', 'integration')(req, res, next);
});
app.get('/integrations', requireCrmPermission('crm:integrations:read'), webhookHandlers.listIntegrations);
app.delete('/integrations/:integrationId', requireCrmPermission('crm:integrations:delete'), async (req, res, next) => {
  await webhookHandlers.deleteIntegration(req, res);
  logCrmAudit('integration_deleted', 'integration')(req, res, next);
});
app.post('/integrations/:integrationId/sync', requireCrmPermission('crm:integrations:write'), async (req, res, next) => {
  await webhookHandlers.syncIntegrationData(req, res);
  logCrmAudit('integration_synced', 'integration')(req, res, next);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('CRM API Error:', err);
  res.status(500).json({
    ok: false,
    error: err.message || 'Internal server error',
  });
});

module.exports = app;
