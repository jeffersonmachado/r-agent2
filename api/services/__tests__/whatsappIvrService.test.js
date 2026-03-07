'use strict';

jest.mock('../departmentsService', () => ({
  listDepartments: jest.fn(),
}));

jest.mock('../queueService', () => ({
  listQueues: jest.fn(),
}));

jest.mock('../queueDefinitionService', () => ({
  listQueues: jest.fn(),
}));

jest.mock('../tenantSettingsService', () => ({
  getSetting: jest.fn(),
  upsertSetting: jest.fn(),
}));

const departmentsService = require('../departmentsService');
const queueService = require('../queueService');
const queueDefinitionService = require('../queueDefinitionService');
const tenantSettingsService = require('../tenantSettingsService');
const {
  normalizeWhatsAppIvrConfig,
  validateWhatsAppIvrConfig,
  isWithinBusinessHours,
  getNormalizedWhatsAppIvrSetting,
} = require('../whatsappIvrService');

describe('whatsappIvrService', () => {
  const departments = [
    { id: 'dept-fin', name: 'Financeiro', queueNames: ['fila-financeiro'], active: true },
    { id: 'dept-agenda', name: 'Agendamento', queueNames: ['fila-a', 'fila-b'], active: true },
  ];
  const queues = ['fila-financeiro', 'fila-a', 'fila-b'];

  beforeEach(() => {
    jest.clearAllMocks();
    departmentsService.listDepartments.mockReturnValue(departments);
    queueService.listQueues.mockReturnValue(queues);
    queueDefinitionService.listQueues.mockReturnValue(queues.map((name) => ({ name })));
  });

  test('migra configuracao legada para departmentBindings e regras oficiais', () => {
    const rawConfig = {
      enabled: true,
      departments: [
        { id: 'legacy-1', name: 'Financeiro', queue: 'fila-financeiro', enabled: true },
        { id: 'legacy-x', name: 'Nao Mapeado', queue: 'fila-x', enabled: true },
      ],
      rules: [
        { id: 'r-1', keyword: 'boleto', departmentId: 'legacy-1', priority: 100, enabled: true },
      ],
    };

    const out = normalizeWhatsAppIvrConfig(rawConfig, { departments, queues });

    expect(out.config.departmentBindings).toEqual([
      expect.objectContaining({
        departmentId: 'dept-fin',
        defaultQueueName: 'fila-financeiro',
        enabled: true,
      }),
    ]);
    expect(out.config.rules[0]).toEqual(expect.objectContaining({
      departmentId: 'dept-fin',
      keyword: 'boleto',
    }));
    expect(out.config.migration.pendingDepartments).toEqual([
      expect.objectContaining({ name: 'Nao Mapeado', reason: 'department_not_found' }),
    ]);
    expect(out.warnings.some((item) => item.includes('Nao Mapeado'))).toBe(true);
  });

  test('marca binding invalido quando defaultQueueName nao pertence ao queueNames do departamento', () => {
    const config = {
      enabled: true,
      fallbackMode: 'rules',
      defaultQueueStrategy: 'department_default',
      businessHours: { enabled: false },
      departmentBindings: [
        {
          departmentId: 'dept-agenda',
          enabled: true,
          defaultQueueName: 'fila-inexistente',
          queueStrategy: 'default',
          menuLabel: 'Agenda',
          menuDescription: '',
          menuOrder: 1,
          aliases: [],
        },
      ],
      rules: [],
      menu: { enabled: true, timeoutSeconds: 600, maxAttempts: 3 },
    };

    const validation = validateWhatsAppIvrConfig(config, { departments, queues });

    expect(validation.errors).toContain('Fila padrao "fila-inexistente" invalida para o departamento "Agendamento"');
  });

  test('identifica horario aberto e fechado', () => {
    const businessHours = {
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
    };

    const open = isWithinBusinessHours(businessHours, { now: new Date('2026-03-02T10:00:00.000Z') });
    const closed = isWithinBusinessHours(businessHours, { now: new Date('2026-03-02T20:00:00.000Z') });

    expect(open.open).toBe(true);
    expect(closed.open).toBe(false);
    expect(closed.reason).toBe('outside_schedule');
  });

  test('GET normalizado expande warnings e espelha legado derivado', async () => {
    tenantSettingsService.getSetting.mockResolvedValue({
      ok: true,
      value: {
        enabled: true,
        departmentBindings: [
          {
            departmentId: 'dept-fin',
            enabled: true,
            defaultQueueName: 'fila-financeiro',
            queueStrategy: 'default',
            menuLabel: 'Financeiro',
            menuDescription: '',
            menuOrder: 1,
            aliases: [],
          },
        ],
        rules: [],
      },
    });

    const out = await getNormalizedWhatsAppIvrSetting({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.value.departments).toEqual([
      { id: 'dept-fin', name: 'Financeiro', queue: 'fila-financeiro', enabled: true },
    ]);
    expect(out.departments).toHaveLength(2);
    expect(out.queues).toEqual(expect.arrayContaining(['fila-financeiro', 'fila-a']));
  });
});
