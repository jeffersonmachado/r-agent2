import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspacePage } from './WorkspacePage';

const testDoubles = vi.hoisted(() => ({
  auth: { agent: { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' } },
  router: { navigate: vi.fn() },
  toast: { showToast: vi.fn() },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: testDoubles.auth.agent,
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ currentPath: '/workspace', navigate: testDoubles.router.navigate }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: testDoubles.toast.showToast, ToastContainer: () => null }),
}));

vi.mock('../api/workspace', () => ({
  listWorkspaceEntities: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getWorkspaceTimeline: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0, hasMore: false }),
  getWorkspaceInsights: vi.fn().mockResolvedValue({ items: [], persisted: [] }),
  getWorkspaceActions: vi.fn().mockResolvedValue({ items: [], suggestion: null }),
  getWorkspaceIncidentRuns: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  createWorkspaceAction: vi.fn().mockResolvedValue({}),
  createWorkspaceEntity: vi.fn().mockResolvedValue({ entity: { id: 'e-1' } }),
  createWorkspaceTask: vi.fn().mockResolvedValue({ id: 't-1' }),
  createPaymentEvent: vi.fn().mockResolvedValue({ id: 'p-1' }),
  createResourceBooking: vi.fn().mockResolvedValue({ id: 'b-1' }),
  listResources: vi.fn().mockResolvedValue({ items: [] }),
  executeWorkspaceAutoActions: vi.fn().mockResolvedValue({}),
}));

describe('WorkspacePage — segregação por classificação', () => {
  beforeEach(() => {
    testDoubles.auth.agent = { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' };
    testDoubles.router.navigate.mockClear();
    testDoubles.toast.showToast.mockClear();
  });

  it('PRODUCTION não vê a tab técnica nem labels técnicos', async () => {
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('Resumo')).toBeTruthy();
    });

    expect(screen.queryByText('QA/RPA')).toBeNull();
    expect(screen.queryByText('Falha QA/RPA')).toBeNull();
    // Filtro técnico da sidebar aparece com rótulo sanitizado
    expect(screen.getByText('Incidentes operacionais')).toBeTruthy();
  });

  it('DEVELOPMENT vê a tab QA/RPA e o filtro técnico', async () => {
    testDoubles.auth.agent = { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' };
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('QA/RPA')).toBeTruthy();
    });

    expect(screen.getByText('Falha QA/RPA')).toBeTruthy();
  });

  it('SUPPORT NÃO vê a tab QA/RPA (superfície de engenharia é DEVELOPMENT-only)', async () => {
    testDoubles.auth.agent = { id: 'a-sup', role: 'auditor', classification: 'SUPPORT' };
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('Resumo')).toBeTruthy();
    });

    expect(screen.queryByText('QA/RPA')).toBeNull();
    expect(screen.queryByText('Falha QA/RPA')).toBeNull();
    // SUPPORT recebe os mesmos rótulos sanitizados de outcome operacional
    expect(screen.getByText('Incidentes operacionais')).toBeTruthy();
  });

  it('PRODUCTION sanitiza eventos técnicos da timeline', async () => {
    const { getWorkspaceTimeline } = await import('../api/workspace');
    getWorkspaceTimeline.mockResolvedValueOnce({
      items: [
        { id: 'ev-1', type: 'evidence', source: 'qa-mesh', summary: 'Falha QA na wave 3', createdAt: '2026-08-01T10:00:00.000Z', payload: {} },
      ],
      total: 1,
      limit: 30,
      offset: 0,
      hasMore: false,
    });
    const { listWorkspaceEntities } = await import('../api/workspace');
    listWorkspaceEntities.mockResolvedValueOnce({ items: [{ id: 'e-1', type: 'contact', name: 'Cliente X' }], total: 1 });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Cliente X').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('Falha QA na wave 3')).toBeNull();
    });
    expect(screen.getAllByText('Instabilidade detectada e recuperada').length).toBeGreaterThan(0);
  });
});

describe('WorkspacePage — resumo do servidor na sidebar', () => {
  beforeEach(() => {
    testDoubles.auth.agent = { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' };
    testDoubles.router.navigate.mockClear();
    testDoubles.toast.showToast.mockClear();
  });

  it('renderiza badge de risco e contadores a partir do summary da entidade', async () => {
    const { listWorkspaceEntities } = await import('../api/workspace');
    listWorkspaceEntities.mockResolvedValue({
      items: [{
        id: 'e-risk',
        type: 'contact',
        name: 'Cliente Risco',
        summary: {
          openTickets: 2,
          pendingActions: 1,
          pendingPayments: 3,
          riskLevel: 'critical',
          lastInteractionAt: '2026-09-01T10:00:00.000Z',
        },
      }],
      total: 1,
    });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Cliente Risco').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Crítico').length).toBeGreaterThan(0);
    expect(screen.getByText('2 tickets abertos')).toBeTruthy();
    expect(screen.getByText('3 pagamentos pendentes')).toBeTruthy();
    expect(screen.getByText('1 ação pendente')).toBeTruthy();
  });

  it('filtro "Em risco" usa summary.riskLevel do servidor', async () => {
    const { listWorkspaceEntities } = await import('../api/workspace');
    listWorkspaceEntities.mockResolvedValue({
      items: [
        { id: 'e-warn', type: 'contact', name: 'Cliente Atencao', summary: { riskLevel: 'attention' } },
        { id: 'e-ok', type: 'contact', name: 'Cliente Ok', summary: { riskLevel: 'none' } },
      ],
      total: 2,
    });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Cliente Ok').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Em risco' }));
    await waitFor(() => {
      expect(screen.queryByText('Cliente Ok')).toBeNull();
    });
    expect(screen.getAllByText('Cliente Atencao').length).toBeGreaterThan(0);
  });
});

