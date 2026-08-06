import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

const listInboxConversations = vi.fn();
const getAgentNameById = vi.fn();

vi.mock('../api/inbox', () => ({
  listInboxConversations: (...args) => listInboxConversations(...args),
  assignInboxConversation: vi.fn(),
  transferInboxConversation: vi.fn(),
  addInboxNote: vi.fn(),
}));

vi.mock('../api/tickets', () => ({
  listQueues: vi.fn(async () => []),
  getTicketMessages: vi.fn(async () => []),
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

describe('pages/InboxPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    listInboxConversations.mockResolvedValue({ tickets: [] });
    getAgentNameById.mockResolvedValue({ agent: { name: 'Agente X' } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllTimers();
    localStorage.clear();
  });

  it('faz debounce do filtro Atendente em vez de refetch a cada tecla', async () => {
    await act(async () => {
      render(<InboxPage />);
    });

    const callsAfterMount = listInboxConversations.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    const input = screen.getByPlaceholderText('ID ou username');

    // Digita 3 caracteres sem avançar o relógio: nenhum refetch imediato
    await act(async () => {
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.change(input, { target: { value: 'ab' } });
      fireEvent.change(input, { target: { value: 'abc' } });
    });

    expect(listInboxConversations.mock.calls.length).toBe(callsAfterMount);

    // Após 400ms de debounce, exatamente um refetch com o valor final
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(listInboxConversations.mock.calls.length).toBe(callsAfterMount + 1);
    const lastCall = listInboxConversations.mock.calls.at(-1)[0];
    expect(lastCall.assignedTo).toBe('abc');
  });

  it('cacheia resolução de id→nome de atendente entre cargas', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    listInboxConversations.mockResolvedValue({
      tickets: [{ id: 't1', assignedTo: uuid, createdAt: '2026-08-01T10:00:00Z' }],
    });

    await act(async () => {
      render(<InboxPage />);
    });

    const nameCallsAfterFirstLoad = getAgentNameById.mock.calls.length;
    expect(nameCallsAfterFirstLoad).toBe(1);

    // Segunda carga com o mesmo uuid: não resolve novamente
    const input = screen.getByPlaceholderText('ID ou username');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'x' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(listInboxConversations.mock.calls.length).toBeGreaterThan(1);
    expect(getAgentNameById.mock.calls.length).toBe(nameCallsAfterFirstLoad);
  });
});
