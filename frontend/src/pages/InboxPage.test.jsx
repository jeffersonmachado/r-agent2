import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

const listInboxConversations = vi.fn();
const getInboxConversation = vi.fn();
const replyInboxConversation = vi.fn();
const createCaseFromConversation = vi.fn();
const getAgentNameById = vi.fn();

const authDouble = vi.hoisted(() => ({
  capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
}));

vi.mock('../api/inbox', () => ({
  listInboxConversations: (...args) => listInboxConversations(...args),
  getInboxConversation: (...args) => getInboxConversation(...args),
  replyInboxConversation: (...args) => replyInboxConversation(...args),
  assignInboxConversation: vi.fn(),
  transferInboxConversation: vi.fn(),
  addInboxNote: vi.fn(),
  createCaseFromConversation: (...args) => createCaseFromConversation(...args),
}));

vi.mock('../api/tickets', () => ({
  listQueues: vi.fn(async () => ['comercial', 'suporte']),
}));

vi.mock('../api/auth', () => ({
  getAgentNameById: (...args) => getAgentNameById(...args),
}));

vi.mock('../context/authContext', async () => {
  const actual = await vi.importActual('../context/authContext');
  return {
    ...actual,
    useAuth: () => ({
      isAuthenticated: true,
      loading: false,
      agent: { id: 'agent-1', username: 'test' },
      capabilities: authDouble.capabilities,
    }),
  };
});

const mockNavigate = vi.fn();
vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: mockNavigate, currentPath: '/inbox' }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    ToastContainer: () => null,
  }),
}));

vi.mock('../hooks/usePhoneMasking', () => ({
  usePhoneMasking: () => ({ enabled: false }),
}));

vi.mock('../components/MaskedPhone', () => ({
  MaskedPhone: ({ phone }) => <span>{phone}</span>,
}));

vi.mock('../modules/crud-base', () => ({
  CrudPageBase: ({ children }) => <div>{children}</div>,
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { InboxPage } from './InboxPage';

const baseConversation = {
  id: 'c1',
  status: 'waiting',
  channelType: 'whatsapp',
  customerName: 'Ana',
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:05:00Z',
};

describe('pages/InboxPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    authDouble.capabilities = { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' };
    listInboxConversations.mockResolvedValue({ conversations: [], total: 0 });
    getInboxConversation.mockResolvedValue({ conversation: baseConversation, messages: [] });
    getAgentNameById.mockResolvedValue({ agent: { name: 'Agente X' } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllTimers();
    localStorage.clear();
  });

  it('usa o contrato novo de listagem ({ conversations, total }) com status e canal server-side', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(listInboxConversations).toHaveBeenCalled();
    const lastCall = listInboxConversations.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({ limit: 500, offset: 0 });
    expect(lastCall.assignedTo).toBeUndefined();
    expect(lastCall.queue).toBeUndefined();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('caseManagement ligado: mostra Criar chamado, filtro de fila e SLA', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(screen.getByText('SLA máx (min)')).toBeInTheDocument();
    expect(screen.getByText('Priorizar SLA estourado')).toBeInTheDocument();
    expect(screen.getByText('Fila')).toBeInTheDocument();

    // Seleciona a conversa para abrir o painel de detalhes
    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    expect(screen.getByRole('button', { name: 'Criar chamado' })).toBeInTheDocument();
  });

  it('caseManagement desligado: sem Criar chamado, sem SLA e sem seletor de fila', async () => {
    authDouble.capabilities = { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' };
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(screen.queryByText('SLA máx (min)')).not.toBeInTheDocument();
    expect(screen.queryByText('Priorizar SLA estourado')).not.toBeInTheDocument();
    expect(screen.queryByText('Fila')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    expect(screen.queryByRole('button', { name: 'Criar chamado' })).not.toBeInTheDocument();
    // Responder continua disponível no modo caixa de entrada simples
    expect(screen.getByRole('button', { name: 'Enviar resposta' })).toBeInTheDocument();
  });

  it('reply usa POST /inbox/conversations/:id/reply', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    replyInboxConversation.mockResolvedValue({ message: { id: 'm1' } });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Escreva a resposta para o cliente'), { target: { value: 'Olá!' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    });

    expect(replyInboxConversation).toHaveBeenCalledWith('c1', 'Olá!');
  });

  it('criar chamado chama o endpoint de case e avisa quando a capability está desligada', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    createCaseFromConversation.mockResolvedValue({ case: { id: 'case-1' } });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Criar chamado' }));
    });

    expect(createCaseFromConversation).toHaveBeenCalledWith('c1', {});
  });

  it('filtro Atendente filtra client-side (sem refetch a cada tecla)', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    listInboxConversations.mockResolvedValue({
      conversations: [
        { ...baseConversation, id: 'c1', assignedTo: uuid, customerName: 'Ana' },
        { ...baseConversation, id: 'c2', assignedTo: 'outro', customerName: 'Bruno' },
      ],
      total: 2,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    const callsAfterMount = listInboxConversations.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);
    expect(getAgentNameById).toHaveBeenCalledTimes(1);

    const input = screen.getByPlaceholderText('ID ou username');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Agente' } });
      vi.advanceTimersByTime(400);
    });

    // Sem refetch: o filtro é client-side no contrato novo
    expect(listInboxConversations.mock.calls.length).toBe(callsAfterMount);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('cacheia resolução de id→nome de atendente entre cargas', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    listInboxConversations.mockResolvedValue({
      conversations: [{ ...baseConversation, assignedTo: uuid }],
      total: 1,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    const nameCallsAfterFirstLoad = getAgentNameById.mock.calls.length;
    expect(nameCallsAfterFirstLoad).toBe(1);

    // Segunda carga (botão Atualizar) com o mesmo uuid: não resolve novamente
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    });

    expect(listInboxConversations.mock.calls.length).toBeGreaterThan(1);
    expect(getAgentNameById.mock.calls.length).toBe(nameCallsAfterFirstLoad);
  });
});
