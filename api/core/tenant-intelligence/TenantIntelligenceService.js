'use strict';

const { ContextResolver } = require('./ContextResolver');
const { GoalEngine } = require('./GoalEngine');
const { MetricEngine } = require('./MetricEngine');
const { EvidenceEngine } = require('./EvidenceEngine');
const { InsightEngine } = require('./InsightEngine');
const { RecommendationEngine } = require('./RecommendationEngine');
const { StrategicSearchService } = require('./StrategicSearchService');
const { TenantOperationalStateEngine } = require('./TenantOperationalStateEngine');
const { MarketKnowledgeService } = require('../market-intelligence/MarketKnowledgeService');

class TenantIntelligenceService {
  constructor(deps = {}) {
    this.contextResolver = deps.contextResolver || new ContextResolver();
    this.goalEngine = deps.goalEngine || new GoalEngine();
    this.metricEngine = deps.metricEngine || new MetricEngine();
    this.evidenceEngine = deps.evidenceEngine || new EvidenceEngine();
    this.insightEngine = deps.insightEngine || new InsightEngine({
      evidenceEngine: this.evidenceEngine,
      goalEngine: this.goalEngine,
      metricEngine: this.metricEngine,
    });
    this.recommendationEngine = deps.recommendationEngine || new RecommendationEngine();
    this.marketKnowledgeService = deps.marketKnowledgeService || new MarketKnowledgeService();
    this.strategicSearchService = deps.strategicSearchService || new StrategicSearchService({
      contextResolver: this.contextResolver,
      goalEngine: this.goalEngine,
      metricEngine: this.metricEngine,
      insightEngine: this.insightEngine,
      recommendationEngine: this.recommendationEngine,
      evidenceEngine: this.evidenceEngine,
    });
    this.tenantOperationalStateEngine = deps.tenantOperationalStateEngine || new TenantOperationalStateEngine({
      contextResolver: this.contextResolver,
      goalEngine: this.goalEngine,
      metricEngine: this.metricEngine,
      insightEngine: this.insightEngine,
      recommendationEngine: this.recommendationEngine,
      evidenceEngine: this.evidenceEngine,
      marketKnowledgeService: this.marketKnowledgeService,
    });
  }

  async resolveContext(input) {
    return this.contextResolver.resolve(input);
  }

  async createGoal(input) {
    return this.goalEngine.createGoal(input);
  }

  async listGoals(input) {
    return this.goalEngine.listGoals(input);
  }

  async getGoalById(input) {
    return this.goalEngine.getGoalById(input);
  }

  async updateGoal(input) {
    return this.goalEngine.updateGoal(input);
  }

  async collectMetricSnapshots(input) {
    return this.metricEngine.collectSnapshots(input);
  }

  async listMetricSnapshots(input) {
    return this.metricEngine.listSnapshots(input);
  }

  async generateInsights(input) {
    return this.insightEngine.generateInsights(input);
  }

  async listInsights(input) {
    return this.insightEngine.listInsights(input);
  }

  async listEvidenceByInsight(input) {
    return this.evidenceEngine.listByInsight(input);
  }

  async generateRecommendations(input) {
    return this.recommendationEngine.generateRecommendations(input);
  }

  async listRecommendations(input) {
    return this.recommendationEngine.listRecommendations(input);
  }

  async applyRecommendation(input) {
    return this.recommendationEngine.applyRecommendation(input);
  }

  async applyAllOpenRecommendations(input) {
    return this.recommendationEngine.applyAllOpen(input);
  }

  async dismissRecommendation(input) {
    return this.recommendationEngine.dismissRecommendation(input);
  }

  async evaluateRecommendationOutcome(input) {
    return this.recommendationEngine.evaluateOutcome(input);
  }

  async searchStrategic(input) {
    return this.strategicSearchService.search(input);
  }

  async getOperationalState(input) {
    return this.tenantOperationalStateEngine.getOperationalState(input);
  }

  async getMarketBenchmarks(input) {
    return this.marketKnowledgeService.getBenchmarks(input?.tenantKey || input?.tenantId, input || {});
  }

  async getMarketPatterns(input) {
    return this.marketKnowledgeService.getMarketPatterns(input?.vertical, input || {});
  }

  async getMarketPredictions(input) {
    return this.marketKnowledgeService.getPredictions(input?.tenantKey || input?.tenantId, input || {});
  }

  async getMarketPlaybooks(input) {
    return this.marketKnowledgeService.getMarketPlaybooks(input?.vertical, input || {});
  }
}

let serviceSingleton = null;

function getTenantIntelligenceService() {
  if (!serviceSingleton) {
    serviceSingleton = new TenantIntelligenceService();
  }
  return serviceSingleton;
}

module.exports = {
  TenantIntelligenceService,
  getTenantIntelligenceService,
};
