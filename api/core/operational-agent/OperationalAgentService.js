'use strict';

const { SignalService } = require('./SignalService');
const { SignalQueryService } = require('./SignalQueryService');
const { RecommendationService } = require('./RecommendationService');
const { RecommendationQueryService } = require('./RecommendationQueryService');
const { OperationalEventProcessor } = require('./OperationalEventProcessor');
const { RecommendationEngine } = require('../operational-recommendations/RecommendationEngine');
const { RecommendationStore } = require('../operational-recommendations/RecommendationStore');
const { SignalRepository } = require('../operational-recommendations/SignalRepository');

class OperationalAgentService {
  constructor({
    detectionService,
    recommendationScorer,
    signalRegistry,
    signalService,
    signalQueryService,
    recommendationService,
    recommendationQueryService,
    eventProcessor,
    recommendationEngine,
    recommendationStore,
    signalRepository,
  } = {}) {
    this.signalService = signalService || new SignalService({ detectionService, signalRegistry });
    this.signalQueryService = signalQueryService || new SignalQueryService({ signalRegistry });

    const recommendationBuilder = recommendationScorer && typeof recommendationScorer.createRecommendationPayloadFromSignal === 'function'
      ? (signal) => recommendationScorer.createRecommendationPayloadFromSignal(signal)
      : null;

    this.recommendationEngine = recommendationEngine || new RecommendationEngine({
      signalRepository: signalRepository || new SignalRepository({ signalRegistry }),
      recommendationStore: recommendationStore || new RecommendationStore(),
      signalService: this.signalService,
      recommendationBuilder,
    });

    this.recommendationService = recommendationService || new RecommendationService({
      recommendationEngine: this.recommendationEngine,
    });

    this.recommendationQueryService = recommendationQueryService || new RecommendationQueryService({
      recommendationEngine: this.recommendationEngine,
    });

    this.eventProcessor = eventProcessor || new OperationalEventProcessor({
      detectionService,
      signalRegistry,
      recommendationService: this.recommendationService,
    });
  }

  async generateTenantSignals({ tenantId }) {
    return this.signalService.generateTenantSignals({
      tenantId,
      contextLabel: 'OperationalAgentService.generateTenantSignals',
    });
  }

  async generateContactSignals({ tenantId, contactId }) {
    return this.signalService.generateContactSignals({
      tenantId,
      contactId,
      contextLabel: 'OperationalAgentService.generateContactSignals',
    });
  }

  async listTenantSignals({ tenantId, activeOnly = false, limit = 200 }) {
    return this.signalQueryService.listTenantSignals({ tenantId, activeOnly, limit });
  }

  async listContactSignals({ tenantId, contactId, activeOnly = false, limit = 200 }) {
    return this.signalQueryService.listContactSignals({ tenantId, contactId, activeOnly, limit });
  }

  async updateSignalStatus({ tenantId, signalId, status, actorId = null }) {
    return this.signalQueryService.updateSignalStatus({
      tenantId,
      signalId,
      status,
      actorId,
      contextLabel: 'OperationalAgentService.updateSignalStatus',
    });
  }

  async generateTenantRecommendations({ tenantId, includeSignalGeneration = true }) {
    return this.recommendationService.generateTenantRecommendations({ tenantId, includeSignalGeneration });
  }

  async generateContactRecommendations({ tenantId, contactId, includeSignalGeneration = true }) {
    return this.recommendationService.generateContactRecommendations({ tenantId, contactId, includeSignalGeneration });
  }

  async generateRecommendationsForSignals({ tenantId, signals = [] }) {
    return this.recommendationService.generateRecommendationsForSignals({ tenantId, signals });
  }

  async processOperationalEvent({ event, dedupWindowMinutes = 240 } = {}) {
    return this.eventProcessor.processOperationalEvent({ event, dedupWindowMinutes });
  }

  async listTenantRecommendations({ tenantId, limit = 200 }) {
    return this.recommendationQueryService.listTenantRecommendations({ tenantId, limit });
  }

  async listContactRecommendations({ tenantId, contactId, limit = 200 }) {
    return this.recommendationQueryService.listContactRecommendations({ tenantId, contactId, limit });
  }

  async updateRecommendationStatus({ tenantId, recommendationId, status, actorId = null }) {
    return this.recommendationQueryService.updateRecommendationStatus({ tenantId, recommendationId, status, actorId });
  }
}

module.exports = {
  OperationalAgentService,
};
