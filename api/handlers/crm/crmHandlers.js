'use strict';

/**
 * CRM CRUD Handlers
 * REST endpoint handlers for core CRM operations (Accounts, Contacts, Leads, Pipelines, Opportunities, Activities)
 */

const crmService = require('../../services/crm/crmService');
const { createCrmServiceWithWebhooks } = require('../../services/crm/crmWebhookInterceptor');

/**
 * Accounts Handlers
 */

async function createAccount(req, res) {
  try {
    const { name, ownerUserId, status = 'active', attributes = {} } = req.body;
    const { tenantKey, user, sequelize } = req;

    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    // Use interceptor to enable webhook triggers
    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertAccount({
      tenantId: tenantKey,
      name,
      ownerUserId,
      status,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({
      ok: true,
      account: result.account,
    });
  } catch (err) {
    console.error('createAccount error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listAccounts(req, res) {
  try {
    const { limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const result = await crmService.listAccounts({
      tenantId: tenantKey,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      ok: true,
      accounts: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('listAccounts error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getAccount(req, res) {
  try {
    const { accountId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.listAccounts({
      tenantId: tenantKey,
      where: { id: accountId },
      limit: 1,
    });

    if (!result.items || result.items.length === 0) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }

    res.json({
      ok: true,
      account: result.items[0],
    });
  } catch (err) {
    console.error('getAccount error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function updateAccount(req, res) {
  try {
    const { accountId } = req.params;
    const { name, ownerUserId, status, attributes } = req.body;
    const { tenantKey, user, sequelize } = req;

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertAccount({
      tenantId: tenantKey,
      id: accountId,
      name,
      ownerUserId,
      status,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      account: result.account,
    });
  } catch (err) {
    console.error('updateAccount error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deleteAccount(req, res) {
  try {
    const { accountId } = req.params;
    const { tenantKey } = req;

    // Soft delete by updating status
    const result = await crmService.upsertAccount({
      tenantId: tenantKey,
      id: accountId,
      name: 'DELETED',
      status: 'deleted',
    });

    res.json({
      ok: true,
      message: 'Account deleted',
    });
  } catch (err) {
    console.error('deleteAccount error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Contacts Handlers
 */

async function createContact(req, res) {
  try {
    const { accountId, name, email, phone, role, ownerUserId, status = 'active', attributes = {} } = req.body;
    const { tenantKey, user, sequelize } = req;

    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertContact({
      tenantId: tenantKey,
      accountId,
      name,
      email,
      phone,
      role,
      ownerUserId,
      status,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({
      ok: true,
      contact: result.contact,
    });
  } catch (err) {
    console.error('createContact error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listContacts(req, res) {
  try {
    const { accountId, limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const where = accountId ? { account_id: accountId } : {};

    const result = await crmService.listContacts({
      tenantId: tenantKey,
      where,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      ok: true,
      contacts: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('listContacts error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getContact(req, res) {
  try {
    const { contactId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.listContacts({
      tenantId: tenantKey,
      where: { id: contactId },
      limit: 1,
    });

    if (!result.items || result.items.length === 0) {
      return res.status(404).json({ ok: false, error: 'Contact not found' });
    }

    res.json({
      ok: true,
      contact: result.items[0],
    });
  } catch (err) {
    console.error('getContact error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function updateContact(req, res) {
  try {
    const { contactId } = req.params;
    const { accountId, name, email, phone, role, ownerUserId, status, attributes } = req.body;
    const { tenantKey, user, sequelize } = req;

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertContact({
      tenantId: tenantKey,
      id: contactId,
      accountId,
      name,
      email,
      phone,
      role,
      ownerUserId,
      status,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      contact: result.contact,
    });
  } catch (err) {
    console.error('updateContact error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deleteContact(req, res) {
  try {
    const { contactId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.upsertContact({
      tenantId: tenantKey,
      id: contactId,
      name: 'DELETED',
      status: 'deleted',
    });

    res.json({
      ok: true,
      message: 'Contact deleted',
    });
  } catch (err) {
    console.error('deleteContact error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Leads Handlers
 */

async function createLead(req, res) {
  try {
    const { accountId, contactId, source, ownerUserId, status = 'new', score = 0, attributes = {} } = req.body;
    const { tenantKey, user, sequelize } = req;

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertLead({
      tenantId: tenantKey,
      accountId,
      contactId,
      source,
      ownerUserId,
      status,
      score,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({
      ok: true,
      lead: result.lead,
    });
  } catch (err) {
    console.error('createLead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listLeads(req, res) {
  try {
    const { status, source, limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const where = {};
    if (status) where.status = status;
    if (source) where.source = source;

    const result = await crmService.listLeads({
      tenantId: tenantKey,
      where,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      ok: true,
      leads: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('listLeads error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getLead(req, res) {
  try {
    const { leadId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.listLeads({
      tenantId: tenantKey,
      where: { id: leadId },
      limit: 1,
    });

    if (!result.items || result.items.length === 0) {
      return res.status(404).json({ ok: false, error: 'Lead not found' });
    }

    res.json({
      ok: true,
      lead: result.items[0],
    });
  } catch (err) {
    console.error('getLead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function updateLead(req, res) {
  try {
    const { leadId } = req.params;
    const { accountId, contactId, source, ownerUserId, status, score, attributes } = req.body;
    const { tenantKey, user, sequelize } = req;

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertLead({
      tenantId: tenantKey,
      id: leadId,
      accountId,
      contactId,
      source,
      ownerUserId,
      status,
      score,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      lead: result.lead,
    });
  } catch (err) {
    console.error('updateLead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deleteLead(req, res) {
  try {
    const { leadId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.upsertLead({
      tenantId: tenantKey,
      id: leadId,
      status: 'deleted',
    });

    res.json({
      ok: true,
      message: 'Lead deleted',
    });
  } catch (err) {
    console.error('deleteLead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Pipelines Handlers
 */

async function createPipeline(req, res) {
  try {
    const { name, status = 'active', isDefault = false, stages = [], attributes = {} } = req.body;
    const { tenantKey, user, sequelize } = req;

    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertPipeline({
      tenantId: tenantKey,
      name,
      status,
      isDefault,
      stages,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({
      ok: true,
      pipeline: result.pipeline,
    });
  } catch (err) {
    console.error('createPipeline error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listPipelines(req, res) {
  try {
    const { limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const result = await crmService.listPipelines({
      tenantId: tenantKey,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      ok: true,
      pipelines: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('listPipelines error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getPipeline(req, res) {
  try {
    const { pipelineId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.listPipelines({
      tenantId: tenantKey,
      where: { id: pipelineId },
      limit: 1,
    });

    if (!result.items || result.items.length === 0) {
      return res.status(404).json({ ok: false, error: 'Pipeline not found' });
    }

    res.json({
      ok: true,
      pipeline: result.items[0],
    });
  } catch (err) {
    console.error('getPipeline error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function updatePipeline(req, res) {
  try {
    const { pipelineId } = req.params;
    const { name, status, isDefault, stages, attributes } = req.body;
    const { tenantKey, user, sequelize } = req;

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertPipeline({
      tenantId: tenantKey,
      id: pipelineId,
      name,
      status,
      isDefault,
      stages,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      pipeline: result.pipeline,
    });
  } catch (err) {
    console.error('updatePipeline error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deletePipeline(req, res) {
  try {
    const { pipelineId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.upsertPipeline({
      tenantId: tenantKey,
      id: pipelineId,
      name: 'DELETED',
      status: 'deleted',
    });

    res.json({
      ok: true,
      message: 'Pipeline deleted',
    });
  } catch (err) {
    console.error('deletePipeline error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Opportunities Handlers
 */

async function createOpportunity(req, res) {
  try {
    const { pipelineId, stageId, title, accountId, contactId, leadId, ownerUserId, valueCents = 0, currency = 'BRL', status = 'open', expectedCloseAt, attributes = {} } = req.body;
    const { tenantKey, user, sequelize } = req;

    if (!pipelineId || !stageId || !title) {
      return res.status(400).json({ ok: false, error: 'pipelineId, stageId, and title are required' });
    }

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertOpportunity({
      tenantId: tenantKey,
      pipelineId,
      stageId,
      title,
      accountId,
      contactId,
      leadId,
      ownerUserId,
      valueCents,
      currency,
      status,
      expectedCloseAt,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({
      ok: true,
      opportunity: result.opportunity,
    });
  } catch (err) {
    console.error('createOpportunity error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listOpportunities(req, res) {
  try {
    const { pipelineId, stageId, status, limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const where = {};
    if (pipelineId) where.pipeline_id = pipelineId;
    if (stageId) where.stage_id = stageId;
    if (status) where.status = status;

    const result = await crmService.listOpportunities({
      tenantId: tenantKey,
      where,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      ok: true,
      opportunities: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('listOpportunities error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getOpportunity(req, res) {
  try {
    const { opportunityId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.listOpportunities({
      tenantId: tenantKey,
      where: { id: opportunityId },
      limit: 1,
    });

    if (!result.items || result.items.length === 0) {
      return res.status(404).json({ ok: false, error: 'Opportunity not found' });
    }

    res.json({
      ok: true,
      opportunity: result.items[0],
    });
  } catch (err) {
    console.error('getOpportunity error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function updateOpportunity(req, res) {
  try {
    const { opportunityId } = req.params;
    const { pipelineId, stageId, title, accountId, contactId, leadId, ownerUserId, valueCents, currency, status, expectedCloseAt, attributes } = req.body;
    const { tenantKey, user, sequelize } = req;

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.upsertOpportunity({
      tenantId: tenantKey,
      id: opportunityId,
      pipelineId,
      stageId,
      title,
      accountId,
      contactId,
      leadId,
      ownerUserId,
      valueCents,
      currency,
      status,
      expectedCloseAt,
      attributes,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      opportunity: result.opportunity,
    });
  } catch (err) {
    console.error('updateOpportunity error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function moveOpportunityStage(req, res) {
  try {
    const { opportunityId } = req.params;
    const { toStageId } = req.body;
    const { tenantKey, user, sequelize } = req;

    if (!toStageId) {
      return res.status(400).json({ ok: false, error: 'toStageId is required' });
    }

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.moveOpportunityStage({
      tenantId: tenantKey,
      opportunityId,
      toStageId,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      opportunity: result.opportunity,
    });
  } catch (err) {
    console.error('moveOpportunityStage error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function deleteOpportunity(req, res) {
  try {
    const { opportunityId } = req.params;
    const { tenantKey } = req;

    const result = await crmService.upsertOpportunity({
      tenantId: tenantKey,
      id: opportunityId,
      title: 'DELETED',
      status: 'deleted',
      pipelineId: 'dummy',
      stageId: 'dummy',
    });

    res.json({
      ok: true,
      message: 'Opportunity deleted',
    });
  } catch (err) {
    console.error('deleteOpportunity error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Activities Handlers
 */

async function createActivity(req, res) {
  try {
    const { type, status = 'open', subjectType, subjectId, accountId, contactId, leadId, opportunityId, ownerUserId, dueAt, completedAt, payload = {} } = req.body;
    const { tenantKey, user, sequelize } = req;

    if (!type) {
      return res.status(400).json({ ok: false, error: 'type is required' });
    }

    const enhancedService = createCrmServiceWithWebhooks(crmService, sequelize);

    const result = await enhancedService.logActivity({
      tenantId: tenantKey,
      type,
      status,
      subjectType,
      subjectId,
      accountId,
      contactId,
      leadId,
      opportunityId,
      ownerUserId,
      dueAt,
      completedAt,
      payload,
      actorId: user?.id,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({
      ok: true,
      activity: result.activity,
    });
  } catch (err) {
    console.error('createActivity error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function listActivities(req, res) {
  try {
    const { opportunityId, accountId, limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const where = {};
    if (opportunityId) where.opportunity_id = opportunityId;
    if (accountId) where.account_id = accountId;

    const result = await crmService.listActivities({
      tenantId: tenantKey,
      where,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      ok: true,
      activities: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('listActivities error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getTimeline(req, res) {
  try {
    const { entityType, entityId } = req.params;
    const { limit = 200, offset = 0 } = req.query;
    const { tenantKey } = req;

    const result = await crmService.getUnifiedTimeline({
      tenantId: tenantKey,
      subjectType: entityType,
      subjectId: entityId,
      limit: Number(limit),
      offset: Number(offset),
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      timeline: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    console.error('getTimeline error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = {
  // Accounts
  createAccount,
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  // Contacts
  createContact,
  listContacts,
  getContact,
  updateContact,
  deleteContact,
  // Leads
  createLead,
  listLeads,
  getLead,
  updateLead,
  deleteLead,
  // Pipelines
  createPipeline,
  listPipelines,
  getPipeline,
  updatePipeline,
  deletePipeline,
  // Opportunities
  createOpportunity,
  listOpportunities,
  getOpportunity,
  updateOpportunity,
  moveOpportunityStage,
  deleteOpportunity,
  // Activities
  createActivity,
  listActivities,
  getTimeline,
};
