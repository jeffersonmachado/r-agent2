import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  agent: { id: 'a1', username: 'qa', role: 'operator' },
  getJourneyFaqSummary: vi.fn(),
  getJourneyFaq: vi.fn(),
}));

vi.mock('../../api/academy', () => ({
  getJourneyFaqSummary: (...args) => mocks.getJourneyFaqSummary(...args),
  getJourneyFaq: (...args) => mocks.getJourneyFaq(...args),
  generateJourneyFaq: vi.fn(),
  setJourneyFaqStatus: vi.fn(),
}));

vi.mock('../../context/authContext', () => ({
  useAuth: () => ({ isAuthenticated: true, agent: mocks.agent }),
}));

import { JourneyFaqTab, resolveAgentClassification, canViewInternalSources } from './JourneyFaqTab';

const faqItem = {
  id: 'faq-1',
  journeyKey: 'support_ticket_flow',
  category: 'pre_condicoes',
  question: 'Quais pré-condições são necessárias?',
  answer: 'Obrigatórias: authenticated_agent.',
  sources: ['config/journey-preconditions.json'],
  status: 'included',
  current: true,
  createdAt: '2026-07-24T12:00:00.000Z',
};

describe('JourneyFaqTab — segregação de fontes internas (HARD-014)', () => {
  beforeEach(() => {
    mocks.getJourneyFaqSummary.mockResolvedValue({
      journeys: [{ journeyKey: 'support_ticket_flow', total: 1, suggested: 0, included: 1, excluded: 0 }],
    });
    mocks.getJourneyFaq.mockResolvedValue({ journeyKey: 'support_ticket_flow', items: [faqItem] });
  });

  it('PRODUCTION (role operacional) não vê as fontes internas de evidência', async () => {
    mocks.agent = { id: 'a1', username: 'op', role: 'operator' };
    render(<JourneyFaqTab isAdmin={false} />);

    await waitFor(() => expect(screen.getByTestId('faq-faq-1')).toBeTruthy());
    expect(screen.getByText(/authenticated_agent/)).toBeTruthy();
    expect(screen.queryByText(/journey-preconditions\.json/)).toBeNull();
  });

  it('SUPPORT (auditor) vê as fontes internas', async () => {
    mocks.agent = { id: 'a2', username: 'au', role: 'auditor' };
    render(<JourneyFaqTab isAdmin={false} />);

    await waitFor(() => expect(screen.getByTestId('faq-faq-1')).toBeTruthy());
    expect(screen.getByText(/journey-preconditions\.json/)).toBeTruthy();
  });

  it('DEVELOPMENT (super_admin) vê as fontes internas', async () => {
    mocks.agent = { id: 'a3', username: 'sa', role: 'super_admin' };
    render(<JourneyFaqTab isAdmin={true} />);

    await waitFor(() => expect(screen.getByTestId('faq-faq-1')).toBeTruthy());
    expect(screen.getByText(/journey-preconditions\.json/)).toBeTruthy();
  });
});

describe('JourneyFaqTab — helpers de classificação (lógica pura)', () => {
  it('resolveAgentClassification espelha a política do backend', () => {
    expect(resolveAgentClassification({ role: 'super_admin' })).toBe('DEVELOPMENT');
    expect(resolveAgentClassification({ role: 'auditor' })).toBe('SUPPORT');
    expect(resolveAgentClassification({ role: 'admin' })).toBe('PRODUCTION');
    expect(resolveAgentClassification({ role: 'owner' })).toBe('PRODUCTION');
    expect(resolveAgentClassification({ role: 'operator' })).toBe('PRODUCTION');
    expect(resolveAgentClassification(null)).toBe('PRODUCTION');
  });

  it('canViewInternalSources libera apenas SUPPORT/DEVELOPMENT', () => {
    expect(canViewInternalSources({ role: 'auditor' })).toBe(true);
    expect(canViewInternalSources({ role: 'super_admin' })).toBe(true);
    expect(canViewInternalSources({ role: 'operator' })).toBe(false);
    expect(canViewInternalSources({ role: 'admin' })).toBe(false);
  });
});
