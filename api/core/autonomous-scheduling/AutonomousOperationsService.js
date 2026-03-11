'use strict';

const recommendationEngine = require('../insights/RecommendationEngine');
const previewRunService = require('./PreviewRunService');

class AutonomousOperationsService {
  constructor({ recommendationsService, previewService, kernel } = {}) {
    this.recommendationsService = recommendationsService || recommendationEngine;
    this.previewService = previewService || previewRunService;
    this.kernel = kernel || null;
  }

  getKernel() {
    if (!this.kernel) {
      const { ServiceOperationsKernel } = require('../service-operations-kernel/ServiceOperationsKernel');
      this.kernel = new ServiceOperationsKernel();
    }
    return this.kernel;
  }

  async listRecommendations({ tenantId, serviceType = null, relatedEntityType = null, relatedEntityId = null } = {}) {
    const kernel = this.getKernel();
    const [recommendationsOut, stateOut] = await Promise.all([
      this.recommendationsService.listRecommendations({
        tenantId,
        serviceType,
        relatedEntityType,
        relatedEntityId,
      }),
      kernel.getStateSnapshot({ tenantId, limit: 80 }).catch(() => ({ ok: false })),
    ]);

    if (!recommendationsOut?.ok) return recommendationsOut;

    return {
      ...recommendationsOut,
      kernelState: stateOut?.ok ? stateOut.snapshot : null,
    };
  }

  async previewRun(params = {}) {
    const kernel = this.getKernel();
    const [previewOut, stateOut] = await Promise.all([
      this.previewService.previewRun(params),
      kernel.getStateSnapshot({ tenantId: params?.tenantId, limit: 80 }).catch(() => ({ ok: false })),
    ]);

    if (!previewOut?.ok) return previewOut;

    return {
      ...previewOut,
      preview: {
        ...(previewOut.preview || {}),
        operationalStateSnapshot: stateOut?.ok ? stateOut.snapshot : null,
      },
    };
  }
}

module.exports = {
  AutonomousOperationsService,
};
