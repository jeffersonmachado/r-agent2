/**
 * Testes unitários para pbxOperatorPanelService
 * Cobre: listOperatorPanelSnapshot, setAgentPauseStatus, assistedTransfer, quickCallback
 */

const SNAPSHOT_DEFAULTS = {
  generatedAt: expect.any(String),
  filters: expect.any(Object),
  summary: expect.objectContaining({
    totalQueues: expect.any(Number),
    totalAgents: expect.any(Number),
    pausedAgents: expect.any(Number),
    activeAgents: expect.any(Number),
    activeCalls: expect.any(Number),
    answeredCalls: expect.any(Number),
    missedCalls: expect.any(Number),
  }),
  queues: expect.any(Array),
  agents: expect.any(Array),
};

const OpMock = { gte: Symbol('gte') };

// Usar jest.fn() diretamente dentro do factory para evitar problema de hoisting
jest.mock('../../api/db/models', () => {
  const queueFindAll = jest.fn(async () => []);
  const memberFindAll = jest.fn(async () => []);
  const extFindAll = jest.fn(async () => []);
  const cdrFindAll = jest.fn(async () => []);
  const memberFindOne = jest.fn(async () => null);

  const queueInstance = { findAll: queueFindAll };
  const memberInstance = { findAll: memberFindAll, findOne: memberFindOne };
  const extInstance = { findAll: extFindAll };
  const cdrInstance = {
    findAll: cdrFindAll,
    sequelize: { constructor: { Op: { gte: 'gte_symbol' } } },
  };

  return {
    PbxQueue: () => queueInstance,
    PbxQueueMember: () => memberInstance,
    PbxExtension: () => extInstance,
    PbxCdr: () => cdrInstance,
    __mocks: { queueFindAll, memberFindAll, extFindAll, cdrFindAll },
  };
});

jest.mock('../../api/services/pbx/pbxQueueMembersService', () => ({
  upsertQueueMember: jest.fn(async (payload) => ({ ok: true, ...payload })),
  listQueueMembers: jest.fn(async () => []),
}));

jest.mock('../../api/services/asterisk/amiClient', () => ({
  originate: jest.fn(async () => ({ ok: true })),
  command: jest.fn(async () => ({ ok: true, lines: [] })),
}));

jest.mock('../../api/services/cc/ccClick2CallService', () => ({
  createClick2CallRequest: jest.fn(async (args) => ({
    id: 'cc-test-id',
    status: 'pending',
    phone: args.payload.phone,
    target: args.payload.target,
  })),
}));

function makeRow(data) {
  return { toJSON: () => ({ ...data }) };
}

// Requires after mocks
const models = require('../../api/db/models');
const service = require('../../api/services/pbx/pbxOperatorPanelService');
const ami = require('../../api/services/asterisk/amiClient');
const click2call = require('../../api/services/cc/ccClick2CallService');
const pbxQueueMembersService = require('../../api/services/pbx/pbxQueueMembersService');

// Acessa os mocks internos do factory
const { queueFindAll, memberFindAll, extFindAll, cdrFindAll } = models.__mocks;

