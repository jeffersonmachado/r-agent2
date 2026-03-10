'use strict';

const { OperationalEventsService } = require('../operational-events/OperationalEventsService');
const { OperationalSignalsService } = require('../operational-signals/OperationalSignalsService');
const { RecommendationEngine } = require('../operational-recommendations/RecommendationEngine');
const { OperationalDecisionEngine } = require('../operational-decision/OperationalDecisionEngine');
const { OperationalActionsService } = require('../operational-actions/OperationalActionsService');
const { OperationalOutcomeEngine } = require('../operational-outcomes/OperationalOutcomeEngine');
const { OperationalMemoryService } = require('../operational-memory/OperationalMemoryService');
const { OperationalStateSnapshotService } = require('../operational-state/OperationalStateSnapshotService');
const { OperationalContextService } = require('../operational-context/OperationalContextService');
const { OperationalOccQueryService } = require('../operational-agent/OperationalOccQueryService');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class OperationalPipelineService {
  constructor({
    eventService,
    signalService,
    recommendationService,
    decisionService,
    actionService,
    outcomeService,
    memoryService,
    stateService,
    contextService,
    occQueryService,
  } = {}) {
    this.eventService = eventService || new OperationalEventsService();
    this.signalService = signalService || new OperationalSignalsService();
    this.recommendationService = recommendationService || new RecommendationEngine();
    this.decisionService = decisionService || new OperationalDecisionEngine();
    this.actionService = actionService || new OperationalActionsService();
    this.outcomeService = outcomeService || new OperationalOutcomeEngine();
    this.memoryService = memoryService || new OperationalMemoryService();
    this.stateService = stateService || new OperationalStateSnapshotService();
    this.contextService = contextService || new OperationalContextService();
    this.occQueryService = occQueryService || new OperationalOccQueryService();
  }

  async ingestEvent(input = {}) {
    return this.eventService.ingestEvent(input);
  }

  async generateTenantSignals({ tenantId } = {}) {
    return this.signalService.generateForTenant({ tenantId });
  }

  async generateContactSignals({ tenantId, contactId } = {}) {
    return this.signalService.generateForContact({ tenantId, contactId });
  }

  async listTenantSignals(params = {}) {
    return this.signalService.listTenantSignals(params);
  }

  async listContactSignals(params = {}) {
    return this.signalService.listContactSignals(params);
  }

  async listOccSignals(params = {}) {
    return this.occQueryService.listTenantSignals(params);
  }

  async updateSignalStatus({ tenantId, signalId, status, actorId = null } = {}) {
    const { SignalQueryService } = require('../operational-agent/SignalQueryService');
    const signalQueryService = new SignalQueryService();
    return signalQueryService.updateSignalStatus({
      tenantId,
      signalId,
      status,
      actorId,
      contextLabel: 'OperationalPipelineService.updateSignalStatus',
    });
  }

  async generateTenantRecommendations({ tenantId, includeSignalGeneration = true } = {}) {
    return this.recommendationService.generateForTenant({ tenantId, includeSignalGeneration });
  }

  async generateContactRecommendations({ tenantId, contactId, includeSignalGeneration = true } = {}) {
    return this.recommendationService.generateForContact({ tenantId, contactId, includeSignalGeneration });
  }

  async generateRecommendationsForSignals({ tenantId, signals = [] } = {}) {
    return this.recommendationService.generateFromSignals({ tenantId, signals });
  }

  async listTenantRecommendations(params = {}) {
    return this.recommendationService.listTenantRecommendations(params);
  }

  async listContactRecommendations(params = {}) {
    return this.recommendationService.listContactRecommendations(params);
  }

  async listOccRecommendations(params = {}) {
    return this.occQueryService.listTenantRecommendations(params);
  }

  async updateRecommendationStatus({ tenantId, recommendationId, status, actorId = null } = {}) {
    return this.recommendationService.updateRecommendationStatus({
      tenantId,
      recommendationId,
      status,
      actorId,
    });
  }

  async listSignalDecisions(params = {}) {
    return this.decisionService.listSignalDecisions(params);
  }

  async listRecommendationDecisions(params = {}) {
    return this.decisionService.listRecommendationDecisions(params);
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
      return this.actionService.executeFromSignal({
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
      return this.actionService.executeFromRecommendation({
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
    return this.actionService.startPlaybook(playbookId, context);
  }

  async recordOutcome(params = {}) {
    return this.outcomeService.recordOutcome(params);
  }

  async listOutcomes(params = {}) {
    return this.outcomeService.listOutcomes(params);
  }

  async listOccOutcomes(params = {}) {
    return this.occQueryService.listTenantOutcomes(params);
  }

  async getStateSnapshot(params = {}) {
    return this.stateService.getSnapshot(params);
  }

  async assembleTenantContext({ tenantId } = {}) {
    return this.contextService.assembleTenantContext({ tenantId });
  }

  async assembleContactContext({ tenantId, contactId, ticket = null, messages = [], userPrompt = '' } = {}) {
    return this.contextService.assembleContactContext({ tenantId, contactId, ticket, messages, userPrompt });
  }
}

module.exports = {
  OperationalPipelineService,
};
