import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, beforeEach } from 'vitest';
import { SupportPage } from '../pages/SupportPage';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useAuth } from '../context/authContext';

vi.mock('../context/WebSocketContext');
vi.mock('../context/authContext');
vi.mock('../hooks/usePhoneMasking', () => ({
  usePhoneMasking: () => ({ enabled: false }),
}));
vi.mock('../api/tickets', () => ({
  listQueues: vi.fn(() => Promise.resolve([])),
  listAllTickets: vi.fn(() => Promise.resolve({ tickets: [
    {
      id: 't1',
      status: 'in_progress',
      unreadCount: 0,
      createdAt: new Date('2026-03-20T10:00:00Z').toISOString(),
      updatedAt: new Date('2026-03-20T10:05:00Z').toISOString(),
      phoneNumber: '5511999999999',
      mode: 'human',
      lastUserMessage: 'Cliente questiona reajuste do plano',
      assignedTo: 'agent1',
      tags: [],
      queue: 'default',
      context: {},
      ticketAuditLogs: [],
      conversationId: 'c1',
    },
  ] })),
  assignTicket: vi.fn(),
  closeTicket: vi.fn(),
  sendTicketMessage: vi.fn(),
  getTicketMessages: vi.fn(() => Promise.resolve({ messages: [] })),
  markTicketAsRead: vi.fn(),
  createTicket: vi.fn(),
  takeOverTicket: vi.fn(),
  returnToBotTicket: vi.fn(),
  pauseTicket: vi.fn(),
  resumeTicket: vi.fn(),
  getTicketDeliveryFailures: vi.fn(() => Promise.resolve({ outboundQueue: [], channelMessages: [] })),
  getTicketAiSummary: vi.fn(() => Promise.resolve({ summary: null })),
  generateTicketAiSummary: vi.fn(() => Promise.resolve({ summary: null })),
}));
vi.mock('../api/conversations', () => ({
  getConversationMessages: vi.fn(() => Promise.resolve({ messages: [] })),
}));
vi.mock('../api/quickReplies', () => ({
  listQuickReplies: vi.fn(() => Promise.resolve({ quickReplies: [] })),
  searchQuickReplies: vi.fn(() => Promise.resolve({ quickReplies: [] })),
  useQuickReply: vi.fn(() => Promise.resolve({ ok: true })),
  getCategories: vi.fn(() => Promise.resolve({ categories: [] })),
}));
vi.mock('../api/closeReasons', () => ({
  listCloseReasons: vi.fn(() => Promise.resolve({ closeReasons: [] })),
}));
vi.mock('../api/segmentation', () => ({
  addTagToTicket: vi.fn(() => Promise.resolve({ ok: true })),
  removeTagFromTicket: vi.fn(() => Promise.resolve({ ok: true })),
  getAllTags: vi.fn(() => Promise.resolve({ tags: [] })),
}));
vi.mock('../api/audit', () => ({
  queryAuditLogs: vi.fn(() => Promise.resolve({ items: [] })),
}));
vi.mock('../api/evidence', () => ({
  getEvidenceEntityHistory: vi.fn(() => Promise.resolve({
    identity: {
      entityType: 'customer',
      entityId: 'cust-123',
      confidence: 0.96,
      sources: [{ type: 'ticket', id: 't1', field: 'phone' }],
      relatedEntities: [{ type: 'conversation', id: 'c1' }],
    },
    timeline: [],
    evidence: null,
  })),
  searchEvidence: vi.fn(() => Promise.resolve({
    ok: true,
    identity: {
      entityType: 'customer',
      entityId: 'cust-123',
      confidence: 0.96,
      sources: [],
      relatedEntities: [],
    },
    best: {
      id: 'evd-1',
      category: 'billing',
      type: 'price_notice',
      theme: 'price_adjustment',
      occurred_at: '2026-02-10T12:00:00.000Z',
      source_type: 'channel_message',
      excerpt: 'Informamos anteriormente o reajuste previsto em contrato.',
      summary: 'price notice identificado em channel_message',
      confidence: 0.92,
      strength: 'strong',
      source_ref: { ticketId: 't1', conversationId: 'c1' },
      reasoning: { matchedBy: ['theme_exact', 'text_overlap'], score: 92 },
    },
    alternatives: [],
    reasoning: { matchedBy: ['theme_exact', 'text_overlap'], score: 92 },
  })),
}));
vi.mock('../api/auth', () => ({
  getAgentNameById: vi.fn(() => Promise.resolve('agent1')),
}));

describe('SupportPage evidence integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      agent: { id: 'agent1', username: 'agent1', tenantId: 'tenant1' },
      isAuthenticated: true,
      loading: false,
    });
    useWebSocketContext.mockReturnValue({
      connected: true,
      authenticated: true,
      subscribeEvents: [],
    });
  });

  it('renderiza blocos de entidade e evidência sem quebrar o fluxo atual', async () => {
    render(<SupportPage />);
    const ticketCard = (await screen.findByText(/5511999999999/i)).closest('tr');
    fireEvent.click(ticketCard);

    await waitFor(() => {
      expect(screen.getByText(/Entidade resolvida/i)).toBeInTheDocument();
      expect(screen.getByText(/customer/i)).toBeInTheDocument();
      expect(screen.getByText(/Evidências relacionadas/i)).toBeInTheDocument();
      expect(screen.getByText(/price notice/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Informamos anteriormente o reajuste previsto em contrato./i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Resposta sugerida/i)).toBeInTheDocument();
    });
  });
});
