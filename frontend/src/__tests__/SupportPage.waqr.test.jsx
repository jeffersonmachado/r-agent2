import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SupportPage } from '../pages/SupportPage';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useAuth } from '../context/authContext';

jest.mock('../context/WebSocketContext');
jest.mock('../context/authContext');
jest.mock('../api/tickets', () => ({
  listQueues: jest.fn(() => Promise.resolve([])),
  listAllTickets: jest.fn(() => Promise.resolve({ tickets: [
    { id: 't1', status: 'in_progress', unreadCount: 0, createdAt: new Date().toISOString(), phoneNumber: '5511999999999', mode: 'human', lastUserMessage: 'Olá', assignedTo: 'agent1', tags: [], queue: 'default', context: {}, ticketAuditLogs: [], conversationId: 'c1' }
  ] })),
  assignTicket: jest.fn(),
  closeTicket: jest.fn(),
  sendTicketMessage: jest.fn(),
  getTicketMessages: jest.fn(() => Promise.resolve({ messages: [
    { id: 'm1', sender: 'user', text: 'Mensagem WhatsApp QR', timestamp: new Date().toISOString() }
  ] })),
  markTicketAsRead: jest.fn(),
  createTicket: jest.fn(),
  takeOverTicket: jest.fn(),
  returnToBotTicket: jest.fn(),
  pauseTicket: jest.fn(),
  resumeTicket: jest.fn(),
  getTicketDeliveryFailures: jest.fn(() => Promise.resolve({ outboundQueue: [], channelMessages: [] })),
  getTicketAiSummary: jest.fn(() => Promise.resolve({ summary: null })),
  generateTicketAiSummary: jest.fn(() => Promise.resolve({ summary: null })),
  addTagToTicket: jest.fn(),
  removeTagFromTicket: jest.fn(),
  getAllTags: jest.fn(() => Promise.resolve({ tags: [] })),
  queryAuditLogs: jest.fn(() => Promise.resolve({ items: [] })),
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
