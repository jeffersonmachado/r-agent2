'use strict';

const makeModel = (methods) => () => methods;

const { sanitizeTimelineEvents } = require('../../api/services/workspace/timelineSanitization');

function buildTimelineServiceMocks() {
  const evidenceRow = {
    id: 'ev-1',
    tenant_key: 'tenant-1',
    source_type: 'qa_wave',
    summary: 'Falha QA/RPA no replay do fluxo',
    occurred_at: new Date('2026-04-01T11:00:00Z'),
    metadata: {
      patch: { file: 'flow.js' },
      diff: 'diff --git a/flow.js b/flow.js',
      testsToRun: ['flow.test.js'],
      filesToChange: ['flow.js'],
      actionChain: ['click', 'type'],
      engine: 'rpa',
      step: 3,
    },
    source_ref: { replayUrl: '/dev/rpa-replays?evidenceId=ev-1' },
  };
  const conversationRow = {
    id: 'conv-1',
    channel_type: 'whatsapp',
    status: 'open',
    last_message_at: new Date('2026-04-01T10:00:00Z'),
    created_at: new Date('2026-04-01T09:00:00Z'),
  };
  const ticketRow = {
    id: 'ticket-1',
    channel_type: 'whatsapp',
    status: 'open',
    queue: 'support',
    created_at: new Date('2026-04-01T10:30:00Z'),
  };

  jest.doMock('../../api/db/models', () => ({
    WorkspaceEntity: makeModel({ findOne: jest.fn().mockResolvedValue({ id: 'entity-1', tenant_id: 'tenant-1' }) }),
    WorkspaceEntityLink: makeModel({
      findAll: jest.fn().mockResolvedValue([
        { source_type: 'evidence', source_id: 'ev-1', confidence: 0.98 },
        { source_type: 'conversation', source_id: 'conv-1', confidence: 1 },
        { source_type: 'ticket', source_id: 'ticket-1', confidence: 1 },
      ]),
    }),
    WorkspaceTimelineEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    Evidence: makeModel({ findAll: jest.fn().mockResolvedValue([evidenceRow]) }),
    ChannelConversation: makeModel({ findAll: jest.fn().mockResolvedValue([conversationRow]) }),
    ChannelMessage: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    Ticket: makeModel({ findAll: jest.fn().mockResolvedValue([ticketRow]) }),
    Schedule: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    Project: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    ProjectItem: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    RagDocument: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    MarketingLead: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    Task: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    PaymentEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    Tenant: makeModel({ findOne: jest.fn().mockResolvedValue(null) }),
  }));

  const WorkspaceTimelineService = require('../../api/services/workspace/WorkspaceTimelineService');
  return new WorkspaceTimelineService({ logger: { warn: jest.fn() } });
}

describe('workspace API experience segregation (timeline)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('PRODUCTION receives allowlisted events with zero engineering leakage', async () => {
    const service = buildTimelineServiceMocks();
    const timeline = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1', classification: 'PRODUCTION' });
    const raw = JSON.stringify(timeline);

    ['QA/RPA', 'replay', 'patch', 'diff', 'testsToRun', 'filesToChange', 'evidenceId', '/dev/', 'actionChain', 'step'].forEach((token) => {
      expect(raw).not.toContain(token);
    });

    const incident = timeline.items.find((item) => item.id === 'evidence:ev-1');
    expect(incident).toEqual({
      id: 'evidence:ev-1',
      type: 'operational_incident',
      source: 'operação',
      createdAt: expect.any(String),
      summary: 'Instabilidade detectada e recuperada',
      detailUrl: null,
    });

    const conversation = timeline.items.find((item) => item.type === 'conversation');
    expect(conversation).toEqual(expect.objectContaining({
      type: 'conversation',
      summary: 'Conversa open em whatsapp',
      detailUrl: '/inbox?conversationId=conv-1',
    }));
    expect(conversation.payload).toBeUndefined();
    expect(conversation.refId).toBeUndefined();
    expect(conversation.confidence).toBeUndefined();

    const ticket = timeline.items.find((item) => item.type === 'ticket');
    expect(ticket).toEqual(expect.objectContaining({
      type: 'ticket',
      detailUrl: '/support?ticketId=ticket-1',
    }));
    expect(ticket.payload).toBeUndefined();
  });

  it('SUPPORT receives diagnostic view without engineering internals', async () => {
    const service = buildTimelineServiceMocks();
    const timeline = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1', classification: 'SUPPORT' });
    const raw = JSON.stringify(timeline);

    ['patch', 'diff', 'testsToRun', 'filesToChange', 'actionChain'].forEach((token) => {
      expect(raw).not.toContain(token);
    });
    expect(raw).not.toContain('/dev/');
    // Narrativa de engenharia não vaza nem como texto livre do summary/source
    expect(raw).not.toContain('QA/RPA');
    expect(raw).not.toContain('qa_wave');

    const evidence = timeline.items.find((item) => item.id === 'evidence:ev-1');
    expect(evidence).toEqual(expect.objectContaining({
      type: 'evidence',
      source: 'diagnóstico',
      summary: 'Evento técnico diagnosticado — evidência disponível para investigação',
      refId: 'ev-1',
      detailUrl: '/rpa-replays?evidenceId=ev-1',
    }));
    expect(evidence.payload).toBeUndefined();

    const conversation = timeline.items.find((item) => item.type === 'conversation');
    expect(conversation.detailUrl).toBe('/inbox?conversationId=conv-1');
    expect(conversation.payload).toEqual({ status: 'open' });
  });

  it('DEVELOPMENT receives the full untouched payload', async () => {
    const service = buildTimelineServiceMocks();
    const timeline = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1', classification: 'DEVELOPMENT' });

    const evidence = timeline.items.find((item) => item.id === 'evidence:ev-1');
    expect(evidence.type).toBe('evidence');
    expect(evidence.source).toBe('qa_wave');
    expect(evidence.refId).toBe('ev-1');
    expect(evidence.detailUrl).toBe('/dev/rpa-replays?evidenceId=ev-1');
    expect(evidence.payload.metadata).toEqual(expect.objectContaining({
      patch: { file: 'flow.js' },
      testsToRun: ['flow.test.js'],
      filesToChange: ['flow.js'],
      actionChain: ['click', 'type'],
      engine: 'rpa',
      step: 3,
    }));
    expect(evidence.payload.replayUrl).toBe('/dev/rpa-replays?evidenceId=ev-1');
  });

  it('fails closed to PRODUCTION when classification is missing or unknown', async () => {
    const service = buildTimelineServiceMocks();
    const missing = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(JSON.stringify(missing)).not.toContain('QA/RPA');
    expect(missing.items.find((item) => item.id === 'evidence:ev-1').type).toBe('operational_incident');

    const unknown = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1', classification: 'SUPERUSER' });
    expect(unknown.items.find((item) => item.id === 'evidence:ev-1').type).toBe('operational_incident');
  });

  it('keeps internal service-to-service reads raw for insights and autocorrection', async () => {
    const service = buildTimelineServiceMocks();
    const timeline = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1', internal: true });
    const evidence = timeline.items.find((item) => item.id === 'evidence:ev-1');
    expect(evidence.type).toBe('evidence');
    expect(evidence.payload.metadata.patch).toEqual({ file: 'flow.js' });
  });
});

