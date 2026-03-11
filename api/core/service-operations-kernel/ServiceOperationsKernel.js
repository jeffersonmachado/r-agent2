'use strict';

const { operationalEventsService } = require('../operational-events');
const { operationalSignalsService } = require('../operational-signals');
const { recommendationEngine } = require('../operational-recommendations');
const { OperationalDecisionEngine } = require('../operational-decision/OperationalDecisionEngine');
const { operationalActionsService } = require('../operational-actions');
const { operationalOutcomeEngine } = require('../operational-outcomes');
const { operationalMemoryService } = require('../operational-memory');
const {
  operationalStateReadService,
  operationalStateSnapshotService,
} = require('../operational-state');
const { operationalContextService } = require('../operational-context');
const { OperationalOccQueryService } = require('../operational-state');
const { SignalQueryService } = require('../operational-signals');

// Lazy-load factory to avoid circular dependency issues
let cachedOccStateRepository = null;
function getOccStateRepository() {
  if (!cachedOccStateRepository) {
    // Lazy load OCCOperationalStateRepository only when needed
    // Import directly from operational-state-v2 to avoid circular dependency at module load time
    const { OCCOperationalStateRepository } = require('../operational-state-v2');
    cachedOccStateRepository = new OCCOperationalStateRepository();
  }
  return cachedOccStateRepository;
}