// Helper para setar retorno das models a cada teste
function setupModels({ queues = [], members = [], extensions = [], cdr = [] } = {}) {
  queueFindAll.mockResolvedValue(queues);
  memberFindAll.mockResolvedValue(members);
  extFindAll.mockResolvedValue(extensions);
  cdrFindAll.mockResolvedValue(cdr);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupModels();
  pbxQueueMembersService.upsertQueueMember.mockResolvedValue({ ok: true });
  ami.originate.mockResolvedValue({ ok: true });
  click2call.createClick2CallRequest.mockResolvedValue({ id: 'cc-test-id', status: 'pending' });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('listOperatorPanelSnapshot', () => {
  test('retorna snapshot vazio quando nao ha dados', async () => {
    const result = await service.listOperatorPanelSnapshot({ tenantKey: 'tenant-a' });
    expect(result).toMatchObject(SNAPSHOT_DEFAULTS);
    expect(result.summary.totalQueues).toBe(0);
    expect(result.summary.totalAgents).toBe(0);
    expect(result.queues).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
  });

  test('conta membros ativos e pausados por fila', async () => {
    setupModels({
      queues: [
        makeRow({ id: 'q1', name: 'Suporte', displayName: 'Suporte Geral', tenantKey: 'tenant-a', strategy: 'ringall' }),
      ],
      members: [
        makeRow({ id: 'm1', queueId: 'q1', memberRef: '1001', memberType: 'extension', paused: false, penalty: 0, tenantKey: 'tenant-a', updatedAt: new Date() }),
        makeRow({ id: 'm2', queueId: 'q1', memberRef: '1002', memberType: 'extension', paused: true, penalty: 0, tenantKey: 'tenant-a', updatedAt: new Date() }),
      ],
    });

    const result = await service.listOperatorPanelSnapshot({ tenantKey: 'tenant-a' });
    expect(result.summary.totalQueues).toBe(1);
    expect(result.summary.totalAgents).toBe(2);
    expect(result.summary.pausedAgents).toBe(1);
    expect(result.summary.activeAgents).toBe(1);

    const q = result.queues.find((q) => q.queueId === 'q1');
    expect(q).toBeDefined();
    expect(q.totalMembers).toBe(2);
    expect(q.pausedMembers).toBe(1);
    expect(q.activeMembers).toBe(1);
  });

  test('filtra por queueId', async () => {
    setupModels({
      queues: [
        makeRow({ id: 'q1', name: 'Suporte', tenantKey: 'tenant-a' }),
        makeRow({ id: 'q2', name: 'Vendas', tenantKey: 'tenant-a' }),
      ],
      members: [
        makeRow({ id: 'm1', queueId: 'q1', memberRef: '1001', memberType: 'extension', paused: false, tenantKey: 'tenant-a', updatedAt: new Date() }),
        makeRow({ id: 'm2', queueId: 'q2', memberRef: '1002', memberType: 'extension', paused: false, tenantKey: 'tenant-a', updatedAt: new Date() }),
      ],
    });

    const result = await service.listOperatorPanelSnapshot({ tenantKey: 'tenant-a', filters: { queueId: 'q1' } });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].memberRef).toBe('1001');
  });

  test('infere chamadas ativas (sem disposition)', async () => {
    const now = new Date();
    setupModels({
      cdr: [
        makeRow({ uniqueid: 'c1', calldate: now, src: '1001', dst: '1002', disposition: null, duration: 0, billsec: 0 }),
        makeRow({ uniqueid: 'c2', calldate: now, src: '1001', dst: '1003', disposition: 'ANSWERED', duration: 30, billsec: 28 }),
      ],
    });

    const result = await service.listOperatorPanelSnapshot({ tenantKey: 'tenant-a', filters: { activeCallWindowMinutes: 15 } });
    expect(result.summary.activeCalls).toBe(1);
    expect(result.summary.answeredCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('setAgentPauseStatus', () => {
  test('lanca erro quando memberRef ausente', async () => {
    await expect(service.setAgentPauseStatus({ tenantKey: 'tenant-a', payload: { paused: true } }))
      .rejects.toMatchObject({ code: 'member_ref_required' });
  });

  test('lanca erro quando paused ausente', async () => {
    await expect(service.setAgentPauseStatus({ tenantKey: 'tenant-a', payload: { memberRef: '1001' } }))
      .rejects.toMatchObject({ code: 'paused_required' });
  });

  test('lanca erro quando memberType invalido', async () => {
    await expect(service.setAgentPauseStatus({ tenantKey: 'tenant-a', payload: { memberRef: '1001', paused: true, memberType: 'robot' } }))
      .rejects.toMatchObject({ code: 'member_type_invalid' });
  });

  test('atualiza membro quando encontrado em fila', async () => {
    setupModels({
      members: [
        makeRow({ id: 'm1', queueId: 'q1', memberRef: '1001', memberType: 'extension', paused: false, penalty: 0, tenantKey: 'tenant-a', updatedAt: new Date() }),
      ],
    });

    const result = await service.setAgentPauseStatus({
      tenantKey: 'tenant-a',
      payload: { memberRef: '1001', memberType: 'extension', paused: true },
    });
    expect(result.ok).toBe(true);
    expect(result.paused).toBe(true);
    expect(result.updatedCount).toBe(1);
    expect(pbxQueueMembersService.upsertQueueMember).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ paused: true }) }));
  });

  test('lanca erro quando agente nao encontrado em nenhuma fila', async () => {
    setupModels({ members: [] });
    await expect(service.setAgentPauseStatus({ tenantKey: 'tenant-a', payload: { memberRef: '9999', paused: true } }))
      .rejects.toMatchObject({ code: 'agent_not_found_in_queues' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assistedTransfer', () => {
  test('lanca erro quando from ausente', async () => {
    await expect(service.assistedTransfer({ tenantKey: 'tenant-a', payload: { to: '1002' } }))
      .rejects.toMatchObject({ code: 'transfer_from_required' });
  });

  test('lanca erro quando to ausente', async () => {
    await expect(service.assistedTransfer({ tenantKey: 'tenant-a', payload: { from: '1001' } }))
      .rejects.toMatchObject({ code: 'transfer_to_required' });
  });

  test('chama ami.originate com parametros corretos', async () => {
    const result = await service.assistedTransfer({
      tenantKey: 'tenant-a',
      payload: { from: '1001', to: '1002', context: 'from-internal' },
    });
    expect(result.ok).toBe(true);
    expect(result.from).toBe('1001');
    expect(result.to).toBe('1002');
    expect(ami.originate).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'PJSIP/1001',
      exten: '1002',
      context: 'from-internal',
    }));
  });

  test('usa tenantKey como contexto quando context nao informado', async () => {
    await service.assistedTransfer({ tenantKey: 'meu-tenant', payload: { from: '1001', to: '1002' } });
    expect(ami.originate).toHaveBeenCalledWith(expect.objectContaining({ context: 'meu-tenant' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('quickCallback', () => {
  test('lanca erro quando phone ausente', async () => {
    await expect(service.quickCallback({ tenantKey: 'tenant-a', payload: {} }))
      .rejects.toMatchObject({ code: 'callback_phone_required' });
  });

  test('cria click2call com phone e target corretos', async () => {
    const result = await service.quickCallback({
      tenantKey: 'tenant-a',
      payload: { phone: '11999990000', target: '1001', note: 'teste' },
    });
    expect(result.ok).toBe(true);
    expect(result.phone).toBe('11999990000');
    expect(result.callbackId).toBe('cc-test-id');
    expect(result.status).toBe('pending');
    expect(click2call.createClick2CallRequest).toHaveBeenCalledWith(expect.objectContaining({
      tenantKey: 'tenant-a',
      payload: expect.objectContaining({ phone: '11999990000', target: '1001' }),
    }));
  });

  test('usa phone como target quando target nao informado', async () => {
    await service.quickCallback({ tenantKey: 'tenant-a', payload: { phone: '11988880000' } });
    expect(click2call.createClick2CallRequest).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ phone: '11988880000', target: '11988880000' }),
    }));
  });
});
