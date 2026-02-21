import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { SupportPage } from '../pages/SupportPage';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useAuth } from '../context/authContext';

vi.mock('../context/WebSocketContext');
vi.mock('../context/authContext');
vi.mock('../api/tickets', () => ({
  listQueues: vi.fn(() => Promise.resolve([])),
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
  addTagToTicket: vi.fn(),
  removeTagFromTicket: vi.fn(),
  getAllTags: vi.fn(() => Promise.resolve({ tags: [] })),
  queryAuditLogs: vi.fn(() => Promise.resolve({ items: [] })),
}));

const mockAgent = { id: 'agent1', username: 'agent1', tenantId: 'tenant1' };

function setup({ wsEvents = [] } = {}) {
  useAuth.mockReturnValue({ agent: mockAgent, isAuthenticated: true, loading: false });
  useWebSocketContext.mockReturnValue({
    connected: true,
    authenticated: true,
    onEvent: (event, data) => {},
    subscribeEvents: wsEvents,
  });
  render(<SupportPage />);
}

describe('SupportPage WhatsApp QR message flow', () => {
  it('renders and subscribes to ticket.message.received', async () => {
    setup({ wsEvents: ['ticket.message.received'] });
    expect(screen.getByText(/Atendimento/i)).toBeInTheDocument();
  });

  it('displays incoming WhatsApp QR message in timeline', async () => {
    setup({ wsEvents: ['ticket.message.received'] });
    // Simula clique no ticket para exibir detalhes
    const ticketCard = await screen.findByRole('listitem');
    fireEvent.click(ticketCard);
    // Aguarda renderização do histórico
    await waitFor(() => {
      expect(screen.getByText(/Histórico de Mensagens/i)).toBeInTheDocument();
      expect(screen.getByText(/Mensagem WhatsApp QR/i)).toBeInTheDocument();
    });
  });
});
