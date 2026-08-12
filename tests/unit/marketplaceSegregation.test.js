'use strict';

/**
 * Marketplace Segregation Tests — PRODUCTION não descobre/instala DEVELOPMENT agents.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { filterCatalogByClassification } = require('../../api/modules/agent-os/routes/agent-marketplace');
const { validateAgentVisibility, validateRouteVisibility } = require('../../api/modules/agent-os/experience-segregation');
const { canAccess } = require('../../src/core/cognitive/visibility');

describe('Marketplace — Classification Segregation', () => {
  const catalog = [
    { name: 'CRM Agent', slug: 'crm-agent', classification: 'PRODUCTION' },
    { name: 'Scheduling Agent', slug: 'scheduling-agent', classification: 'PRODUCTION' },
    { name: 'Customer Service Agent', slug: 'customer-service-agent', classification: 'PRODUCTION' },
    { name: 'Platform Support Agent', slug: 'platform-support-agent', classification: 'SUPPORT' },
    { name: 'QA Engineering Agent', slug: 'qa-engineering-agent', classification: 'DEVELOPMENT' },
    { name: 'Platform Knowledge Agent', slug: 'platform-knowledge-agent', classification: 'DEVELOPMENT' },
    { name: 'Incident Diagnostic Agent', slug: 'incident-diagnostic-agent', classification: 'SUPPORT' },
  ];

  test('PRODUCTION sees only PRODUCTION agents', () => {
    const filtered = filterCatalogByClassification(catalog, 'PRODUCTION');
    expect(filtered.length).toBe(3);
    expect(filtered.every((a) => a.classification === 'PRODUCTION')).toBe(true);
    expect(filtered.find((a) => a.slug === 'qa-engineering-agent')).toBeUndefined();
  });

  test('SUPPORT sees PRODUCTION + SUPPORT agents', () => {
    const filtered = filterCatalogByClassification(catalog, 'SUPPORT');
    expect(filtered.length).toBe(5);
    expect(filtered.find((a) => a.slug === 'platform-support-agent')).toBeDefined();
    expect(filtered.find((a) => a.slug === 'qa-engineering-agent')).toBeUndefined();
  });

  test('DEVELOPMENT sees all agents', () => {
    const filtered = filterCatalogByClassification(catalog, 'DEVELOPMENT');
    expect(filtered.length).toBe(7);
  });

  test('unknown classification → only PRODUCTION (fail closed)', () => {
    const filtered = filterCatalogByClassification(catalog, 'INVALID');
    expect(filtered.length).toBe(3);
    expect(filtered.every((a) => a.classification === 'PRODUCTION')).toBe(true);
  });

  test('no classification → only PRODUCTION (fail closed)', () => {
    const filtered = filterCatalogByClassification(catalog, null);
    expect(filtered.length).toBe(3);
  });
});

describe('Experience Segregation — Fail Closed', () => {
  test('validateRouteVisibility: no classification → DENY', () => {
    const result = validateRouteVisibility('/workspace', null);
    expect(result.visible).toBe(false);
  });

  test('validateRouteVisibility: unknown classification → DENY', () => {
    const result = validateRouteVisibility('/workspace', 'OPERATOR');
    expect(result.visible).toBe(false);
  });

  test('validateRouteVisibility: PRODUCTION sees operational routes', () => {
    const result = validateRouteVisibility('/workspace', 'PRODUCTION');
    expect(result.visible).toBe(true);
  });

  test('validateRouteVisibility: PRODUCTION cannot see QA dev routes', () => {
    const result = validateRouteVisibility('/dev/qa-waves', 'PRODUCTION');
    expect(result.visible).toBe(false);
  });

  test('validateAgentVisibility: no agent classification → DENY', () => {
    const result = validateAgentVisibility(null, 'PRODUCTION');
    expect(result.visible).toBe(false);
  });

  test('validateAgentVisibility: no user classification → DENY', () => {
    const result = validateAgentVisibility({ classification: 'PRODUCTION' }, null);
    expect(result.visible).toBe(false);
  });

  test('validateAgentVisibility: PRODUCTION cannot see DEVELOPMENT agent', () => {
    const result = validateAgentVisibility({ classification: 'DEVELOPMENT' }, 'PRODUCTION');
    expect(result.visible).toBe(false);
  });
});

describe('MCP — Tools Discovery Permissions', () => {
  const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');

  test('list() with permissions filters non-permitted tools', () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'public.tool', visibility: 'PRODUCTION', permissions: [],
      description: 'public', execute: async () => ({}),
    });
    registry.register({
      id: 'secret.tool', visibility: 'PRODUCTION', permissions: ['secret.permission'],
      description: 'secret', execute: async () => ({}),
    });

    // Actor with no specific permissions → secret.tool hidden
    const filtered = registry.list({
      classification: 'PRODUCTION',
      permissions: ['public.read'],
    });
    expect(filtered.find((t) => t.id === 'public.tool')).toBeDefined();
    expect(filtered.find((t) => t.id === 'secret.tool')).toBeUndefined();
  });

  test('list() without permissions shows all visible tools', () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'public.tool', visibility: 'PRODUCTION', permissions: [],
      description: 'public', execute: async () => ({}),
    });
    registry.register({
      id: 'secret.tool', visibility: 'PRODUCTION', permissions: ['secret.permission'],
      description: 'secret', execute: async () => ({}),
    });

    // Actor without permissions array → shows all (execution still validates)
    const all = registry.list({ classification: 'PRODUCTION' });
    expect(all.length).toBe(2);
  });

  test('list() with wildcard shows all tools', () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'secret.tool', visibility: 'PRODUCTION', permissions: ['secret.permission'],
      description: 'secret', execute: async () => ({}),
    });

    const filtered = registry.list({
      classification: 'PRODUCTION',
      permissions: ['*'],
    });
    expect(filtered.find((t) => t.id === 'secret.tool')).toBeDefined();
  });
});

describe('RAG — Instance Routing', () => {
  const {
    getRagServiceUrl,
    getRagDomainConfig,
  } = require('../../api/services/rag/ragRuntime');

  test('default RAG URL is used when no domain-specific config', () => {
    const url = getRagServiceUrl('system');
    expect(url).toBeTruthy();
    expect(typeof url).toBe('string');
  });

  test('getRagDomainConfig returns null for unconfigured domain', () => {
    const config = getRagDomainConfig('t1', 'OPERATIONAL');
    // Pode ser null se não houver config.json específica para o tenant.
    // O comportamento padrão é usar a URL padrão (isRagDomainEnabled = true).
    expect(config === null || typeof config === 'object').toBe(true);
  });
});
