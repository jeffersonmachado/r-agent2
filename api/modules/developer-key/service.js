'use strict';

const { parseBooleanParam } = require('../public-token/validator');

function createDeveloperKeyService({ repository }) {
  return {
    parseListFilters(urlString) {
      const urlObj = new URL(urlString || '/', 'http://localhost');
      return {
        includeToken: urlObj.searchParams.get('includeToken') === 'true',
        active: parseBooleanParam(urlObj.searchParams.get('active')),
      };
    },

    parseCreatePayload(body) {
      return {
        name: body && body.name ? String(body.name).trim() : '',
        description: body && body.description ? String(body.description).trim() : '',
        expiresInSec: body && body.expiresInSec != null ? Number(body.expiresInSec) : null,
      };
    },

    listDeveloperKeys({ tenantId, active, includeToken }) {
      return repository.listPublicTokens({
        tenantId,
        kind: 'developer',
        active,
        includeToken,
      });
    },

    createDeveloperKey({ tenantId, name, description, expiresInSec }) {
      return repository.createPublicToken({
        tenantId,
        kind: 'developer',
        meta: {
          name: name || null,
          description: description || null,
        },
        expiresInSec,
      });
    },

    getDeveloperUsage({ tenantId }) {
      return Promise.all([
        repository.getPublicTokenStats({ tenantId }),
        repository.listPublicTokens({ tenantId, kind: 'developer', includeToken: false }),
      ]).then(([result, keys]) => ({ result, keys }));
    },

    buildUsageResponse({ tenantId, result, keys }) {
      const items = Array.isArray(result.items) ? result.items.filter((it) => it.kind === 'developer') : [];
      const routesMap = new Map();

      for (const key of keys || []) {
        const usageByRoute = key?.meta?.usageByRoute && typeof key.meta.usageByRoute === 'object'
          ? key.meta.usageByRoute
          : {};

        for (const [route, routeInfo] of Object.entries(usageByRoute)) {
          const current = routesMap.get(route) || {
            route,
            count: 0,
            lastUsedAt: null,
            lastStatusCode: null,
            keys: 0,
          };
          const count = Number(routeInfo?.count || 0);
          const lastUsedAtRaw = routeInfo?.lastUsedAt ? new Date(routeInfo.lastUsedAt) : null;

          current.count += count;
          current.keys += 1;
          current.lastStatusCode = Number(routeInfo?.lastStatusCode || current.lastStatusCode || 0) || current.lastStatusCode;
          if (lastUsedAtRaw && !Number.isNaN(lastUsedAtRaw.getTime())) {
            if (!current.lastUsedAt || lastUsedAtRaw > new Date(current.lastUsedAt)) {
              current.lastUsedAt = lastUsedAtRaw.toISOString();
            }
          }
          routesMap.set(route, current);
        }
      }

      const routes = Array.from(routesMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);
      const totals = items.reduce((acc, it) => {
        acc.total += it.total;
        acc.active += it.active;
        acc.inactive += it.inactive;
        acc.revoked += it.revoked;
        acc.expired += it.expired;
        return acc;
      }, { total: 0, active: 0, inactive: 0, revoked: 0, expired: 0 });

      return {
        ok: true,
        tenantId,
        totals,
        items,
        routes,
      };
    },
  };
}

module.exports = {
  createDeveloperKeyService,
};
