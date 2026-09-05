'use strict';

const makeModel = (methods) => () => methods;

describe('workspace production core services', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('builds timeline from WorkspaceEntityLink instead of heuristic matching', async () => {
    const links = [
      { source_type: 'message', source_id: 'msg-1', confidence: 0.95 },
      { source_type: 'ticket', source_id: 'ticket-1', confidence: 1 },
    ];
    const messageFindAll = jest.fn().mockResolvedValue([{ id: 'msg-1', channel_type: 'whatsapp', direction: 'inbound', body: { text: 'Oi' }, conversation_id: 'conv-1', created_at: new Date('2026-04-01T10:00:00Z') }]);
    const ticketFindAll = jest.fn().mockResolvedValue([{ id: 'ticket-1', channel_type: 'whatsapp', status: 'open', queue: 'support', created_at: new Date('2026-04-01T11:00:00Z') }]);

    jest.doMock('../../db/models', () => ({
      WorkspaceEntity: makeModel({ findOne: jest.fn().mockResolvedValue({ id: 'entity-1', tenant_id: 'tenant-1' }) }),
      WorkspaceEntityLink: makeModel({ findAll: jest.fn().mockResolvedValue(links) }),
      WorkspaceTimelineEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      ChannelMessage: makeModel({ findAll: messageFindAll }),
      Ticket: makeModel({ findAll: ticketFindAll }),
      ChannelConversation: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Schedule: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Project: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      ProjectItem: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      RagDocument: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Evidence: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      MarketingLead: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Task: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      PaymentEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
    }));

    const WorkspaceTimelineService = require('../workspace/WorkspaceTimelineService');
    const service = new WorkspaceTimelineService({ logger: { warn: jest.fn() } });
    const timeline = await service.getEntityTimeline({ tenantId: 'tenant-1', entityId: 'entity-1' });

    expect(timeline.items.map((item) => item.type).sort()).toEqual(['message', 'ticket']);
    expect(messageFindAll).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: expect.any(Object) }) }));
    expect(ticketFindAll).toHaveBeenCalled();
  });

  it('creates real workspace task and links it to the entity', async () => {
    const createTask = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'task-1', entity_id: 'entity-1', title: 'Follow-up' }) });
    const linkEntity = jest.fn().mockResolvedValue({ id: 'link-1' });
    jest.doMock('../../db/models', () => ({
      Task: makeModel({ create: createTask }),
      TimesheetEntry: makeModel({}),
      Resource: makeModel({}),
      ResourceAvailability: makeModel({}),
      ResourceBooking: makeModel({}),
      PaymentEvent: makeModel({}),
      WorkspaceEntity: makeModel({}),
      WorkspaceEntityLink: makeModel({}),
      MarketingLead: makeModel({}),
      ChannelConversation: makeModel({}),
      Ticket: makeModel({}),
    }));

    const WorkspaceOperationsService = require('../workspace/WorkspaceOperationsService');
    const service = new WorkspaceOperationsService({ entityService: { linkEntity } });
    const task = await service.createTask({ tenantId: 'tenant-1', payload: { entityId: 'entity-1', title: 'Follow-up', type: 'ai' } });

    expect(task.id).toBe('task-1');
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant-1', entity_id: 'entity-1', type: 'ai' }));
    expect(linkEntity).toHaveBeenCalledWith({ tenantId: 'tenant-1', entityId: 'entity-1', sourceType: 'task', sourceId: 'task-1', confidence: 1 });
  });

  it('creates autocorrection run and review action from failed QA/RPA evidence', async () => {
    const workspaceInsightFindOne = jest.fn().mockResolvedValue(null);
    const workspaceInsightCreate = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'insight-1' }) });
    const workspaceActionFindOne = jest.fn().mockResolvedValue(null);
    const workspaceActionCreate = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'action-1' }) });
    const linkFindOrCreate = jest.fn().mockResolvedValue([{ toJSON: () => ({ id: 'link-1' }) }, true]);
    const autoRunFindOne = jest.fn().mockResolvedValue(null);
    const autoRunCreate = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'run-1', source_type: 'evidence', source_id: 'ev-1', status: 'awaiting_human_approval' }) });
    const autoActionCreate = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'auto-action-1' }) });

    jest.doMock('../../db/models', () => ({
      WorkspaceEntity: makeModel({ findOne: jest.fn().mockResolvedValue({ id: 'entity-1', tenant_id: 'tenant-1' }) }),
      WorkspaceEntityLink: makeModel({
        findAll: jest.fn().mockResolvedValue([{ source_type: 'evidence', source_id: 'ev-1', confidence: 0.98 }]),
        findOrCreate: linkFindOrCreate,
      }),
      WorkspaceTimelineEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Evidence: makeModel({
        findAll: jest.fn().mockResolvedValue([{ id: 'ev-1', tenant_key: 'tenant-1', source_type: 'qa_wave', summary: 'Falha no replay', occurred_at: new Date('2026-04-01T11:00:00Z'), metadata: { module: 'workspace' }, source_ref: {} }]),
        findOne: jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'ev-1', tenant_key: 'tenant-1', source_type: 'qa_wave', summary: 'Falha no replay', metadata: { module: 'workspace' }, source_ref: {} }) }),
      }),
      ChannelConversation: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      ChannelMessage: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Ticket: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Schedule: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Project: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      ProjectItem: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      RagDocument: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      MarketingLead: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Task: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      PaymentEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      Tenant: makeModel({ findOne: jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'tenant-uuid' }) }) }),
      WorkspaceInsight: makeModel({ findAll: jest.fn().mockResolvedValue([]), findOne: workspaceInsightFindOne, create: workspaceInsightCreate }),
      WorkspaceAction: makeModel({ findAll: jest.fn().mockResolvedValue([]), findOne: workspaceActionFindOne, create: workspaceActionCreate }),
      AutoCorrectionRun: makeModel({ findOne: autoRunFindOne, create: autoRunCreate, findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ id: 'run-1', source_type: 'evidence', source_id: 'ev-1', status: 'awaiting_human_approval' }) }]) }),
      AutoCorrectionAction: makeModel({ create: autoActionCreate, findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ id: 'auto-action-1', run_id: 'run-1', type: 'human_review', status: 'pending' }) }]) }),
    }));

    const { createWorkspaceService } = require('../../modules/workspace/workspace.service');
    const workspaceService = createWorkspaceService({
      correctionValidationService: { validateProposal: jest.fn().mockResolvedValue({ status: 'pending_manual_execution', steps: [] }) },
    });

    const result = await workspaceService.getAutoCorrections('tenant-1', 'entity-1');

    expect(autoRunCreate).toHaveBeenCalled();
    expect(workspaceInsightCreate).toHaveBeenCalled();
    expect(workspaceActionCreate).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ title: 'Correção técnica sugerida' }) }));
    expect(linkFindOrCreate).toHaveBeenCalledWith(expect.objectContaining({ defaults: expect.objectContaining({ source_type: 'autocorrection_run' }) }));
    expect(result.items[0].id).toBe('run-1');
  });

  it('attaches batched summary with counts and riskLevel to entity listing', async () => {
    const entities = [
      { id: 'entity-a', tenant_id: 'tenant-1', name: 'Cliente A' },
      { id: 'entity-b', tenant_id: 'tenant-1', name: 'Cliente B' },
      { id: 'entity-c', tenant_id: 'tenant-1', name: 'Cliente C' },
    ];
    jest.doMock('../../db/models', () => ({
      WorkspaceEntity: makeModel({ findAndCountAll: jest.fn().mockResolvedValue({ rows: entities, count: 3 }) }),
      WorkspaceEntityLink: makeModel({
        findAll: jest.fn().mockResolvedValue([
          { entity_id: 'entity-a', source_type: 'ticket', source_id: 'ticket-1' },
          { entity_id: 'entity-a', source_type: 'ticket', source_id: 'ticket-2' },
          { entity_id: 'entity-b', source_type: 'ticket', source_id: 'ticket-3' },
        ]),
      }),
      Ticket: makeModel({
        findAll: jest.fn().mockResolvedValue([{ id: 'ticket-1' }, { id: 'ticket-2' }]),
      }),
      WorkspaceAction: makeModel({
        findAll: jest.fn().mockResolvedValue([{ entity_id: 'entity-b', count: '3' }]),
      }),
      PaymentEvent: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      WorkspaceInsight: makeModel({ findAll: jest.fn().mockResolvedValue([]) }),
      WorkspaceTimelineEvent: makeModel({
        findAll: jest.fn().mockResolvedValue([{ entity_id: 'entity-a', last_at: '2026-08-01T10:00:00.000Z' }]),
      }),
      MarketingLead: makeModel({}),
      ChannelConversation: makeModel({}),
    }));

    const WorkspaceEntityService = require('../workspace/WorkspaceEntityService');
    const service = new WorkspaceEntityService({ logger: { warn: jest.fn() } });
    const result = await service.listEntities({ tenantId: 'tenant-1' });

    expect(result.total).toBe(3);
    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));
    expect(byId['entity-a'].summary).toEqual({
      openTickets: 2,
      pendingActions: 0,
      pendingPayments: 0,
      riskLevel: 'critical',
      lastInteractionAt: '2026-08-01T10:00:00.000Z',
    });
    expect(byId['entity-b'].summary).toEqual({
      openTickets: 0,
      pendingActions: 3,
      pendingPayments: 0,
      riskLevel: 'attention',
      lastInteractionAt: null,
    });
    expect(byId['entity-c'].summary).toEqual({
      openTickets: 0,
      pendingActions: 0,
      pendingPayments: 0,
      riskLevel: 'none',
      lastInteractionAt: null,
    });
  });

  it('hides QA/RPA technical insights for PRODUCTION and keeps them persisted for DEVELOPMENT', async () => {
    const insightFindAll = jest.fn().mockResolvedValue([{ id: 'persisted-1', type: 'risk', source: 'RPA', description: 'Falha QA/RPA' }]);
    const insightCreate = jest.fn().mockImplementation(async (data) => ({ toJSON: () => ({ id: 'new-1', ...data }) }));
    jest.doMock('../../db/models', () => ({
      WorkspaceInsight: makeModel({ findAll: insightFindAll, findOne: jest.fn().mockResolvedValue(null), create: insightCreate }),
      WorkspaceEntity: makeModel({}),
      WorkspaceEntityLink: makeModel({}),
      WorkspaceTimelineEvent: makeModel({}),
      Ticket: makeModel({}),
      ChannelConversation: makeModel({}),
      ChannelMessage: makeModel({}),
      Schedule: makeModel({}),
      Project: makeModel({}),
      ProjectItem: makeModel({}),
      RagDocument: makeModel({}),
      Evidence: makeModel({}),
      MarketingLead: makeModel({}),
      Task: makeModel({}),
      PaymentEvent: makeModel({}),
      Tenant: makeModel({}),
    }));

    const WorkspaceInsightService = require('../workspace/WorkspaceInsightService');
    const timeline = {
      items: [
        { type: 'evidence', summary: 'Falha no replay do fluxo', payload: { type: 'failure' }, refId: 'ev-1', createdAt: new Date().toISOString() },
      ],
    };
    const buildService = () => new WorkspaceInsightService({
      timelineService: { getEntityTimeline: jest.fn().mockResolvedValue(timeline) },
      nlpService: { analyzeText: jest.fn().mockResolvedValue({}) },
      logger: { warn: jest.fn() },
    });

    const production = await buildService().generateInsights('entity-1', { tenantId: 'tenant-1' });
    expect(production.items).toEqual([]);
    expect(production.persisted).toEqual([]);
    expect(insightCreate).toHaveBeenCalled();

    const support = await buildService().generateInsights('entity-1', { tenantId: 'tenant-1', includeTechnical: false });
    expect(support.items).toEqual([]);

    const development = await buildService().generateInsights('entity-1', { tenantId: 'tenant-1', includeTechnical: true });
    expect(development.items).toHaveLength(1);
    expect(development.items[0]).toEqual(expect.objectContaining({ type: 'risk', source: 'RPA', severity: 'critical' }));
    expect(development.persisted).toHaveLength(2);
  });

  it('suggests next best action with outcome, risk and executable action descriptor', async () => {
    jest.doMock('../../db/models', () => ({
      WorkspaceAction: makeModel({}),
      WorkspaceEntityLink: makeModel({
        findOne: jest.fn().mockResolvedValue({ toJSON: () => ({ source_id: 'conv-9' }) }),
      }),
      WorkspaceInsight: makeModel({}),
      WorkspaceEntity: makeModel({}),
      WorkspaceTimelineEvent: makeModel({}),
      Ticket: makeModel({}),
      ChannelConversation: makeModel({}),
      ChannelMessage: makeModel({}),
      Schedule: makeModel({}),
      Project: makeModel({}),
      ProjectItem: makeModel({}),
      RagDocument: makeModel({}),
      Evidence: makeModel({}),
      MarketingLead: makeModel({}),
      Task: makeModel({}),
      PaymentEvent: makeModel({}),
      Tenant: makeModel({}),
    }));

    const WorkspaceActionService = require('../workspace/WorkspaceActionService');
    const buildService = (insights) => {
      const generateInsights = jest.fn().mockResolvedValue({ items: insights });
      const service = new WorkspaceActionService({
        insightService: { generateInsights },
        operationsService: {},
        logger: { warn: jest.fn() },
      });
      return { service, generateInsights };
    };

    const { service: delayService } = buildService([{ type: 'delay', severity: 'high', confidence: 0.86, source: 'system' }]);
    const delay = await delayService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(delay).toEqual(expect.objectContaining({
      type: 'task',
      label: 'Criar tarefa de resposta SLA',
      expectedOutcome: 'Restabelecer o SLA e evitar escalacao',
      risk: 'medium',
    }));
    expect(delay.action).toEqual({ kind: 'create_task', conversationId: null, label: 'Criar tarefa de resposta' });

    const { service: riskService } = buildService([{ type: 'risk', severity: 'high', confidence: 0.9, source: 'system' }]);
    const risk = await riskService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(risk).toEqual(expect.objectContaining({ risk: 'medium', expectedOutcome: 'Reduzir o risco operacional e preservar o relacionamento' }));
    expect(risk.action).toEqual({ kind: 'send_message', conversationId: 'conv-9', label: 'Enviar mensagem ao cliente' });

    const { service: churnService } = buildService([{ type: 'churn', severity: 'high', confidence: 0.78, source: 'system' }]);
    const churn = await churnService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(churn).toEqual(expect.objectContaining({ type: 'followup', risk: 'low', expectedOutcome: 'Recuperar o relacionamento e evitar churn' }));
    expect(churn.action).toEqual({ kind: 'send_message', conversationId: 'conv-9', label: 'Enviar mensagem de reativacao' });

    const { service: upsellService } = buildService([{ type: 'upsell', severity: 'medium', confidence: 0.66, source: 'system' }]);
    const upsell = await upsellService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(upsell).toEqual(expect.objectContaining({ risk: 'low', expectedOutcome: 'Expandir o relacionamento com uma nova oferta' }));
    expect(upsell.action).toEqual({ kind: 'send_message', conversationId: 'conv-9', label: 'Enviar proposta de expansao' });

    const { service: fallbackService } = buildService([]);
    const fallback = await fallbackService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(fallback).toEqual(expect.objectContaining({
      type: 'followup',
      label: 'Registrar proximo contato',
      reason: 'Nao ha riscos criticos detectados; manter cadencia de relacionamento.',
      confidence: 0.55,
      risk: 'low',
    }));
    expect(fallback.action).toEqual({ kind: 'schedule', conversationId: null, label: 'Agendar proximo contato' });

    const { service: devService, generateInsights: devGenerate } = buildService([{ type: 'risk', severity: 'critical', source: 'RPA' }]);
    const technical = await devService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1', classification: 'DEVELOPMENT' });
    expect(devGenerate).toHaveBeenCalledWith('entity-1', expect.objectContaining({ includeTechnical: true }));
    expect(technical.action.kind).toBe('create_task');
    expect(technical.risk).toBe('high');

    const { service: prodService, generateInsights: prodGenerate } = buildService([]);
    await prodService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1', classification: 'SUPPORT' });
    expect(prodGenerate).toHaveBeenCalledWith('entity-1', expect.objectContaining({ includeTechnical: false }));

    const { service: defaultService, generateInsights: defaultGenerate } = buildService([]);
    await defaultService.suggestNextBestAction({ tenantId: 'tenant-1', entityId: 'entity-1' });
    expect(defaultGenerate).toHaveBeenCalledWith('entity-1', expect.objectContaining({ includeTechnical: false }));
  });
});
