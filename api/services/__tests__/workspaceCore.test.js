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
});
