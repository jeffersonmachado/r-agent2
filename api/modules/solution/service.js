'use strict';

function normalizeSegment(body) {
  return body && body.segment ? String(body.segment).trim() : '';
}

function createSolutionService({ solutionsTemplateService }) {
  return {
    listSolutionPacks() {
      return solutionsTemplateService.listSolutionPacks();
    },

    parseInstallPayload(body) {
      return {
        segment: normalizeSegment(body),
      };
    },

    async installSolutionPack({ tenantId, body }) {
      const { segment } = this.parseInstallPayload(body);

      if (!segment) {
        return {
          ok: false,
          status: 400,
          kind: 'bad_request',
          message: 'segment é obrigatório',
        };
      }

      const result = await solutionsTemplateService.installSolutionPack({ tenantId, segment });
      if (!result.success) {
        return {
          ok: false,
          status: 400,
          kind: 'install_failed',
          payload: { ok: false, error: result.error || 'install_failed' },
        };
      }

      return {
        ok: true,
        payload: { ok: true, ...result },
      };
    },
  };
}

module.exports = {
  createSolutionService,
};
