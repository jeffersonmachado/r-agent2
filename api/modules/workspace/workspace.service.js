'use strict';

const WorkspaceEntityService = require('../../services/workspace/WorkspaceEntityService');
const WorkspaceTimelineService = require('../../services/workspace/WorkspaceTimelineService');
const WorkspaceInsightService = require('../../services/workspace/WorkspaceInsightService');
const WorkspaceActionService = require('../../services/workspace/WorkspaceActionService');
const WorkspaceOperationsService = require('../../services/workspace/WorkspaceOperationsService');
const { AutoCorrectionService } = require('../../services/autocorrection');
const { clampLimit, offsetValue } = require('../../services/workspace/workspaceUtils');

function createWorkspaceService(deps = {}) {
  const entityService = deps.entityService || new WorkspaceEntityService(deps);
  const timelineService = deps.timelineService || new WorkspaceTimelineService(deps);
  const operationsService = deps.operationsService || new WorkspaceOperationsService({ ...deps, entityService });
  const insightService = deps.insightService || new WorkspaceInsightService({ ...deps, timelineService });
  const actionService = deps.actionService || new WorkspaceActionService({ ...deps, insightService, operationsService });
  const autoCorrectionService = deps.autoCorrectionService || new AutoCorrectionService({ ...deps, timelineService });

  return {
    listEntities: (tenantId, query = {}) => entityService.listEntities({ tenantId, q: query.q, limit: clampLimit(query.limit, 50, 100), offset: offsetValue(query.offset) }),
    getEntity: (tenantId, entityId) => entityService.getEntity({ tenantId, entityId }),
    createEntity: (tenantId, body = {}) => entityService.getOrCreateEntityFromContact({ tenantId, contact: { type: body.type, name: body.name, phone: body.phone, email: body.email, source: body.source || 'workspace', refId: body.refId, raw: body.metadata || {} } }),
    linkEntity: (tenantId, body = {}) => entityService.linkEntity({ tenantId, entityId: body.entityId || body.entity_id, sourceType: body.sourceType || body.source_type, sourceId: body.sourceId || body.source_id, confidence: body.confidence ?? 1 }),
    getTimeline: (tenantId, entityId, query = {}) => timelineService.getEntityTimeline({ tenantId, entityId, limit: query.limit, offset: query.offset, type: query.type }),
    getInsights: async (tenantId, entityId, { classification } = {}) => {
      const timeline = await timelineService.getEntityTimeline({ tenantId, entityId, limit: 100, offset: 0 });
      if (!timeline) return null;
      await autoCorrectionService.ensureForEntityFailures({ tenantId, entityId, timeline });
      return insightService.generateInsights(entityId, { tenantId, timeline, includeTechnical: classification === 'DEVELOPMENT' });
    },
    getActions: async (tenantId, entityId, { classification } = {}) => {
      const [items, suggestion] = await Promise.all([actionService.listActions({ tenantId, entityId }), actionService.suggestNextBestAction({ tenantId, entityId, classification })]);
      return { items, suggestion };
    },
    getAutoCorrections: async (tenantId, entityId) => {
      const timeline = await timelineService.getEntityTimeline({ tenantId, entityId, limit: 100, offset: 0 });
      if (!timeline) return null;
      await autoCorrectionService.ensureForEntityFailures({ tenantId, entityId, timeline });
      return autoCorrectionService.listRunsForEntity({ tenantId, entityId });
    },
    createAction: (tenantId, body = {}) => actionService.createAction({ tenantId, entityId: body.entityId || body.entity_id, type: body.type, status: body.status, payload: body.payload }),
    executeSuggestedActions: async (tenantId, entityId, { classification } = {}) => {
      const insights = await insightService.generateInsights(entityId, { tenantId, includeTechnical: classification === 'DEVELOPMENT' });
      return { items: await actionService.autoCreateTasksFromInsights({ tenantId, entityId, insights: insights?.items || [] }) };
    },
    createTask: (tenantId, body = {}) => operationsService.createTask({ tenantId, payload: body }),
    listTasks: (tenantId, query = {}) => operationsService.listTasks({ tenantId, entityId: query.entity_id || query.entityId, status: query.status, limit: query.limit, offset: query.offset }),
    createTimesheetEntry: (tenantId, body = {}, userId = null) => operationsService.createTimesheetEntry({ tenantId, payload: body, userId }),
    listTimesheetEntries: (tenantId, query = {}) => operationsService.listTimesheetEntries({ tenantId, query }),
    createResource: (tenantId, body = {}) => operationsService.createResource({ tenantId, payload: body }),
    listResources: (tenantId, query = {}) => operationsService.listResources({ tenantId, query }),
    createResourceAvailability: (tenantId, body = {}) => operationsService.createResourceAvailability({ tenantId, payload: body }),
    createResourceBooking: (tenantId, body = {}) => operationsService.createResourceBooking({ tenantId, payload: body }),
    listResourceBookings: (tenantId, query = {}) => operationsService.listResourceBookings({ tenantId, query }),
    createPaymentEvent: (tenantId, body = {}) => operationsService.createPaymentEvent({ tenantId, payload: body }),
    listPaymentEvents: (tenantId, query = {}) => operationsService.listPaymentEvents({ tenantId, query }),
  };
}

module.exports = { createWorkspaceService };
