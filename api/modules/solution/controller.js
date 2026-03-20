'use strict';

function createSolutionController({ service, deps }) {
  function ensureAuth(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  function ensurePermission(req, res, resource, action) {
    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  function ensureJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  return {
    async listPacks(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'read')) return;

      try {
        const items = service.listSolutionPacks();
        deps.sendJson(res, 200, { ok: true, items });
      } catch (err) {
        deps.logger.error('[Solutions] Erro ao listar packs', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar packs' });
      }
    },

    async installPack(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'update')) return;
      if (!ensureJson(req, res)) return;

      try {
        const result = await service.installSolutionPack({
          tenantId: req.tenantId,
          body: await deps.parseJsonBody(req),
        });

        if (!result.ok) {
          if (result.kind === 'bad_request') {
            deps.badRequest(res, result.message);
            return;
          }

          deps.sendJson(res, result.status || 400, result.payload || {
            ok: false,
            error: result.kind || 'install_failed',
          });
          return;
        }

        deps.sendJson(res, 200, result.payload);
      } catch (err) {
        deps.logger.error('[Solutions] Erro ao instalar pack', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao instalar pack' });
      }
    },
  };
}

module.exports = {
  createSolutionController,
};
