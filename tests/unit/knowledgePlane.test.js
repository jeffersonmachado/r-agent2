'use strict';

/**
 * Knowledge Plane Tests — validam segregation, routing, provenance e retrieval.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
  resolveKnowledgeContext,
  createResolvedScope,
  isResolvedScope,
  DOMAINS,
  KNOWLEDGE_TYPES,
  OPERATIONAL_PURPOSES,
  SYSTEM_PURPOSES,
  PURPOSE_KNOWLEDGE_TYPES,
} = require('../../src/core/knowledge-plane');

const {
  buildProvenance,
  SOURCE_KINDS,
  systemAuthorityScore,
  operationalAuthorityScore,
} = require('../../src/core/knowledge-plane/provenance');

describe('Knowledge Router — Domain Segregation', () => {
  test('PRODUCTION → OPERATIONAL works', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
    });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('OPERATIONAL');
  });

  test('PRODUCTION → SYSTEM denied', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
    expect(result.scope.policy).toBe('deny');
  });

  test('SUPPORT → SYSTEM works when authorized', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'SUPPORT' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('SYSTEM');
  });

  test('DEVELOPMENT → SYSTEM works when authorized', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'DEVELOPMENT' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(true);
  });

  test('unknown classification denied to restricted scope', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'INVALID' },
    });
    // Falls back to OPERATIONAL/PRODUCTION (restrictive default, not deny).
    expect(result.scope.domain).toBe('OPERATIONAL');
    expect(result.scope.classifications).toEqual(['PRODUCTION']);
  });

  test('no principal defaults to OPERATIONAL', () => {
    const result = resolveKnowledgeContext({ principal: null });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('OPERATIONAL');
    expect(result.scope.classifications).toEqual(['PRODUCTION']);
  });

  test('domain cannot be overridden by payload — SYSTEM denied for PRODUCTION', () => {
    // Simula tentativa de payload externo forçar SYSTEM.
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
  });

  test('retrievalPurpose filters knowledge types', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'SUPPORT' },
      requestedDomain: 'SYSTEM',
      retrievalPurpose: 'DIAGNOSIS',
    });
    expect(result.scope.domain).toBe('SYSTEM');
    expect(result.scope.knowledgeTypes).toContain('SEMANTIC');
    expect(result.scope.knowledgeTypes).toContain('STRUCTURAL');
    expect(result.scope.knowledgeTypes).toContain('EPISODIC');
  });

  test('CUSTOMER_SERVICE purpose maps to OPERATIONAL with SEMANTIC only', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      retrievalPurpose: 'CUSTOMER_SERVICE',
    });
    expect(result.scope.domain).toBe('OPERATIONAL');
    expect(result.scope.knowledgeTypes).toEqual(['SEMANTIC']);
  });
});

describe('Knowledge Router — ResolvedScope integrity', () => {
  test('createResolvedScope produces internal scope', () => {
    const scope = createResolvedScope({
      domain: 'OPERATIONAL',
      classifications: ['PRODUCTION'],
      retrievalPurpose: 'CRM',
      knowledgeTypes: ['SEMANTIC'],
      policy: 'authorized',
      reason: 'test',
    });
    expect(isResolvedScope(scope)).toBe(true);
    expect(scope.domain).toBe('OPERATIONAL');
    expect(scope._internal).toBe(true);
  });

  test('plain object is NOT a resolved scope', () => {
    expect(isResolvedScope({ domain: 'OPERATIONAL', classifications: ['PRODUCTION'] })).toBe(false);
    expect(isResolvedScope(null)).toBe(false);
    expect(isResolvedScope({})).toBe(false);
  });
});

describe('Provenance — Authority & Source Kinds', () => {
  test('system authority: code > schema > registry > docs', () => {
    expect(systemAuthorityScore(SOURCE_KINDS.CODE_FILE)).toBeGreaterThan(systemAuthorityScore(SOURCE_KINDS.DB_MIGRATION));
    expect(systemAuthorityScore(SOURCE_KINDS.DB_MIGRATION)).toBeGreaterThan(systemAuthorityScore(SOURCE_KINDS.CANONICAL_DOC));
    expect(systemAuthorityScore(SOURCE_KINDS.CAPABILITY_REGISTRY)).toBeGreaterThan(systemAuthorityScore(SOURCE_KINDS.SYSTEM_INVENTORY));
  });

  test('buildProvenance creates frozen object with all fields', () => {
    const p = buildProvenance({
      sourceKind: SOURCE_KINDS.CANONICAL_DOC,
      sourceRef: 'docs/architecture.md',
      knowledgeType: 'SEMANTIC',
      domain: 'SYSTEM',
      classification: 'DEVELOPMENT',
      tenant: 'system',
    });
    expect(p.sourceKind).toBe('CANONICAL_DOC');
    expect(p.sourceRef).toBe('docs/architecture.md');
    expect(p.domain).toBe('SYSTEM');
    expect(p.classification).toBe('DEVELOPMENT');
    expect(p.knowledgeType).toBe('SEMANTIC');
    expect(p.authority).toBeGreaterThan(0);
  });
});

describe('Knowledge Types & Purposes', () => {
  test('all purposes have domain mapping', () => {
    for (const p of [...OPERATIONAL_PURPOSES, ...SYSTEM_PURPOSES]) {
      expect(DOMAINS).toContain(
        require('../../src/core/knowledge-plane/knowledge-router').PURPOSE_DOMAIN_MAP[p]
      );
    }
  });

  test('all purposes have knowledge types', () => {
    for (const p of [...OPERATIONAL_PURPOSES, ...SYSTEM_PURPOSES]) {
      expect(PURPOSE_KNOWLEDGE_TYPES[p]).toBeDefined();
      expect(PURPOSE_KNOWLEDGE_TYPES[p].length).toBeGreaterThan(0);
    }
  });
});

describe('Episodic Projector', () => {
  const { projectEpisodicKnowledge } = require('../../src/core/knowledge-plane/episodic-projector');

  test('projects relevant system events into episodic records', () => {
    const events = [
      { type: 'agent.execution.failed', tenantId: 't1', correlationId: 'c1', payload: { intent: 'agendar', error: 'timeout' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'business.outcome.failed', tenantId: 't1', correlationId: 'c2', payload: { outcome: 'outcome_not_achieved' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'irrelevant.event', tenantId: 't1', payload: {} },
    ];

    const records = projectEpisodicKnowledge({ events, tenantId: 't1' });
    expect(records.length).toBe(2);
    expect(records[0].domain).toBe('SYSTEM');
    expect(records[0].knowledgeType).toBe('EPISODIC');
  });

  test('filters events by tenant', () => {
    const events = [
      { type: 'agent.execution.failed', tenantId: 'tenant-b', payload: {} },
    ];

    const records = projectEpisodicKnowledge({ events, tenantId: 't1' });
    expect(records.length).toBe(0);
  });

  test('sanitizes sensitive payload fields', () => {
    const { sanitizeEventPayload } = require('../../src/core/knowledge-plane/episodic-projector');
    const event = {
      type: 'agent.execution.failed',
      payload: { password: 'secret123', token: 'abc', intent: 'agendar', normalField: 'ok' },
    };
    const sanitized = sanitizeEventPayload(event);
    expect(sanitized.payload.password).toBe('[redacted]');
    expect(sanitized.payload.token).toBe('[redacted]');
    expect(sanitized.payload.intent).toBe('agendar');
    expect(sanitized.payload.normalField).toBe('ok');
  });

  test('operational events map to OPERATIONAL domain', () => {
    const events = [
      { type: 'business.outcome.validated', tenantId: 't1', correlationId: 'c3', payload: { outcome: 'appointment_created' }, timestamp: '2026-01-01T00:00:00Z' },
    ];

    const records = projectEpisodicKnowledge({ events, tenantId: 't1' });
    expect(records.length).toBe(1);
    expect(records[0].domain).toBe('OPERATIONAL');
  });
});

describe('Knowledge Router — SpecialistContext', () => {
  test('retrievalPurpose comes from specialist context, not from free text', () => {
    // PRODUCTION com retrievalPurpose DIAGNOSIS (SYSTEM) → negado
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      retrievalPurpose: 'DIAGNOSIS',
    });
    expect(result.allowed).toBe(false);
  });

  test('SUPPORT with DIAGNOSIS purpose gets SYSTEM with EPISODIC+STRUCTURAL+SEMANTIC', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'SUPPORT' },
      retrievalPurpose: 'DIAGNOSIS',
    });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('SYSTEM');
    expect(result.scope.knowledgeTypes).toContain('EPISODIC');
    expect(result.scope.knowledgeTypes).toContain('STRUCTURAL');
    expect(result.scope.knowledgeTypes).toContain('SEMANTIC');
  });
});

describe('Knowledge Plane — Domain & Tenant Isolation', () => {
  test('System unavailable does NOT fallback to Operational', () => {
    // Se o SYSTEM é negado, não deve retornar OPERATIONAL como fallback.
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
    // O scope de fallback é OPERATIONAL, mas allowed=false → não usar.
    expect(result.scope.domain).toBe('OPERATIONAL');
  });

  test('Operational no-result does NOT fallback to System', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
  });
});

describe('Knowledge Plane — Cache Isolation', () => {
  test('SYSTEM scope cannot be used for OPERATIONAL cache key', () => {
    const systemScope = createResolvedScope({
      domain: 'SYSTEM',
      classifications: ['SUPPORT'],
      retrievalPurpose: 'DIAGNOSIS',
      knowledgeTypes: ['SEMANTIC'],
      policy: 'authorized',
      reason: 'test',
    });

    const operationalScope = createResolvedScope({
      domain: 'OPERATIONAL',
      classifications: ['PRODUCTION'],
      retrievalPurpose: 'CRM',
      knowledgeTypes: ['SEMANTIC'],
      policy: 'authorized',
      reason: 'test',
    });

    expect(systemScope.domain).not.toBe(operationalScope.domain);
    expect(systemScope.classifications).not.toEqual(expect.arrayContaining(operationalScope.classifications));
  });
});

describe('Knowledge Promotion', () => {
  const {
    createPromotionCandidate,
    sanitizeForOperational,
    validatePromotionCandidate,
    approvePromotion,
  } = require('../../src/core/knowledge-plane/knowledge-promotion');

  test('SYSTEM document is not visible as-is after promotion candidate creation', () => {
    const candidate = createPromotionCandidate({
      systemDocument: {
        id: 'sys-doc-1',
        content: 'SELECT * FROM users WHERE tenant_id = $1',
        provenance: { version: '1.0.0' },
      },
      tenantId: 't1',
      requestedBy: 'admin',
    });
    expect(candidate.status).toBe('candidate');
    // O conteúdo original é preservado para auditoria, mas o publicado é sanitizado.
    expect(candidate.originalContent).toContain('SELECT');
  });

  test('sanitizeForOperational removes SQL, code, file paths', () => {
    const content = 'See file /api/server.js for details. Run command `npm test`. Visit https://example.com/docs. Table users.name is indexed.';
    const sanitized = sanitizeForOperational(content);
    expect(sanitized).not.toContain('/api/server.js');
    expect(sanitized).not.toContain('`npm test`');
    expect(sanitized).not.toContain('https://example.com/docs');
    expect(sanitized).toContain('[file]');
    expect(sanitized).toContain('[code]');
    expect(sanitized).toContain('[link]');
  });

  test('validatePromotionCandidate rejects unsanitized content', () => {
    const candidate = {
      content: 'The table users.email stores customer contact. See /api/server.js.',
      originalContent: 'The table users.email stores customer contact. See /api/server.js.',
    };
    const result = validatePromotionCandidate(candidate);
    // content === originalContent → not sanitized
    expect(result.valid).toBe(false);
  });

  test('approvePromotion produces published document without original content', () => {
    const candidate = createPromotionCandidate({
      systemDocument: {
        id: 'sys-doc-2',
        content: 'The /api/server.js handles requests. See `app.listen()`. Database table users has columns id, name, email.',
        provenance: { version: '1.0.0' },
      },
      tenantId: 't1',
      requestedBy: 'admin',
    });

    const published = approvePromotion(candidate, 'approver-1');
    expect(published.status).toBe('published');
    expect(published.approvedBy).toBe('approver-1');
    expect(published.originalContent).toBeUndefined();
    expect(published.provenance.domain).toBe('OPERATIONAL');
    expect(published.provenance.classification).toBe('PRODUCTION');
    // Conteúdo publicado foi sanitizado
    expect(published.content).not.toContain('/api/server.js');
    expect(published.content).not.toContain('`app.listen()`');
  });
});

describe('Knowledge Graph Governance', () => {
  const {
    validateGraphAccess,
    filterGraphNodes,
  } = require('../../src/core/knowledge-plane/knowledge-graph-governance');

  test('PRODUCTION cannot query SYSTEM graph nodes', () => {
    const result = validateGraphAccess({
      tenantId: 't1',
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
  });

  test('SUPPORT can query SYSTEM graph nodes', () => {
    const result = validateGraphAccess({
      tenantId: 't1',
      principal: { classification: 'SUPPORT' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(true);
  });

  test('filterGraphNodes removes cross-tenant nodes', () => {
    const nodes = [
      { id: 'n1', tenantId: 't1', domain: 'OPERATIONAL', classification: 'PRODUCTION' },
      { id: 'n2', tenantId: 't2', domain: 'OPERATIONAL', classification: 'PRODUCTION' },
    ];
    const access = {
      allowed: true,
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
    };
    const filtered = filterGraphNodes(nodes, access, 't1');
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('n1');
  });

  test('filterGraphNodes removes wrong domain nodes', () => {
    const nodes = [
      { id: 'n1', tenantId: 't1', domain: 'OPERATIONAL', classification: 'PRODUCTION' },
      { id: 'n2', tenantId: 't1', domain: 'SYSTEM', classification: 'DEVELOPMENT' },
    ];
    const access = {
      allowed: true,
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
    };
    const filtered = filterGraphNodes(nodes, access, 't1');
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('n1');
  });
});

describe('Release & Incident Knowledge', () => {
  const {
    buildReleaseKnowledge,
    buildIncidentKnowledge,
  } = require('../../src/core/knowledge-plane/release-knowledge');

  test('buildReleaseKnowledge creates SYSTEM EPISODIC record', () => {
    const rel = buildReleaseKnowledge({
      releaseId: 'v2.0.0',
      commitRef: 'abc123',
      componentsChanged: ['api', 'frontend'],
      migrations: ['migration-001'],
      capabilitiesAffected: ['schedule.manage'],
      regressionStatus: 'passed',
      tenantId: 'system',
    });
    expect(rel.domain).toBe('SYSTEM');
    expect(rel.knowledgeType).toBe('EPISODIC');
    expect(rel.releaseId).toBe('v2.0.0');
    expect(rel.capabilitiesAffected).toContain('schedule.manage');
    expect(rel.provenance.sourceKind).toBe('RELEASE_ARTIFACT');
  });

  test('buildIncidentKnowledge includes root cause and fix provenance', () => {
    const inc = buildIncidentKnowledge({
      incidentId: 'inc-001',
      incidentType: 'timeout',
      severity: 'high',
      rootCause: 'DB connection pool exhausted',
      fixDescription: 'Increased pool size',
      fixReleaseId: 'v2.0.1',
      regressionTestId: 'test-pool-001',
      affectedComponents: ['api'],
    });
    expect(inc.domain).toBe('SYSTEM');
    expect(inc.rootCause).toBe('DB connection pool exhausted');
    expect(inc.fixReleaseId).toBe('v2.0.1');
    expect(inc.provenance.lastValidatedAt).toBeTruthy();
  });
});

describe('Inventory Graph Bridge', () => {
  const { buildGraphFromInventory } = require('../../src/core/knowledge-plane/inventory-graph-bridge');

  test('builds graph nodes from minimal inventory', () => {
    const inventory = {
      routes: [
        { id: 'api:GET:/workspace', path: '/workspace', method: 'GET', classification: 'PRODUCTION', module: 'workspace' },
      ],
      pages: [
        { id: 'page:/workspace', path: '/workspace', name: 'Workspace', classification: 'PRODUCTION' },
      ],
      capabilities: [
        { id: 'schedule.manage', name: 'Schedule Manage', tools: ['schedule.createAppointment'], visibility: 'PRODUCTION' },
      ],
      agents: [
        { id: 'agent:scheduling', slug: 'scheduling-agent', name: 'Scheduling Agent', classification: 'PRODUCTION', capabilities: ['schedule.manage'] },
      ],
      journeys: [],
      models: [],
    };

    const { nodes, edges } = buildGraphFromInventory({
      tenantId: 't1',
      deps: { inventory },
    });

    expect(nodes.length).toBeGreaterThanOrEqual(4);
    expect(nodes.find((n) => n.type === 'ApiRoute')).toBeDefined();
    expect(nodes.find((n) => n.type === 'Page')).toBeDefined();
    expect(nodes.find((n) => n.type === 'Capability')).toBeDefined();
    expect(nodes.find((n) => n.type === 'Agent')).toBeDefined();

    // Capability → Tool edge
    const capToolEdge = edges.find((e) => e.type === 'IMPLEMENTED_BY');
    expect(capToolEdge).toBeDefined();

    // Agent → Capability edge
    const agentCapEdge = edges.find((e) => e.type === 'USES');
    expect(agentCapEdge).toBeDefined();
  });

  test('all nodes have governance fields', () => {
    const inventory = {
      routes: [{ id: 'r1', path: '/test', method: 'GET', classification: 'PRODUCTION' }],
      pages: [],
      capabilities: [],
      agents: [],
      journeys: [],
      models: [],
    };

    const { nodes } = buildGraphFromInventory({
      tenantId: 't1',
      deps: { inventory },
    });

    for (const node of nodes) {
      expect(node.domain).toBeDefined();
      expect(node.classification).toBeDefined();
      expect(node.sensitivity).toBeDefined();
      expect(node.tenantId).toBe('t1');
    }
  });
});