describe('WorkspacePage — ações contextuais executáveis', () => {
  beforeEach(() => {
    testDoubles.auth.agent = { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' };
    testDoubles.router.navigate.mockClear();
    testDoubles.toast.showToast.mockClear();
  });

  async function renderWithSelectedEntity(api, overrides = {}) {
    api.listWorkspaceEntities.mockResolvedValue({
      items: [{ id: 'e-1', type: 'contact', name: 'Cliente Acoes', summary: { riskLevel: 'none' } }],
      total: 1,
    });
    if (overrides.suggestion !== undefined) {
      api.getWorkspaceActions.mockResolvedValue({ items: [], suggestion: overrides.suggestion });
    }
    render(<WorkspacePage />);
    await waitFor(() => {
      expect(screen.getAllByText('Cliente Acoes').length).toBeGreaterThan(0);
    });
    return api;
  }

  it('modal de tarefa envia título e vencimento personalizados', async () => {
    const api = await import('../api/workspace');
    api.createWorkspaceTask.mockClear();
    await renderWithSelectedEntity(api);

    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'Ligar para o cliente' } });
    fireEvent.change(screen.getByLabelText(/Vencimento/), { target: { value: '2026-09-10T14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({
        entityId: 'e-1',
        title: 'Ligar para o cliente',
        dueDate: '2026-09-10T14:00',
        type: 'manual',
      }));
    });
  });

  it('modal de pagamento exige valor antes de enviar', async () => {
    const api = await import('../api/workspace');
    api.createPaymentEvent.mockClear();
    await renderWithSelectedEntity(api);

    fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Informe um valor válido');
    });
    expect(api.createPaymentEvent).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Valor/), { target: { value: '150.50' } });
    fireEvent.change(screen.getByLabelText(/Método/), { target: { value: 'pix' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.createPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
        entityId: 'e-1',
        amount: 150.5,
        status: 'pending',
        metadata: { method: 'pix' },
      }));
    });
  });

  it('NBA renderiza expectedOutcome/confiança/risco e send_message navega para o inbox', async () => {
    const api = await import('../api/workspace');
    await renderWithSelectedEntity(api, {
      suggestion: {
        type: 'message',
        label: 'Retomar contato',
        reason: 'Cliente sem resposta há 10 dias.',
        confidence: 0.8,
        expectedOutcome: 'Cliente responde e reagenda a visita.',
        risk: 'low',
        action: { kind: 'send_message', conversationId: 'conv-9', label: 'Enviar mensagem' },
      },
    });

    await waitFor(() => {
      expect(screen.getAllByText('Resultado esperado: Cliente responde e reagenda a visita.').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Risco baixo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80% confiança').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Enviar mensagem' })[0]);
    expect(testDoubles.router.navigate).toHaveBeenCalledWith('/inbox?conversationId=conv-9');
  });

  it('NBA com send_message sem conversa fica desabilitado', async () => {
    const api = await import('../api/workspace');
    await renderWithSelectedEntity(api, {
      suggestion: {
        type: 'message',
        label: 'Retomar contato',
        reason: 'Cliente inativo.',
        risk: 'medium',
        action: { kind: 'send_message', conversationId: null, label: 'Enviar mensagem' },
      },
    });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Enviar mensagem' }).length).toBeGreaterThan(0);
    });
    const buttons = screen.getAllByRole('button', { name: 'Enviar mensagem' });
    buttons.forEach((button) => expect(button.disabled).toBe(true));
  });

  it('NBA do tipo schedule abre o modal de agendamento com recursos', async () => {
    const api = await import('../api/workspace');
    api.listResources.mockResolvedValue({ items: [{ id: 'r-1', name: 'Sala 1', type: 'room' }] });
    await renderWithSelectedEntity(api, {
      suggestion: {
        type: 'schedule',
        label: 'Agendar retorno',
        reason: 'Cliente pediu nova visita.',
        risk: 'medium',
        action: { kind: 'schedule', conversationId: null, label: 'Agendar retorno' },
      },
    });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Agendar retorno' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Agendar retorno' })[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Agendar recurso' })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Sala 1 (room)')).toBeTruthy();
    });
  });
});