describe('sanitizeTimelineEvents unit matrix', () => {
  it('treats non-evidence events with engineering payload keys as technical', () => {
    const [sanitized] = sanitizeTimelineEvents([
      { id: 'task:1', type: 'task', source: 'task', createdAt: '2026-04-01T00:00:00.000Z', summary: 'Tarefa: deploy', payload: { patch: {}, filesToChange: ['a.js'] }, detailUrl: '/tasks?taskId=1' },
    ], 'PRODUCTION');
    expect(sanitized).toEqual({
      id: 'task:1',
      type: 'operational_incident',
      source: 'operação',
      createdAt: '2026-04-01T00:00:00.000Z',
      summary: 'Instabilidade detectada e recuperada',
      detailUrl: null,
    });
  });

  it('SUPPORT keeps only the diagnostic payload subset', () => {
    const [sanitized] = sanitizeTimelineEvents([
      {
        id: 'evidence:ev-9',
        type: 'evidence',
        source: 'qa_wave',
        refId: 'ev-9',
        createdAt: '2026-04-01T00:00:00.000Z',
        summary: 'Falha detectada',
        detailUrl: '/dev/rpa-replays?evidenceId=ev-9',
        payload: { affectedService: 'inbox', health: 'degraded', patch: {}, engine: 'rpa', step: 2 },
      },
    ], 'SUPPORT');
    expect(sanitized.payload).toEqual({ affectedService: 'inbox', health: 'degraded' });
    expect(sanitized.detailUrl).toBe('/rpa-replays?evidenceId=ev-9');
    expect(sanitized.refId).toBe('ev-9');
    // fonte técnica vira rótulo diagnóstico; summary benigno é preservado
    expect(sanitized.source).toBe('diagnóstico');
    expect(sanitized.summary).toBe('Falha detectada');
  });

  it('SUPPORT replaces engineering narrative summaries with diagnostic fallback', () => {
    const [sanitized] = sanitizeTimelineEvents([
      {
        id: 'evidence:ev-10',
        type: 'evidence',
        source: 'QA/RPA',
        refId: 'ev-10',
        createdAt: '2026-04-01T00:00:00.000Z',
        summary: 'RPA Step 17 falhou — patch proposto',
        detailUrl: '/dev/rpa-replays?id=ev-10',
        payload: { patch: 'diff --git a/x', testsToRun: ['unit/x'], filesToChange: ['api/x.js'], actionChain: ['step1'], engine: 'replay' },
      },
    ], 'SUPPORT');
    const raw = JSON.stringify(sanitized);
    ['patch', 'diff', 'testsToRun', 'filesToChange', 'actionChain', 'QA/RPA', 'RPA Step', 'engine', '/dev/'].forEach((token) => {
      expect(raw).not.toContain(token);
    });
    expect(sanitized.summary).toBe('Evento técnico diagnosticado — evidência disponível para investigação');
    expect(sanitized.source).toBe('diagnóstico');
    expect(sanitized.detailUrl).toBe('/rpa-replays?id=ev-10');
    expect(sanitized.payload).toBeUndefined();
  });

  it('PRODUCTION drops non-dev detailUrls that point to engineering surfaces', () => {
    const [sanitized] = sanitizeTimelineEvents([
      { id: 'document:1', type: 'document', source: 'rag', createdAt: '2026-04-01T00:00:00.000Z', summary: 'Documento', payload: {}, detailUrl: '/qa-waves?runId=1' },
    ], 'PRODUCTION');
    expect(sanitized.detailUrl).toBeUndefined();
    expect(sanitized.source).toBe('documentos');
  });

  it('PRODUCTION replaces jargon summaries on otherwise operational events', () => {
    const [sanitized] = sanitizeTimelineEvents([
      { id: 'message:1', type: 'message', source: 'whatsapp', createdAt: '2026-04-01T00:00:00.000Z', summary: 'Falha no replay evidenciada', payload: {}, detailUrl: '/inbox?conversationId=c1' },
    ], 'PRODUCTION');
    expect(sanitized.summary).toBe('Instabilidade detectada e recuperada');
    expect(sanitized.detailUrl).toBe('/inbox?conversationId=c1');
  });
});
