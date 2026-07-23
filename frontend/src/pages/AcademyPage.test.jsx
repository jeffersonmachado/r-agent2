import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGetMyCompetencies = vi.fn();
const mockGetSkillGraph = vi.fn();
const mockRecompute = vi.fn();
const mockGetMyMissions = vi.fn();
const mockCompleteMission = vi.fn();
const mockGetSimulations = vi.fn();

vi.mock('../api/academy', () => ({
  getMyCompetencies: (...args) => mockGetMyCompetencies(...args),
  getMyLearningProfile: vi.fn(),
  getSkillGraph: (...args) => mockGetSkillGraph(...args),
  recomputeCompetencies: (...args) => mockRecompute(...args),
  getMyMissions: (...args) => mockGetMyMissions(...args),
  completeMission: (...args) => mockCompleteMission(...args),
  getSimulations: (...args) => mockGetSimulations(...args),
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({ isAuthenticated: true, agent: { id: 'a1', username: 'qa' } }),
}));

import { AcademyPage } from './AcademyPage';

const competenciesPayload = {
  agentId: 'a1',
  computedAt: '2026-07-23T17:00:00.000Z',
  competencies: [
    {
      skillKey: 'tickets',
      score: 0.82,
      components: { precision: 0.9, coverage: 0.7, tempo: 0.8, autonomia: 0.9, consistencia: 0.6 },
      evidenceRefs: ['evt-1', 'evt-2'],
      eventCount: 25,
      firstSeenAt: '2026-07-20T10:00:00.000Z',
      lastSeenAt: '2026-07-23T15:00:00.000Z',
    },
    {
      skillKey: 'crm',
      score: 0.3,
      components: { precision: 0.4, coverage: 0.2, tempo: null, autonomia: null, consistencia: null },
      evidenceRefs: [],
      eventCount: 8,
      firstSeenAt: '2026-07-22T10:00:00.000Z',
      lastSeenAt: '2026-07-23T12:00:00.000Z',
    },
  ],
  profile: {
    dominantSkills: [{ skillKey: 'tickets', score: 0.82, eventCount: 25 }],
    weakSkills: [{ skillKey: 'crm', score: 0.3, eventCount: 8 }],
    totals: { skills: 2, events: 33, averageScore: 0.56 },
  },
};

describe('AcademyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyCompetencies.mockResolvedValue(competenciesPayload);
    mockGetMyMissions.mockResolvedValue({ missions: [] });
    mockGetSimulations.mockResolvedValue({ simulations: [] });
    mockGetSkillGraph.mockResolvedValue({
      skills: [
        { key: 'tickets', label: 'tickets' },
        { key: 'crm', label: 'crm' },
      ],
    });
  });

  it('renderiza competências reais do usuário com score e componentes', async () => {
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    expect(screen.getByTestId('skill-card-crm')).toBeTruthy();

    const ticketsCard = screen.getByTestId('skill-card-tickets');
    expect(ticketsCard.textContent).toContain('82%');
    expect(ticketsCard.textContent).toContain('25 interações');
    expect(ticketsCard.textContent).toContain('Precisão');
    expect(ticketsCard.textContent).toContain('90%');

    // componentes null exibem placeholder
    const crmCard = screen.getByTestId('skill-card-crm');
    expect(crmCard.textContent).toContain('—');
  });

  it('exibe perfil com skills dominantes e em desenvolvimento', async () => {
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByText('Domina')).toBeTruthy());
    expect(screen.getByText('Em desenvolvimento')).toBeTruthy();
    expect(screen.getByText(/2 skill\(s\) observadas · 33 interações/)).toBeTruthy();
  });

  it('botão recalcular chama recompute e recarrega', async () => {
    mockRecompute.mockResolvedValue({ eventsProcessed: 33 });
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Recalcular agora/i }));

    await waitFor(() => expect(mockRecompute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetMyCompetencies).toHaveBeenCalledTimes(2));
  });

  it('falha do skill-graph não derruba a página', async () => {
    mockGetSkillGraph.mockRejectedValue(new Error('404'));
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
  });

  it('tab Missões lista missões e conclui sob demanda', async () => {
    mockGetMyMissions.mockResolvedValue({
      missions: [
        { id: 'm1', title: 'Treinamento: jornada X', summary: '10 passos', status: 'available', createdAt: '2026-07-23T10:00:00Z' },
        { id: 'm2', title: 'Treinamento: jornada Y', summary: null, status: 'completed', completedAt: '2026-07-23T11:00:00Z', createdAt: '2026-07-22T10:00:00Z' },
      ],
    });
    mockCompleteMission.mockResolvedValue({ id: 'm1', status: 'completed' });
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Missões \(1\)/ }));

    await waitFor(() => expect(screen.getByTestId('mission-m1')).toBeTruthy());
    expect(screen.getByTestId('mission-m2').textContent).toContain('Concluída ✓');

    fireEvent.click(screen.getByRole('button', { name: /Marcar como concluída/i }));
    await waitFor(() => expect(mockCompleteMission).toHaveBeenCalledWith('m1'));
  });

  it('tab Simulações lista cenários gerados', async () => {
    mockGetSimulations.mockResolvedValue({
      simulations: [
        { id: 's1', journeyKey: 'booking_flow', seedType: 'happy_path', personaKey: 'cliente_vip', descricao: 'Simulacao...', steps: 5, aiEnriched: true, createdAt: '2026-07-23T10:00:00Z' },
      ],
    });
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Simulações \(1\)/ }));

    await waitFor(() => expect(screen.getByTestId('simulation-s1')).toBeTruthy());
    expect(screen.getByTestId('simulation-s1').textContent).toContain('happy_path');
    expect(screen.getByTestId('simulation-s1').textContent).toContain('enriquecida por IA');
  });
});