let cachedOccQueryService = null;
function getOccQueryService(outcomeService) {
  if (!cachedOccQueryService) {
    // Lazy load OperationalOccQueryService only when needed
    const { OperationalOccQueryService } = require('../operational-state');
    cachedOccQueryService = new OperationalOccQueryService({
      outcomeService,
    });
  }
  return cachedOccQueryService;
}

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class ServiceOperationsKernel {
  constructor({
    eventsService,
    signalsService,
    recommendationsService,
    decisionEngine,
    actionsService,
    outcomesService,
    memoryService,
    stateReadService,
    stateSnapshotService,
    contextService,
    occQueryService,
    signalQueryService,
  } = {}) {
    this.eventsService = eventsService || operationalEventsService;
    this.signalsService = signalsService || operationalSignalsService;
    this.recommendationsService = recommendationsService || recommendationEngine;
    this.decisionEngine = decisionEngine || new OperationalDecisionEngine({
      occStateRepository: getOccStateRepository(),
    });
    this.actionsService = actionsService || operationalActionsService;
    this.outcomesService = outcomesService || operationalOutcomeEngine;
    this.memoryService = memoryService || operationalMemoryService;
    this.stateReadService = stateReadService || operationalStateReadService;
    this.stateSnapshotService = stateSnapshotService || operationalStateSnapshotService;
    this.contextService = contextService || operationalContextService;
    // Lazy-load occQueryService to avoid circular dependency during test execution
    this._occQueryService = occQueryService;
    this._outcomesServiceForOcc = this.outcomesService;
    this.signalQueryService = signalQueryService || new SignalQueryService();
  }

  get occQueryService() {
    if (!this._occQueryService) {
      this._occQueryService = getOccQueryService(this._outcomesServiceForOcc);
    }
    return this._occQueryService;
  }

  set occQueryService(value) {
    this._occQueryService = value;
  }

  async ingestEvent(input = {}) {
    return this.eventsService.ingestEvent(input);
  }

  async observeEvent(input = {}) {
    return this.ingestEvent(input);
  }

  async generateTenantSignals({ tenantId } = {}) {
    return this.signalsService.generateForTenant({ tenantId });
  }

  async generateContactSignals({ tenantId, contactId } = {}) {
    return this.signalsService.generateForContact({ tenantId, contactId });
  }

  async listTenantSignals(params = {}) {
    return this.signalsService.listTenantSignals(params);
  }

  async listContactSignals(params = {}) {
    return this.signalsService.listContactSignals(params);
  }

  async listOccSignals(params = {}) {
    return this.occQueryService.listTenantSignals(params);
  }

  async updateSignalStatus({ tenantId, signalId, status, actorId = null } = {}) {
    return this.signalQueryService.updateSignalStatus({
      tenantId,
      signalId,
      status,
      actorId,
      contextLabel: 'ServiceOperationsKernel.updateSignalStatus',
    });
  }

  async generateTenantRecommendations({ tenantId, includeSignalGeneration = true } = {}) {
    return this.recommendationsService.generateForTenant({ tenantId, includeSignalGeneration });
  }

  async generateContactRecommendations({ tenantId, contactId, includeSignalGeneration = true } = {}) {
    return this.recommendationsService.generateForContact({ tenantId, contactId, includeSignalGeneration });
  }

  async generateRecommendationsForSignals({ tenantId, signals = [] } = {}) {
    return this.recommendationsService.generateFromSignals({ tenantId, signals });
  }

  async listTenantRecommendations(params = {}) {
    return this.recommendationsService.listTenantRecommendations(params);
  }

  async listContactRecommendations(params = {}) {
    return this.recommendationsService.listContactRecommendations(params);
  }

  async listOccRecommendations(params = {}) {
    return this.occQueryService.listTenantRecommendations(params);
  }

  async updateRecommendationStatus({ tenantId, recommendationId, status, actorId = null } = {}) {
    return this.recommendationsService.updateRecommendationStatus({
      tenantId,
      recommendationId,
      status,
      actorId,
    });
  }

  async readProjectedState({ tenantId, contactId = null, limit = 120 } = {}) {
    return this.stateReadService.readState({ tenantId, contactId, limit });
  }

  async projectState(params = {}) {
    return this.readProjectedState(params);
  }

  async getStateSnapshot(params = {}) {
    return this.stateSnapshotService.getSnapshot(params);
  }

  async listSignalDecisions(params = {}) {
    return this.decisionEngine.listSignalDecisions(params);
  }

  async listRecommendationDecisions(params = {}) {
    return this.decisionEngine.listRecommendationDecisions(params);
  }

  async decideRecommendations(params = {}) {
    return this.listRecommendationDecisions(params);
  }

  async listOccActivePlaybooks(params = {}) {
    return this.occQueryService.listTenantActivePlaybooks(params);
  }

  async getOperationalKPIs(params = {}) {
    return this.occQueryService.getOperationalKPIs(params);
  }

  async getTopOperationalSignals(params = {}) {
    return this.occQueryService.getTopOperationalSignals(params);
  }

  async executeAction({
    tenantId,
    sourceType,
    sourceId,
    actionId,
    contactId = null,
    actorType = 'system',
    actorId = null,
    input = {},
  } = {}) {
    const normalizedSourceType = safeString(sourceType)?.toLowerCase();

    await this.memoryService.recordDecision({
      tenantId,
      contactId,
      sourceType: normalizedSourceType,
      sourceId,
      actionId,
      decisionType: 'selected',
      actionMode: normalizedSourceType === 'recommendation' ? 'quick_action' : 'signal_action',
    }).catch(() => null);

    if (normalizedSourceType === 'signal') {
      return this.actionsService.executeFromSignal({
        tenantId,
        signalId: sourceId,
        actionId,
        contactId,
        actorType,
        actorId,
        input,
      });
    }

    if (normalizedSourceType === 'recommendation') {
      return this.actionsService.executeFromRecommendation({
        tenantId,
        recommendationId: sourceId,
        actionId,
        contactId,
        actorType,
        actorId,
        input,
      });
    }

    return { ok: false, error: 'invalid_source_type' };
  }

  async startPlaybook(playbookId, context = {}) {
    await this.memoryService.recordDecision({
      tenantId: context?.tenantId,
      contactId: context?.contactId || null,
      sourceType: 'playbook',
      sourceId: playbookId,
      actionId: 'start_playbook',
      decisionType: 'selected',
      actionMode: 'playbook',
      metadata: {
        signalId: context?.signalId || null,
        recommendationId: context?.recommendationId || null,
      },
    }).catch(() => null);

    return this.actionsService.startPlaybook(playbookId, context);
  }

  async recordOutcome(params = {}) {
    return this.outcomesService.recordOutcome(params);
  }

  async listOutcomes(params = {}) {
    return this.outcomesService.listOutcomes(params);
  }

  async listOccOutcomes(params = {}) {
    return this.occQueryService.listTenantOutcomes(params);
  }

  async learnFromOutcome(params = {}) {
    return this.memoryService.recordOutcome(params);
  }

  async searchOperationalMemory(params = {}) {
    return this.memoryService.searchRelevantMemories(params);
  }

  async assembleTenantContext({ tenantId } = {}) {
    return this.contextService.assembleTenantContext({ tenantId });
  }

  async assembleContactContext({ tenantId, contactId, ticket = null, messages = [], userPrompt = '' } = {}) {
    return this.contextService.assembleContactContext({ tenantId, contactId, ticket, messages, userPrompt });
  }

  async runEventDrivenCycle({ event, execute = false, actionId = null, actorId = null } = {}) {
    const eventsOut = await this.ingestEvent(event);
    if (!eventsOut?.ok) return eventsOut;

    const tenantId = eventsOut.tenantId || event?.tenantId || event?.tenant_id;
    const contactId = eventsOut.contactId || event?.contactId || event?.contact_id || null;

    const recommendationsOut = contactId
      ? await this.generateContactRecommendations({ tenantId, contactId, includeSignalGeneration: false })
      : await this.generateTenantRecommendations({ tenantId, includeSignalGeneration: false });

    const decisionsOut = contactId
      ? await this.listRecommendationDecisions({ tenantId, contactId, limit: 50 })
      : await this.listRecommendationDecisions({ tenantId, limit: 50 });

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
  ServiceOperationsKernel,
};