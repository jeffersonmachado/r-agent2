'use strict';

module.exports = {
  policyService: require('./AutonomousSchedulePolicyService'),
  waitingListService: require('./WaitingListService'),
  gapDetectionService: require('./GapDetectionService'),
  candidateRankingService: require('./CandidateRankingService'),
  campaignService: require('./AutonomousCampaignService'),
  metricsService: require('./MetricsService'),
  runtimeService: require('./AutonomousRuntimeService'),
  operationalMetricsAggregator: require('./OperationalMetricsAggregator'),
  snapshotService: require('./OperationalMetricSnapshotService'),
  predictiveInsightsService: require('./PredictiveInsightsService'),
  previewRunService: require('./PreviewRunService'),
  verticalTemplateRegistry: require('./VerticalTemplateRegistry'),
  jobs: {
    detectGapsJob: require('./jobs/detectGapsJob'),
    fillGapCampaignsJob: require('./jobs/fillGapCampaignsJob'),
  },
};
