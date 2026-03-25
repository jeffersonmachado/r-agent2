import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, beforeEach, describe, it } from 'vitest';
import { SupportPage } from '../pages/SupportPage';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useAuth } from '../context/authContext';
import * as ticketsApi from '../api/tickets';

const { scheduleModalMock } = vi.hoisted(() => ({
  scheduleModalMock: vi.fn(),
}));
const { listQuickRepliesMock, searchQuickRepliesMock, useQuickReplyMock } = vi.hoisted(() => ({
  listQuickRepliesMock: vi.fn(() => Promise.resolve({
    quickReplies: [
      { id: 'qr-1', title: 'Saudação', message: 'Olá! Como posso ajudar?' },
      { id: 'qr-2', title: 'Aguardo', message: 'Vou verificar e retorno em instantes.' },
    ],
  })),
  searchQuickRepliesMock: vi.fn(() => Promise.resolve({ quickReplies: [] })),
  useQuickReplyMock: vi.fn(() => Promise.resolve({ ok: true })),
}));
const { listSchedulesMock } = vi.hoisted(() => ({
  listSchedulesMock: vi.fn(() => Promise.resolve({ items: [] })),
}));
const { showToastMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
}));

vi.mock('../context/WebSocketContext');
vi.mock('../context/authContext');
vi.mock('../components/ScheduleModal', () => ({
  ScheduleModal: (props) => {
    scheduleModalMock(props);
    return <div data-testid="schedule-modal-mock">{props?.title || 'schedule-modal'}</div>;
  },
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    removeToast: vi.fn(),
    clearAllToasts: vi.fn(),
    ToastContainer: () => null,
  }),
}));
vi.mock('../hooks/usePhoneMasking', () => ({
  usePhoneMasking: () => ({ enabled: false }),
}));
vi.mock('../api/tickets', () => ({
  listQueues: vi.fn(() => Promise.resolve([])),
  listTicketsPaged: vi.fn(() => Promise.resolve({
    items: [
      { id: 't1', status: 'in_progress', unreadCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), phoneNumber: '5511999999999', mode: 'human', lastUserMessage: 'Olá', assignedTo: 'agent1', tags: [], queue: 'default', context: {}, ticketAuditLogs: [], conversationId: 'c1' }
    ],
    nextCursor: null,
    hasMore: false,
  })),
  listAllTickets: vi.fn(() => Promise.resolve({ tickets: [
    { id: 't1', status: 'in_progress', unreadCount: 0, createdAt: new Date().toISOString(), phoneNumber: '5511999999999', mode: 'human', lastUserMessage: 'Olá', assignedTo: 'agent1', tags: [], queue: 'default', context: {}, ticketAuditLogs: [], conversationId: 'c1' }
  ] })),
  assignTicket: vi.fn(),
  closeTicket: vi.fn(),
  sendTicketMessage: vi.fn(),
  getTicketMessages: vi.fn(() => Promise.resolve({ messages: [
    { id: 'm1', sender: 'user', text: 'Mensagem WhatsApp QR', timestamp: new Date().toISOString() }
  ] })),
  markTicketAsRead: vi.fn(),
  createTicket: vi.fn(),
  takeOverTicket: vi.fn(),
  returnToBotTicket: vi.fn(),
  pauseTicket: vi.fn(),
  resumeTicket: vi.fn(),
  getTicketDeliveryFailures: vi.fn(() => Promise.resolve({ outboundQueue: [], channelMessages: [] })),
  getTicketAiSummary: vi.fn(() => Promise.resolve({ summary: null })),
  generateTicketAiSummary: vi.fn(() => Promise.resolve({ summary: null })),
  uploadSupportMedia: vi.fn(() => Promise.resolve({ url: '/tickets/media/tm-fake', fileName: 'fake.txt', mimeType: 'text/plain', sizeBytes: 1 })),
  debugExtractEntities: vi.fn(() => Promise.resolve({})),
  suggestSupportTags: vi.fn(() => Promise.resolve({ tags: [] })),
  suggestSupportSentiment: vi.fn(() => Promise.resolve({ sentiment: null })),
  addTagToTicket: vi.fn(),
  removeTagFromTicket: vi.fn(),
  getAllTags: vi.fn(() => Promise.resolve({ tags: [] })),
  queryAuditLogs: vi.fn(() => Promise.resolve({ items: [] })),
}));
vi.mock('../api/quickReplies', () => ({
  listQuickReplies: (...args) => listQuickRepliesMock(...args),
  searchQuickReplies: (...args) => searchQuickRepliesMock(...args),
  useQuickReply: (...args) => useQuickReplyMock(...args),
  getCategories: vi.fn(() => Promise.resolve({ categories: [] })),
}));
vi.mock('../api/scheduling', () => ({
  listSchedules: (...args) => listSchedulesMock(...args),
  confirmSchedule: vi.fn(() => Promise.resolve({ ok: true })),
  cancelSchedule: vi.fn(() => Promise.resolve({ ok: true })),
  rescheduleSchedule: vi.fn(() => Promise.resolve({ ok: true })),
  markScheduleDone: vi.fn(() => Promise.resolve({ ok: true })),
  markScheduleNoShow: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock('../api/segmentation', () => ({
  addTagToTicket: vi.fn(() => Promise.resolve({ ok: true })),
  removeTagFromTicket: vi.fn(() => Promise.resolve({ ok: true })),
  getAllTags: vi.fn(() => Promise.resolve({ tags: [] })),
}));
vi.mock('../api/audit', () => ({
  queryAuditLogs: vi.fn(() => Promise.resolve({ items: [] })),
}));
vi.mock('../api/conversations', () => ({
  getConversationMessages: vi.fn(() => Promise.resolve({ messages: [] })),
}));
vi.mock('../api/evidence', () => ({
  getEvidenceEntityHistory: vi.fn(() => Promise.resolve({ identity: null, timeline: [], evidence: null })),
  searchEvidence: vi.fn(() => Promise.resolve({ ok: true, identity: null, best: null, alternatives: [], reasoning: { matchedBy: [], score: 0 } })),
  contextualSearchEvidence: vi.fn(() => Promise.resolve({ ok: true, identity: null, best: null, alternatives: [], timeline: [], reasoning: { matchedBy: [], score: 0 } })),
}));
vi.mock('../api/closeReasons', () => ({
  listCloseReasons: vi.fn(() => Promise.resolve({ closeReasons: [] })),
}));
vi.mock('../api/auth', () => ({
  getAgentNameById: vi.fn(() => Promise.resolve('agent1')),
}));

const mockAgent = { id: 'agent1', username: 'agent1', tenantId: 'tenant1' };

async function setup({ wsEvents = [] } = {}) {
  useAuth.mockReturnValue({ agent: mockAgent, isAuthenticated: true, loading: false });
  useWebSocketContext.mockReturnValue({
    connected: true,
    authenticated: true,
    onEvent: (event, data) => {},
    subscribeEvents: wsEvents,
  });
  render(<SupportPage />);

  // Aguarda o estado inicial assíncrono para evitar updates fora de act
  await screen.findByRole('heading', { name: /Atendimento/i });
  await screen.findByText(/5511999999999/i);
}

function getTicketRow() {
  return screen.getByText(/5511999999999/i).closest('.support-ticket-card');
}

describe('SupportPage WhatsApp QR message flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleModalMock.mockClear();
    listQuickRepliesMock.mockClear();
    searchQuickRepliesMock.mockClear();
    useQuickReplyMock.mockClear();
    listSchedulesMock.mockReset();
    listSchedulesMock.mockResolvedValue({ items: [] });
    showToastMock.mockClear();
  });

  it('renders and subscribes to ticket.message.received', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    expect(screen.getByRole('heading', { name: /Atendimento/i })).toBeInTheDocument();
  });

  it('displays incoming WhatsApp QR message in timeline', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    // Simula clique no ticket para exibir detalhes
    const ticketCard = getTicketRow();
    fireEvent.click(ticketCard);
    // Aguarda renderização do histórico
    await waitFor(() => {
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
  });

  it('processa o comando /agendar sem quebrar o fluxo do ticket', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    fireEvent.change(composer, { target: { value: '/agendar' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
    expect(composer).toBeInTheDocument();
  });

  it('mantém o fluxo estável ao tentar agendamento pelo ticket', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const button = screen.queryByRole('button', { name: /Agendar contato para este ticket/i });
    if (button) {
      fireEvent.click(button);
    } else {
      const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
      fireEvent.change(composer, { target: { value: '/agendar' } });
      fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });
    }

    await waitFor(() => {
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Contato/i).length).toBeGreaterThan(0);
  });

  it('abre lista de respostas rápidas com comando /resposta-rapida', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    fireEvent.change(composer, { target: { value: '/resposta-rapida' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(listQuickRepliesMock).toHaveBeenCalled();
      expect(screen.getByText('Saudação')).toBeInTheDocument();
      expect(screen.getByText('Aguardo')).toBeInTheDocument();
    });
  });

  it('abre lista de respostas rápidas ao clicar no comando /resposta-rapida no menu slash', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    fireEvent.change(composer, { target: { value: '/re' } });

    const command = screen.queryByText('/resposta-rapida');
    if (command) {
      fireEvent.mouseDown(command);
    } else {
      fireEvent.change(composer, { target: { value: '/resposta-rapida' } });
      fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });
    }

    await waitFor(() => {
      expect(listQuickRepliesMock).toHaveBeenCalled();
      expect(screen.getByText('Saudação')).toBeInTheDocument();
      expect(screen.getByText('Aguardo')).toBeInTheDocument();
    });
  });

  it('navega no menu slash com seta para baixo e executa item selecionado no Enter', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    fireEvent.change(composer, { target: { value: '/' } });

    await waitFor(() => {
      expect(screen.getByText('/devolver-bot')).toBeInTheDocument();
      expect(screen.getByText('/pausar')).toBeInTheDocument();
    });

    fireEvent.keyDown(composer, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(ticketsApi.pauseTicket).toHaveBeenCalledWith('t1', 'outside_window');
    });
  });

  it('mantém estabilidade quando há dados de agendamento disponíveis', async () => {
    listSchedulesMock.mockResolvedValueOnce({
      items: [
        {
          id: 'sch-1',
          purpose: 'retorno',
          status: 'scheduled',
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 30 * 60000).toISOString(),
          requiresConfirmation: true,
          confirmationStatus: 'pending',
        },
      ],
    });

    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    await waitFor(() => {
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
  });

  it('mantém o composer estável ao receber paste de imagem', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    const imageFile = new File(['fake-image'], 'print.png', { type: 'image/png' });
    const getAsFile = vi.fn(() => imageFile);

    fireEvent.paste(composer, {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile },
        ],
      },
    });

    await waitFor(() => {
      expect(composer).toBeInTheDocument();
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
    expect(getAsFile).not.toHaveBeenCalled();
    expect(ticketsApi.uploadSupportMedia).not.toHaveBeenCalled();
  });

  it('envia texto normalmente mesmo após paste de imagem sem suporte a anexo', async () => {
    ticketsApi.uploadSupportMedia.mockResolvedValueOnce({
      url: '/tickets/media/tm-123',
      fileName: 'print.png',
      mimeType: 'image/png',
      sizeBytes: 10,
    });

    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    const imageFile = new File(['fake-image'], 'print.png', { type: 'image/png' });
    const getAsFile = vi.fn(() => imageFile);

    fireEvent.paste(composer, {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
    expect(getAsFile).not.toHaveBeenCalled();
    expect(ticketsApi.uploadSupportMedia).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: 'Segue imagem' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13, ctrlKey: true });

    await waitFor(() => {
      expect(ticketsApi.sendTicketMessage).toHaveBeenCalled();
    });

    const lastCall = ticketsApi.sendTicketMessage.mock.calls.at(-1);
    expect(lastCall[0]).toBe('t1');
    expect(lastCall[1]).toBe('Segue imagem');
    expect(lastCall[2] || {}).not.toHaveProperty('mediaUrl');
  });

  it('envia mensagem normalmente quando nao ha acao explicita de reply', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(getTicketRow());

    const composer = await screen.findByLabelText(/(Campo para digitar mensagem|Enviar mensagem)/i);
    fireEvent.change(composer, { target: { value: 'Resposta teste' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13, ctrlKey: true });

    await waitFor(() => {
      expect(ticketsApi.sendTicketMessage).toHaveBeenCalled();
    });

    const lastCall = ticketsApi.sendTicketMessage.mock.calls.at(-1);
    expect(lastCall[0]).toBe('t1');
    expect(lastCall[1]).toBe('Resposta teste');
    expect(lastCall[2] || {}).not.toHaveProperty('replyTo');
  });
});
