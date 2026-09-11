'use strict';

/**
 * Escopo de tenant da recuperação RAG (Node): declaração canônica do
 * Knowledge Plane para GLOBAL_OPERATIONAL ∪ TENANT_OPERATIONAL.
 *
 * O conhecimento operacional global (roteiros canônicos, manuais de produto)
 * é indexado sob a chave de tenant `system`. A recuperação precisa uni-lo ao
 * conhecimento do tenant atual — e NUNCA ao de outro tenant, nem ao domínio
 * SYSTEM.
 */

const {
  resolveRetrievalTenantKeys,
  getGlobalOperationalTenant,
  DEFAULT_GLOBAL_OPERATIONAL_TENANT,
} = require('../../src/core/knowledge-plane');

describe('Knowledge Plane — escopo de tenant da recuperação', () => {
  afterEach(() => {
    delete process.env.RAG_GLOBAL_OPERATIONAL_TENANT;
  });

  test('OPERATIONAL une o tenant atual ao conhecimento global', () => {
    expect(resolveRetrievalTenantKeys({
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      tenantId: 'academia-a',
    })).toEqual(['academia-a', DEFAULT_GLOBAL_OPERATIONAL_TENANT]);
  });

  test('SYSTEM nunca inclui o conhecimento global', () => {
    expect(resolveRetrievalTenantKeys({
      scope: { domain: 'SYSTEM', classifications: ['DEVELOPMENT'] },
      tenantId: 'academia-a',
    })).toEqual(['academia-a']);
  });

  test('sem tenant não há escopo (fail-closed)', () => {
    expect(resolveRetrievalTenantKeys({ scope: { domain: 'OPERATIONAL' }, tenantId: null })).toEqual([]);
    expect(resolveRetrievalTenantKeys({ scope: { domain: 'OPERATIONAL' }, tenantId: '  ' })).toEqual([]);
    expect(resolveRetrievalTenantKeys()).toEqual([]);
  });

  test('nunca inclui um segundo tenant', () => {
    const keys = resolveRetrievalTenantKeys({
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      tenantId: 'academia-a',
    });
    expect(keys).toHaveLength(2);
    expect(keys).not.toContain('academia-b');
  });

  test('tenant igual ao global não é duplicado', () => {
    expect(resolveRetrievalTenantKeys({
      scope: { domain: 'OPERATIONAL' },
      tenantId: DEFAULT_GLOBAL_OPERATIONAL_TENANT,
    })).toEqual([DEFAULT_GLOBAL_OPERATIONAL_TENANT]);
  });

  test('chave global é configurável por env', () => {
    process.env.RAG_GLOBAL_OPERATIONAL_TENANT = 'rap-global';
    expect(getGlobalOperationalTenant()).toBe('rap-global');
    expect(resolveRetrievalTenantKeys({
      scope: { domain: 'OPERATIONAL' },
      tenantId: 'academia-a',
    })).toEqual(['academia-a', 'rap-global']);
  });

  test('env vazia cai no default', () => {
    process.env.RAG_GLOBAL_OPERATIONAL_TENANT = '   ';
    expect(getGlobalOperationalTenant()).toBe(DEFAULT_GLOBAL_OPERATIONAL_TENANT);
  });
});
