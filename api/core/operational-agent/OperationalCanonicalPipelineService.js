'use strict';

const { operationalEventsService } = require('../operational-events');
const { operationalSignalsService } = require('../operational-signals');
const { recommendationEngine } = require('../operational-recommendations');
const { OperationalDecisionEngine } = require('../operational-decision');
const { operationalActionsService } = require('../operational-actions');
const { operationalOutcomeEngine } = require('../operational-outcomes');
const { operationalMemoryService } = require('../operational-memory');

class OperationalCanonicalPipelineService {
  constructor({
    eventsService,
    signalsService,
    recommendationsService,
    decisionEngine,
    actionsService,
    outcomesService,
    memoryService,
  } = {}) {
    this.eventsService = eventsService || operationalEventsService;
    this.signalsService = signalsService || operationalSignalsService;
    this.recommendationsService = recommendationsService || recommendationEngine;
    this.decisionEngine = decisionEngine || new OperationalDecisionEngine();
    this.actionsService = actionsService || operationalActionsService;
    this.outcomesService = outcomesService || operationalOutcomeEngine;
    this.memoryService = memoryService || operationalMemoryService;
  }

  async runEventDrivenCycle({ event, execute = false, actionId = null, actorId = null } = {}) {
    const eventsOut = await this.eventsService.ingestEvent(event);
    if (!eventsOut?.ok) return eventsOut;

    const tenantId = eventsOut.tenantId || event?.tenantId || event?.tenant_id;
    const contactId = eventsOut.contactId || event?.contactId || event?.contact_id || null;

    const recommendationsOut = contactId
      ? await this.recommendationsService.generateForContact({ tenantId, contactId, includeSignalGeneration: false })
      : await this.recommendationsService.generateForTenant({ tenantId, includeSignalGeneration: false });

    const decisionsOut = contactId
      ? await this.decisionEngine.listRecommendationDecisions({ tenantId, contactId, limit: 50 })
      : await this.decisionEngine.listRecommendationDecisions({ tenantId, limit: 50 });

    let actionExecution = null;
    if (execute === true && actionId && decisionsOut?.ok && Array.isArray(decisionsOut.items) && decisionsOut.items.length > 0) {
      const selected = decisionsOut.items[0];
      actionExecution = await this.actionsService.executeFromRecommendation({
        tenantId,
        recommendationId: selected.recommendationId || selected.sourceId,
        actionId,
        contactId: selected.contactId || contactId,
        actorType: 'system',
        actorId,
        input: {
          signalId: selected.signalId,
          recommendationId: selected.recommendationId,
          sourceEventId: event?.id || event?.eventId || event?.event_id || null,
        },
      });
    }

    const outcomesOut = await this.outcomesService.listOutcomes({ tenantId, contactId, limit: 50 }).catch(() => ({ ok: false, items: [] }));
    const memoryOut = contactId && tenantId
      ? await this.memoryService.searchRelevantMemories({
          tenantId,
          ticketId: event?.payload?.ticketId || event?.ticketId || null,
          conversationId: event?.payload?.conversationId || null,
          queryText: event?.payload?.message || event?.type || 'operational_event',
          topK: 5,
        }).catch(() => ({ ok: false, items: [] }))
      : { ok: true, items: [] };

    return {
      ok: true,
      events: eventsOut,
      signals: eventsOut.signals || [],
      recommendations: recommendationsOut?.items || recommendationsOut?.generated || [],
      decisions: decisionsOut?.items || [],
      actionExecution,
      outcomes: outcomesOut?.items || [],
      memory: memoryOut?.items || [],
    };
  }
}

module.exports = {
  OperationalCanonicalPipelineService,
};
