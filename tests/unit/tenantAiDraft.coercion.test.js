'use strict';

/**
 * Coercion-guard tests for tenantAiDraft.js
 * Verifies hostile toString() on AI-provided tenant data doesn't crash.
 */

const { buildTenantDraftFromAi, slugifyTenantKey } = require('../../api/services/tenantAiDraft');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

describe('tenantAiDraft – coercion guards', () => {
  test('slugifyTenantKey: hostile name does not throw', () => {
    expect(() => slugifyTenantKey(hostileToString())).not.toThrow();
    expect(typeof slugifyTenantKey(hostileToString())).toBe('string');
  });

  test('buildTenantDraftFromAi: hostile name/site/ramo_atividade/objetivo do not throw', () => {
    expect(() => buildTenantDraftFromAi({
      name: hostileToString(),
      site: hostileToString(),
      ramo_atividade: hostileToString(),
      objetivo: hostileToString(),
    })).not.toThrow();
  });

  test('buildTenantDraftFromAi: hostile fields produce fallback strings', () => {
    const draft = buildTenantDraftFromAi({
      name: hostileToString(),
      site: hostileToString(),
    });
    expect(typeof draft.name).toBe('string');
    expect(typeof draft.site).toBe('string');
  });
});
