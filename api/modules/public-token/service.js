'use strict';

const { ALLOWED_KINDS, parseBooleanParam, validateKind } = require('./validator');

function createPublicTokenService({ repository }) {
  return {
    parseListFilters(urlString) {
      const urlObj = new URL(urlString || '/', 'http://localhost');
      const kind = urlObj.searchParams.get('kind');
      const locationId = urlObj.searchParams.get('locationId');
      const active = parseBooleanParam(urlObj.searchParams.get('active'));
      const includeToken = urlObj.searchParams.get('includeToken') === 'true';

      return {
        kind: kind ? String(kind) : null,
        locationId: locationId ? String(locationId) : null,
        active,
        includeToken,
      };
    },

    parseCreatePayload(body) {
      const kind = body && body.kind ? String(body.kind).trim() : '';
      const locationId = body && body.locationId ? String(body.locationId).trim() : null;
      const meta = body && typeof body.meta === 'object' && body.meta ? body.meta : {};
      const expiresInSec = body && body.expiresInSec != null ? Number(body.expiresInSec) : null;

      return {
        kind,
        locationId,
        meta,
        expiresInSec,
      };
    },

    validateCreatePayload(payload) {
      if (!validateKind(payload.kind)) {
        return {
          valid: false,
          message: 'Campo "kind" inválido. Use: storefront|kiosk|panel|station|access_control',
        };
      }

      return { valid: true };
    },

    parseRevokeRequest(urlString) {
      const urlObj = new URL(urlString || '/', 'http://localhost');
      const reason = urlObj.searchParams.get('reason');

      return {
        reason: reason ? String(reason) : null,
      };
    },

    parseRotateRequest(urlString) {
      const urlObj = new URL(urlString || '/', 'http://localhost');
      const expiresInSecRaw = urlObj.searchParams.get('expiresInSec');

      return {
        expiresInSec: expiresInSecRaw != null ? Number(expiresInSecRaw) : null,
      };
    },

    parseResolveRequest(urlString) {
      const urlObj = new URL(urlString || '/', 'http://localhost');
      const token = urlObj.searchParams.get('token');

      return { token };
    },

    listPublicTokens(params) {
      return repository.listPublicTokens(params);
    },

    getPublicTokenStats(params) {
      return repository.getPublicTokenStats(params);
    },

    createPublicToken(params) {
      return repository.createPublicToken(params);
    },

    revokePublicToken(params) {
      return repository.revokePublicToken(params);
    },

    rotatePublicToken(params) {
      return repository.rotatePublicToken(params);
    },

    resolvePublicToken(token) {
      return repository.resolvePublicToken({
        token,
        allowedKinds: ALLOWED_KINDS,
      });
    },

    getAllowedKinds() {
      return ALLOWED_KINDS;
    },
  };
}

module.exports = {
  createPublicTokenService,
};
