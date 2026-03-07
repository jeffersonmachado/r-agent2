'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const ticketRef = {
  id: 'ticket-1',
  tenantId: 'tenant-wa',
  queue: 'default',
  tags: [],
  context: {},
};

jest.mock('../queueService', () => ({
  getTicket: jest.fn(() => ticketRef),
  updateTicket: jest.fn((_id, patch) => {
    if (patch?.context) {
      ticketRef.context = {
        ...(ticketRef.context || {}),
        ...patch.context,
        metadata: {
          ...((ticketRef.context || {}).metadata || {}),
          ...((patch.context || {}).metadata || {}),
        },
      };
    }
    Object.assign(ticketRef, {
      ...patch,
      context: ticketRef.context,
    });
    return ticketRef;
  }),
}));

jest.mock('../outboundQueueService', () => ({
  enqueueOutbound: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../whatsappIvrService', () => {
  const actual = jest.requireActual('../whatsappIvrService');
  return {
    ...actual,
    getNormalizedWhatsAppIvrSetting: jest.fn(async () => ({
      ok: true,
      value: { enabled: false },
      departments: [],
      menuOptions: [],
    })),
  };
});

jest.mock('../whatsappIvrStateService', () => {
  const stateMap = new Map();
  return {
    __store: stateMap,
    getState: jest.fn(async ({ tenantId, sessionId }) => stateMap.get(`${tenantId}:${sessionId}`) || null),
    setState: jest.fn(async ({ tenantId, sessionId, state }) => {
      stateMap.set(`${tenantId}:${sessionId}`, state || null);
      return state || null;
    }),
    resetState: jest.fn(async ({ tenantId, sessionId }) => {
      stateMap.delete(`${tenantId}:${sessionId}`);
      return true;
    }),
    __resetAll: () => stateMap.clear(),
  };
});

const { applyWhatsAppIvr } = require('../whatsappInboundService');
const queueService = require('../queueService');
const outboundQueueService = require('../outboundQueueService');
const whatsappIvrService = require('../whatsappIvrService');
const whatsappIvrStateService = require('../whatsappIvrStateService');

describe('whatsappInboundService.applyWhatsAppIvr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    whatsappIvrStateService.__resetAll();
    whatsappIvrStateService.getState.mockImplementation(async ({ tenantId, sessionId }) => {
      return whatsappIvrStateService.__store.get(`${tenantId}:${sessionId}`) || null;
    });
    whatsappIvrStateService.setState.mockImplementation(async ({ tenantId, sessionId, state }) => {
      whatsappIvrStateService.__store.set(`${tenantId}:${sessionId}`, state || null);
      return state || null;
    });
    whatsappIvrStateService.resetState.mockImplementation(async ({ tenantId, sessionId }) => {
      whatsappIvrStateService.__store.delete(`${tenantId}:${sessionId}`);
      return true;
    });
    ticketRef.id = 'ticket-1';
    ticketRef.tenantId = 'tenant-wa';
    ticketRef.queue = 'default';
    ticketRef.tags = [];
    ticketRef.context = {};
    whatsappIvrService.getNormalizedWhatsAppIvrSetting.mockResolvedValue({
      ok: true,
      value: { enabled: false },
      departments: [],
      menuOptions: [],
    });
  });

  test('envia menu e retorna stopPipeline quando fallback cai em menu', async () => {
    whatsappIvrService.getNormalizedWhatsAppIvrSetting.mockResolvedValue({
      ok: true,
      value: {
        enabled: true,
        aiEnabled: false,
        fallbackMode: 'rules_then_menu',
        defaultDepartmentId: null,
        businessHours: { enabled: false, schedule: {}, holidays: [], offHoursPolicy: 'create_ticket' },
        departmentBindings: [
          {
            departmentId: 'dept-1',
            enabled: true,
            defaultQueueName: 'fila-1',
            queueStrategy: 'default',
            menuLabel: 'Atendimento',
            menuDescription: 'Falar com atendimento',
            menuOrder: 1,
            aliases: ['atendimento'],
          },
        ],
        rules: [],
        menu: {
          enabled: true,
          timeoutSeconds: 600,
          maxAttempts: 3,
          allowTextAliases: true,
          greetingTemplate: 'Escolha uma opcao:',
          retryTemplate: 'Nao entendi.',
          confirmationTemplate: 'OK {{department}}',
        },
      },
      departments: [{ id: 'dept-1', name: 'Atendimento', queueNames: ['fila-1'], active: true }],
      menuOptions: [{ departmentId: 'dept-1', departmentName: 'Atendimento', menuLabel: 'Atendimento', menuDescription: 'Falar com atendimento', optionNumber: 1 }],
    });

    const out = await applyWhatsAppIvr({
      tenantId: 'tenant-wa',
      ticket: ticketRef,
      conversationId: 'conv-1',
      sessionId: 'whatsapp_cloud_pn-1_5511999991000',
      contactPhone: '5511999991000',
      text: 'oi',
      now: new Date('2026-03-06T12:00:00.000Z'),
    });

    expect(out.handled).toBe(true);
    expect(out.stopPipeline).toBe(true);
    expect(out.routingResult.action).toBe('show_menu');
    expect(outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(whatsappIvrStateService.setState).toHaveBeenCalled();
  });

  test('fora do horario registra contexto e retorna stopPipeline', async () => {
    whatsappIvrService.getNormalizedWhatsAppIvrSetting.mockResolvedValue({
      ok: true,
      value: {
        enabled: true,
        aiEnabled: false,
        fallbackMode: 'rules_then_menu',
        defaultDepartmentId: 'dept-1',
        businessHours: {
          enabled: true,
          timezone: 'UTC',
          schedule: { mon: [{ start: '09:00', end: '10:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
          holidays: ['2026-03-06'],
          offHoursPolicy: 'create_ticket',
        },
        departmentBindings: [
          {
            departmentId: 'dept-1',
            enabled: true,
            defaultQueueName: 'fila-1',
            queueStrategy: 'default',
            menuLabel: 'Atendimento',
            menuDescription: '',
            menuOrder: 1,
            aliases: [],
          },
        ],
        rules: [],
        menu: {
          enabled: true,
          timeoutSeconds: 600,
          maxAttempts: 3,
          allowTextAliases: true,
          greetingTemplate: 'Escolha',
          retryTemplate: 'Retry',
          confirmationTemplate: 'OK {{department}}',
        },
      },
      departments: [{ id: 'dept-1', name: 'Atendimento', queueNames: ['fila-1'], active: true }],
      menuOptions: [],
    });

    const out = await applyWhatsAppIvr({
      tenantId: 'tenant-wa',
      ticket: ticketRef,
      conversationId: 'conv-1',
      sessionId: 'whatsapp_cloud_pn-1_5511999991001',
      contactPhone: '5511999991001',
      text: 'preciso de ajuda',
      now: new Date('2026-03-06T12:00:00.000Z'),
    });

    expect(out.handled).toBe(true);
    expect(out.stopPipeline).toBe(true);
    expect(out.routingResult.action).toBe('create_ticket');
    expect(outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(queueService.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        queue: 'fila-1',
        tags: expect.arrayContaining(['fora_do_horario']),
        context: expect.objectContaining({
          whatsappIvr: expect.objectContaining({
            offHours: true,
            modeUsed: 'off_hours',
          }),
        }),
      }),
    );
  });

  test('rota por regra atualiza queue/contexto e nao interrompe pipeline', async () => {
    whatsappIvrService.getNormalizedWhatsAppIvrSetting.mockResolvedValue({
      ok: true,
      value: {
        enabled: true,
        aiEnabled: false,
        fallbackMode: 'rules',
        defaultDepartmentId: null,
        businessHours: { enabled: false, schedule: {}, holidays: [], offHoursPolicy: 'create_ticket' },
        departmentBindings: [
          {
            departmentId: 'dept-fin',
            enabled: true,
            defaultQueueName: 'fila-fin',
            queueStrategy: 'default',
            menuLabel: 'Financeiro',
            menuDescription: '',
            menuOrder: 1,
            aliases: ['financeiro'],
          },
        ],
        rules: [
          { id: 'rule-boleto', keyword: 'boleto', departmentId: 'dept-fin', priority: 100, enabled: true },
        ],
        menu: {
          enabled: true,
          timeoutSeconds: 600,
          maxAttempts: 3,
          allowTextAliases: true,
          greetingTemplate: 'Escolha',
          retryTemplate: 'Retry',
          confirmationTemplate: 'OK {{department}}',
        },
      },
      departments: [{ id: 'dept-fin', name: 'Financeiro', queueNames: ['fila-fin'], active: true }],
      menuOptions: [],
    });

    const out = await applyWhatsAppIvr({
      tenantId: 'tenant-wa',
      ticket: ticketRef,
      conversationId: 'conv-1',
      sessionId: 'whatsapp_cloud_pn-1_5511999991002',
      contactPhone: '5511999991002',
      text: 'quero boleto',
      now: new Date('2026-03-06T12:00:00.000Z'),
    });

    expect(out.handled).toBe(false);
    expect(out.stopPipeline).toBeUndefined();
    expect(out.routingResult.action).toBe('route');
    expect(queueService.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        queue: 'fila-fin',
        context: expect.objectContaining({
          whatsappIvr: expect.objectContaining({
            departmentId: 'dept-fin',
            matchedRuleId: 'rule-boleto',
            selectedVia: 'rule',
          }),
        }),
      }),
    );
  });
});
