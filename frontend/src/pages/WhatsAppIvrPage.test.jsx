import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppIvrPage } from './WhatsAppIvrPage';

let webSocketHookArgs = null;

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

const showToastMock = vi.fn();
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    ToastContainer: () => null,
  }),
}));

const updateWhatsAppIvrMock = vi.fn();
vi.mock('../api/whatsappIvr', () => ({
  getWhatsAppIvr: vi.fn(async () => ({
    ok: true,
    value: {
      enabled: true,
      aiEnabled: true,
      fallbackMode: 'rules_then_menu',
      defaultDepartmentId: null,
      defaultQueueStrategy: 'department_default',
      businessHours: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        schedule: { mon: [{ start: '09:00', end: '18:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
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
          menuDescription: 'Pagamentos',
          menuOrder: 2,
          aliases: ['boleto'],
        },
      ],
      rules: [
        { id: 'r-1', keyword: 'boleto', departmentId: 'dept-fin', priority: 100, enabled: true },
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
      migration: {
        pendingDepartments: [{ legacyId: 'legacy-1', name: 'Legado', queue: 'fila-x' }],
        warnings: [],
      },
    },
    departments: [
      { id: 'dept-fin', name: 'Financeiro', queueNames: ['fila-financeiro'] },
      { id: 'dept-sem-fila', name: 'Recepcao', queueNames: [] },
    ],
    queues: ['fila-financeiro'],
    warnings: ['Fila legada nao foi encontrada'],
    invalidBindings: [{ departmentId: 'dept-sem-fila', reason: 'department_without_queues' }],
    invalidRules: [],
  })),
  updateWhatsAppIvr: (...args) => updateWhatsAppIvrMock(...args),
}));

vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: (args = {}) => {
    webSocketHookArgs = args;
    return {
      connected: true,
      authenticated: true,
      authFailed: false,
    };
  },
}));

describe('WhatsAppIvrPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webSocketHookArgs = null;
  });

  it('carrega departments oficiais e warnings de migracao', async () => {
    render(<WhatsAppIvrPage />);

    await waitFor(() => {
      expect(screen.getByText('URA WhatsApp')).toBeInTheDocument();
      expect(screen.getAllByText('Financeiro').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Recepcao').length).toBeGreaterThan(0);
      expect(screen.getByText('Fila legada nao foi encontrada')).toBeInTheDocument();
      expect(screen.getByText(/Pendencia de migracao/)).toBeInTheDocument();
      expect(screen.getAllByText('Departamento sem fila operacional vinculada').length).toBeGreaterThan(0);
      expect(screen.getByText('Conectado')).toBeInTheDocument();
    });
  });

  it('atualiza a tela ao receber evento websocket com payload normalizado', async () => {
    render(<WhatsAppIvrPage />);

    await waitFor(() => {
      expect(webSocketHookArgs).not.toBeNull();
      expect(typeof webSocketHookArgs.onEvent).toBe('function');
    });

    act(() => {
      webSocketHookArgs.onEvent('whatsapp.ivr.updated', {
        value: {
          enabled: false,
          aiEnabled: false,
          fallbackMode: 'menu',
          defaultDepartmentId: null,
          defaultQueueStrategy: 'department_default',
          businessHours: {
            enabled: false,
            timezone: 'America/Sao_Paulo',
            schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
            holidays: [],
            offHoursPolicy: 'create_ticket',
          },
          departmentBindings: [
            {
              departmentId: 'dept-suporte',
              enabled: true,
              defaultQueueName: 'fila-suporte',
              queueStrategy: 'default',
              menuLabel: 'Suporte',
              menuDescription: 'Atendimento',
              menuOrder: 1,
              aliases: ['suporte'],
            },
          ],
          rules: [
            { id: 'r-2', keyword: 'ajuda', departmentId: 'dept-suporte', priority: 90, enabled: true },
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
          migration: { pendingDepartments: [], warnings: [] },
        },
        departments: [
          { id: 'dept-suporte', name: 'Suporte', queueNames: ['fila-suporte'] },
        ],
        queues: ['fila-suporte'],
        warnings: [],
        invalidBindings: [],
        invalidRules: [],
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Suporte').length).toBeGreaterThan(0);
      expect(screen.getByDisplayValue('fila-suporte')).toBeInTheDocument();
      expect(screen.getByDisplayValue('ajuda')).toBeInTheDocument();
      expect(screen.getByText('URA desabilitada')).toBeInTheDocument();
    });
  });

  it('envia o payload consolidado ao salvar', async () => {
    updateWhatsAppIvrMock.mockResolvedValue({ ok: true, value: { ...DEFAULT_RESPONSE.value }, departments: DEFAULT_RESPONSE.departments, queues: DEFAULT_RESPONSE.queues, warnings: [], invalidBindings: [], invalidRules: [] });

    render(<WhatsAppIvrPage />);

    await waitFor(() => {
      expect(screen.getByText('Salvar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(updateWhatsAppIvrMock).toHaveBeenCalledTimes(1);
      expect(updateWhatsAppIvrMock.mock.calls[0][0]).toEqual(expect.objectContaining({
        enabled: true,
        departmentBindings: expect.arrayContaining([
          expect.objectContaining({ departmentId: 'dept-fin', defaultQueueName: 'fila-financeiro' }),
        ]),
      }));
    });
  });
});

const DEFAULT_RESPONSE = {
  value: {
    enabled: true,
    aiEnabled: true,
    fallbackMode: 'rules_then_menu',
    defaultDepartmentId: null,
    defaultQueueStrategy: 'department_default',
    businessHours: {
      enabled: true,
      timezone: 'America/Sao_Paulo',
      schedule: { mon: [{ start: '09:00', end: '18:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
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
        menuDescription: 'Pagamentos',
        menuOrder: 2,
        aliases: ['boleto'],
      },
    ],
    rules: [
      { id: 'r-1', keyword: 'boleto', departmentId: 'dept-fin', priority: 100, enabled: true },
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
    migration: { pendingDepartments: [], warnings: [] },
  },
  departments: [
    { id: 'dept-fin', name: 'Financeiro', queueNames: ['fila-financeiro'] },
  ],
  queues: ['fila-financeiro'],
};
