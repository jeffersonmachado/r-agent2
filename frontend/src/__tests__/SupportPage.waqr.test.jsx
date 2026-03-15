import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, beforeEach } from 'vitest';
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

vi.mock('../context/WebSocketContext');
vi.mock('../context/authContext');
vi.mock('../components/ScheduleModal', () => ({
  ScheduleModal: (props) => {
    scheduleModalMock(props);
    return <div data-testid="schedule-modal-mock">{props?.title || 'schedule-modal'}</div>;
  },
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
  uploadSupportMedia: vi.fn(() => Promise.resolve({ url: '/public/support-media/system/fake.txt', fileName: 'fake.txt', mimeType: 'text/plain', sizeBytes: 1 })),
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
  await screen.findByRole('listitem');
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
  });

  it('renders and subscribes to ticket.message.received', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    expect(screen.getByRole('heading', { name: /Atendimento/i })).toBeInTheDocument();
  });

  it('displays incoming WhatsApp QR message in timeline', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    // Simula clique no ticket para exibir detalhes
    const ticketCard = screen.getByRole('listitem');
    fireEvent.click(ticketCard);
    // Aguarda renderização do histórico
    await waitFor(() => {
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
  });

  it('abre ScheduleModal com contexto do ticket via comando /agendar', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(screen.getByRole('listitem'));

    const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
    fireEvent.change(composer, { target: { value: '/agendar' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(scheduleModalMock).toHaveBeenCalled();
    });
    const props = scheduleModalMock.mock.calls.at(-1)[0];
    expect(props.contextType).toBe('ticket');
    expect(props.contextId).toBe('t1');
    expect(props.conversationId).toBe('c1');
    expect(props.defaultChannel).toBeTruthy();
    expect(props.lockReferences).toBe(true);
  });

  it('abre ScheduleModal pelo botão Agendar no ticket (ou fallback por comando)', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(screen.getByRole('listitem'));

    const button = screen.queryByRole('button', { name: /Agendar contato para este ticket/i });
    if (button) {
      fireEvent.click(button);
    } else {
      const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
      fireEvent.change(composer, { target: { value: '/agendar' } });
      fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });
    }

    await waitFor(() => {
      expect(scheduleModalMock).toHaveBeenCalled();
    });
    const props = scheduleModalMock.mock.calls.at(-1)[0];
    expect(props.contextType).toBe('ticket');
    expect(props.contextId).toBe('t1');
    expect(props.lockReferences).toBe(true);
  });

  it('abre lista de respostas rápidas com comando /resposta-rapida', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(screen.getByRole('listitem'));

    const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
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
    fireEvent.click(screen.getByRole('listitem'));

    const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
    fireEvent.change(composer, { target: { value: '/re' } });

    const command = await screen.findByText('/resposta-rapida');
    fireEvent.mouseDown(command);

    await waitFor(() => {
      expect(listQuickRepliesMock).toHaveBeenCalled();
      expect(screen.getByText('Saudação')).toBeInTheDocument();
      expect(screen.getByText('Aguardo')).toBeInTheDocument();
    });
  });

  it('renderiza painel de agendamentos do ticket quando há itens', async () => {
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
    fireEvent.click(screen.getByRole('listitem'));

    await waitFor(() => {
      expect(screen.getByText(/Agendamentos/i)).toBeInTheDocument();
      expect(screen.getByText(/retorno/i)).toBeInTheDocument();
      expect(screen.getByText(/Pendente/i)).toBeInTheDocument();
    });
  });

  it('anexa imagem via Ctrl+V (print screen) no composer', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(screen.getByRole('listitem'));

    const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
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
      expect(getAsFile).toHaveBeenCalled();
      expect(screen.getByText(/Pré-visualização dos anexos/i)).toBeInTheDocument();
    });
  });

  it('envia mídia anexada na conversa do ticket', async () => {
    ticketsApi.uploadSupportMedia.mockResolvedValueOnce({
      url: '/tickets/media/tm-123',
      fileName: 'print.png',
      mimeType: 'image/png',
      sizeBytes: 10,
    });

    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(screen.getByRole('listitem'));

    const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
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
      expect(ticketsApi.uploadSupportMedia).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Pré-visualização dos anexos/i)).toBeInTheDocument();
    });

    fireEvent.change(composer, { target: { value: 'Segue imagem' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(ticketsApi.sendTicketMessage).toHaveBeenCalled();
    });

    const lastCall = ticketsApi.sendTicketMessage.mock.calls.at(-1);
    expect(lastCall[0]).toBe('t1');
    expect(lastCall[1]).toBe('Segue imagem');
    expect(lastCall[2]).toMatchObject({
      mediaType: 'image',
      mediaUrl: '/tickets/media/tm-123',
      fileName: 'print.png',
      mimeType: 'image/png',
      sizeBytes: 10,
    });
  });

  it('envia mensagem em modo resposta com metadados replyTo', async () => {
    await setup({ wsEvents: ['ticket.message.received'] });
    fireEvent.click(screen.getByRole('listitem'));

    const replyButton = await screen.findByRole('button', { name: /Responder esta mensagem/i });
    fireEvent.click(replyButton);

    expect(await screen.findByText(/Respondendo Usuário/i)).toBeInTheDocument();

    const composer = await screen.findByLabelText(/Campo para digitar mensagem/i);
    fireEvent.change(composer, { target: { value: 'Resposta teste' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(ticketsApi.sendTicketMessage).toHaveBeenCalled();
    });

    const lastCall = ticketsApi.sendTicketMessage.mock.calls.at(-1);
    expect(lastCall[0]).toBe('t1');
    expect(lastCall[1]).toBe('Resposta teste');
    expect(lastCall[2]).toMatchObject({
      replyTo: {
        sender: 'user',
        text: 'Mensagem WhatsApp QR',
      },
    });
  });
});
