'use strict';

const {
  resolveWhatsAppIvrRouting,
  buildTicketPatchFromRouting,
} = require('../whatsappIvrRoutingService');

describe('whatsappIvrRoutingService', () => {
  const departments = [
    { id: 'dept-fin', name: 'Financeiro', queueNames: ['fila-financeiro'], active: true },
    { id: 'dept-agenda', name: 'Agendamento', queueNames: ['fila-a', 'fila-b'], active: true },
  ];

  const baseConfig = {
    enabled: true,
    aiEnabled: false,
    fallbackMode: 'rules_then_menu',
    defaultDepartmentId: 'dept-fin',
    defaultQueueStrategy: 'department_default',
    businessHours: {
      enabled: true,
      timezone: 'UTC',
      schedule: {
        mon: [{ start: '09:00', end: '18:00' }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
      holidays: [],
      offHoursPolicy: 'create_ticket',
    },
    departmentBindings: [
      {
        departmentId: 'dept-fin',
        enabled: true,
        defaultQueueName: 'fila-financeiro',
        queueStrategy: 'default',
        menuLabel: 'Financeiro',
        menuDescription: '',
        menuOrder: 2,
        aliases: ['financeiro'],
      },
      {
        departmentId: 'dept-agenda',
        enabled: true,
        defaultQueueName: 'fila-a',
        queueStrategy: 'default',
        menuLabel: 'Agendamento',
        menuDescription: '',
        menuOrder: 1,
        aliases: ['agenda'],
      },
    ],
    rules: [
      { id: 'rule-boleto', keyword: 'boleto', departmentId: 'dept-fin', priority: 100, enabled: true },
    ],
    menu: {
      enabled: true,
      timeoutSeconds: 600,
      maxAttempts: 3,
      showOnlyBoundDepartments: true,
      allowTextAliases: true,
      greetingTemplate: 'Oi',
      retryTemplate: 'Retry',
      confirmationTemplate: 'OK',
    },
  };

  test('resolve fallbackMode rules por keyword para departmentId oficial', () => {
    const out = resolveWhatsAppIvrRouting({
      config: { ...baseConfig, fallbackMode: 'rules' },
      departments,
      text: 'Preciso da segunda via do boleto',
      now: new Date('2026-03-02T10:00:00.000Z'),
    });

    expect(out.action).toBe('route');
    expect(out.modeUsed).toBe('rules');
    expect(out.departmentId).toBe('dept-fin');
    expect(out.queueName).toBe('fila-financeiro');
    expect(out.matchedRuleId).toBe('rule-boleto');
  });

  test('resolve fallbackMode rules_then_menu para menu quando nao encontra regra', () => {
    const out = resolveWhatsAppIvrRouting({
      config: { ...baseConfig, fallbackMode: 'rules_then_menu' },
      departments,
      text: 'oi tudo bem',
      now: new Date('2026-03-02T10:00:00.000Z'),
    });

    expect(out.action).toBe('show_menu');
    expect(out.modeUsed).toBe('menu');
    expect(out.menuOptions).toHaveLength(2);
    expect(out.menuOptions[0]).toEqual(expect.objectContaining({ departmentId: 'dept-agenda', optionNumber: 1 }));
  });

  test('retorna off_hours create_ticket quando estiver fora do horario', () => {
    const out = resolveWhatsAppIvrRouting({
      config: baseConfig,
      departments,
      text: 'preciso falar com alguem',
      now: new Date('2026-03-02T20:00:00.000Z'),
    });

    expect(out.action).toBe('create_ticket');
    expect(out.modeUsed).toBe('off_hours');
    expect(out.offHours).toBe(true);
    expect(out.queueName).toBe('fila-financeiro');
  });

  test('propaga auditoria de IA com providerStatus e contexto resumido', () => {
    const out = resolveWhatsAppIvrRouting({
      config: { ...baseConfig, aiEnabled: true, aiMinConfidence: 0.7 },
      departments,
      text: 'quero agendar',
      aiResult: {
        departmentId: 'dept-agenda',
        confidence: 0.91,
        intent: 'agendamento',
        secondaryIntent: 'pilates',
        entities: { activity: 'pilates' },
        reasoning: ['alias:agenda'],
        explanation: 'Decisao baseada em alias.',
        ragUsed: true,
        providerStatus: 'used',
        contextUsed: { ragUsed: true, providerStatus: 'used' },
      },
      now: new Date('2026-03-02T10:00:00.000Z'),
    });

    expect(out.action).toBe('route');
    expect(out.modeUsed).toBe('ai');
    expect(out.ticketContext.whatsappIvr).toEqual(expect.objectContaining({
      aiIntent: 'agendamento',
      aiSecondaryIntent: 'pilates',
      ragUsed: true,
      providerStatus: 'used',
      contextUsed: expect.objectContaining({ ragUsed: true }),
    }));
  });

  test('gera patch de ticket com contexto whatsappIvr e tag fora_do_horario', () => {
    const routingResult = resolveWhatsAppIvrRouting({
      config: baseConfig,
      departments,
      text: 'preciso falar com alguem',
      now: new Date('2026-03-02T20:00:00.000Z'),
    });

    const patch = buildTicketPatchFromRouting({
      ticket: { queue: 'default', tags: ['vip'], context: { metadata: {} } },
      routingResult,
    });

    expect(patch.queue).toBe('fila-financeiro');
    expect(patch.tags).toEqual(expect.arrayContaining(['vip', 'fora_do_horario']));
    expect(patch.context.whatsappIvr).toEqual(expect.objectContaining({
      departmentId: 'dept-fin',
      offHours: true,
      modeUsed: 'off_hours',
    }));
  });
});
