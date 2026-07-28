'use strict';

/**
 * Regressão (2 bugs no módulo ai-governance):
 *
 * 1. compliance-report Set→{}: generateComplianceReport montava
 *    summary.dataAccessed como Set e o espalhava no payload; JSON.stringify
 *    serializa Set como {} — o relatório publicado perdia a lista de dados
 *    acessados (ficava um objeto vazio silencioso).
 *
 * 2. actor:null em governance events: o handler POST /api/ai-governance/event
 *    derivava o ator de req.user?.username, mas requireAuth popula req.agent
 *    (nunca req.user) — eventos sem actor explícito no body eram persistidos
 *    com actor null, quebrando a trilha de auditoria.
 */

jest.mock('../../api/db/models/AiGovernanceRecord', () => {
  const singleton = { findAll: null, create: null };
  const factory = () => singleton;
  factory.EVENT_TYPES = ['decision', 'execute', 'access'];
  factory.__singleton = singleton;
  return factory;
});

const getAiGovernanceRecordModel = require('../../api/db/models/AiGovernanceRecord');
const service = require('../../api/modules/ai-governance/service');
const { handleAiGovernanceRoutes } = require('../../api/modules/agent-os/routes/ai-governance');

describe('generateComplianceReport — serialização do summary', () => {
  it('dataAccessed é array determinístico (nunca Set serializado como {})', async () => {
    const Model = getAiGovernanceRecordModel.__singleton;
    Model.findAll = async () => ([
      { eventType: 'access', riskLevel: 'low', cost: 1, agentId: 'ag-1', dataAccessed: ['crm.contacts', 'tickets'] },
      { eventType: 'decision', riskLevel: 'high', cost: 2, agentId: 'ag-1', dataAccessed: ['crm.contacts'] },
    ]);

    const report = await service.generateComplianceReport({ tenantId: 'tenant-a' });

    expect(Array.isArray(report.summary.dataAccessed)).toBe(true);
    expect(report.summary.dataAccessed).toEqual(['crm.contacts', 'tickets']);
    expect(report.summary.dataAccessedCount).toBe(2);
    expect(report.summary.agentsInvolved).toBe(1);

    const serialized = JSON.stringify(report.summary);
    expect(serialized).not.toContain('"dataAccessed":{}');
    expect(serialized).toContain('crm.contacts');
  });
});

describe('POST /api/ai-governance/event — ator derivado do agente autenticado', () => {
  function makeCtx(body, agent) {
    const res = { statusCode: null, body: null };
    return {
      req: { tenant_id: 'tenant-a', query: {}, agent },
      res,
      method: 'POST',
      pathname: '/api/ai-governance/event',
      deps: {
        requireAuth: () => ({ valid: true }),
        requirePermission: () => ({ allowed: true }),
        sendJson: (r, c, d) => { res.statusCode = c; res.body = d; },
        badRequest: (r, m) => { res.statusCode = 400; res.body = { error: m }; },
        hasJsonContentType: () => true,
        parseJsonBody: async () => body,
        logAction: async () => {},
      },
    };
  }

  it('sem actor no body, persiste actor do req.agent (não null)', async () => {
    const Model = getAiGovernanceRecordModel.__singleton;
    let persisted = null;
    Model.create = async (payload) => { persisted = payload; return payload; };

    const ctx = makeCtx(
      { eventType: 'decision', agentId: 'ag-1', description: 'decidiu X' },
      { username: 'jdoe', role: 'admin' },
    );
    await handleAiGovernanceRoutes(ctx);

    // Nota: este handler responde sem `return true` (contrato existente do
    // módulo — o dispatcher verifica a resposta escrita, não o retorno).
    expect(ctx.res.statusCode).toBe(201);
    expect(persisted).not.toBeNull();
    expect(persisted.actor).toBe('jdoe');
    expect(persisted.actorRole).toBe('admin');
  });

  it('actor explícito no body prevalece sobre o agente autenticado', async () => {
    const Model = getAiGovernanceRecordModel.__singleton;
    let persisted = null;
    Model.create = async (payload) => { persisted = payload; return payload; };

    const ctx = makeCtx(
      { eventType: 'execute', agentId: 'ag-1', actor: 'system-bot', actorRole: 'system' },
      { username: 'jdoe', role: 'admin' },
    );
    await handleAiGovernanceRoutes(ctx);

    expect(persisted.actor).toBe('system-bot');
  });
});
