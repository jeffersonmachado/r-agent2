'use strict';

const { operationalStateReadService } = require('../operational-state');

function getDefaultPlaybookEngine() {
  const { operationalPlaybookEngine } = require('../operational-playbooks');
  return operationalPlaybookEngine;
}

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

/**
 * Queries the operational state of an entity (signals, recommendations, outcomes, playbooks).
 * Canonical location: api/core/operational-context.
 * Used by support core routes to populate the entity-level operational context panel.
 */
class OperationalContextQueryService {
  constructor({ stateService, playbookEngine } = {}) {
    this.stateService = stateService || operationalStateReadService;
    this.playbookEngine = playbookEngine || null;
  }

  async getEntityContext({
    tenantId,
    entityType,
    entityId,
    contactId = null,
    limit = 80,
    sourceType = null,
    sourceId = null,
    actions = [],
  } = {}) {
    const entityTypeKey = safeString(entityType);
    const entityIdKey = safeString(entityId);
    const isContactEntity = ['contact', 'crm_contact'].includes(
      String(entityTypeKey || '').toLowerCase()
    );
    const resolvedContactId = isContactEntity
      ? entityIdKey
      : safeString(contactId);

    const stateOut = await this.stateService.readState({
      tenantId,
      contactId: resolvedContactId,
      limit,
    });

    let playbooks = [];
    if (resolvedContactId) {
      const playbookEngine = this.playbookEngine || getDefaultPlaybookEngine();
      const playbookOut = await playbookEngine
        .listSuggestedPlaybooksForContact({
          tenantId,
          contactId: resolvedContactId,
          limit: Math.min(limit, 20),
        })
        .catch(() => ({ ok: false, items: [] }));
      playbooks = playbookOut?.ok ? (playbookOut.items || []) : [];
    }

    const outcomesOut = await this.stateService.listOutcomes({
      tenantId,
      sourceType: safeString(sourceType),
      sourceId: safeString(sourceId),
      limit: Math.min(limit, 60),
    });

    return {
      ok: true,
      entity: {
        entityType: entityTypeKey,
        entityId: entityIdKey,
        tenantId: safeString(tenantId),
        contactId: resolvedContactId,
      },
      signals: stateOut?.signals || [],
      recommendations: stateOut?.recommendations || [],
      actions: Array.isArray(actions) ? actions : [],
      playbooks,
      outcomes: outcomesOut?.ok ? (outcomesOut.items || []) : [],
    };
  }
}

module.exports = {
  OperationalContextQueryService,
};
