import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGetMyCompetencies = vi.fn();
const mockGetSkillGraph = vi.fn();
const mockRecompute = vi.fn();
const mockGetMyMissions = vi.fn();
const mockCompleteMission = vi.fn();
const mockGetSimulations = vi.fn();
const mockGetMyCertifications = vi.fn();
const mockEvaluateCertifications = vi.fn();
const mockGetMentorPlan = vi.fn();
const mockGenerateMentorPlan = vi.fn();
const mockGetAnalyticsOverview = vi.fn();
const mockGetManuals = vi.fn();
const mockGetReplays = vi.fn();
const mockGenerateManual = vi.fn();
const mockFetchManualImageBlob = vi.fn();

vi.mock('../api/academy', () => ({
  getMyCompetencies: (...args) => mockGetMyCompetencies(...args),
  getMyLearningProfile: vi.fn(),
  getSkillGraph: (...args) => mockGetSkillGraph(...args),
  recomputeCompetencies: (...args) => mockRecompute(...args),
  getMyMissions: (...args) => mockGetMyMissions(...args),
  completeMission: (...args) => mockCompleteMission(...args),
  getSimulations: (...args) => mockGetSimulations(...args),
  getMyCertifications: (...args) => mockGetMyCertifications(...args),
  evaluateCertifications: (...args) => mockEvaluateCertifications(...args),
  getMentorPlan: (...args) => mockGetMentorPlan(...args),
  generateMentorPlan: (...args) => mockGenerateMentorPlan(...args),
  getAnalyticsOverview: (...args) => mockGetAnalyticsOverview(...args),
  requestTutorHelp: vi.fn(),
  getManuals: (...args) => mockGetManuals(...args),
  getReplays: (...args) => mockGetReplays(...args),
  generateManualFromReplay: (...args) => mockGenerateManual(...args),
  fetchManualImageBlob: (...args) => mockFetchManualImageBlob(...args),
  fetchManualMarkdownBlob: vi.fn(async () => new Blob(['# manual'])),
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({ isAuthenticated: true, agent: { id: 'a1', username: 'qa', role: 'super_admin' } }),
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
    mockGetMyCertifications.mockResolvedValue({ certifications: [] });
    mockGetMentorPlan.mockResolvedValue({ plan: null });
    mockGetManuals.mockResolvedValue({ manuals: [] });
    mockGetReplays.mockResolvedValue({ replays: [] });
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

  it('tab Certificações lista certificações e avalia sob demanda', async () => {
    mockGetMyCertifications.mockResolvedValue({
      certifications: [
        {
          id: 'c1',
          skillKey: 'tickets',
          status: 'active',
          assessmentSnapshot: { criteria: { precisao: 0.95, autonomia: 0.9, recuperacao: null } },
          evidenceRefs: ['evt-9'],
          issuedAt: '2026-07-23T10:00:00Z',
        },
      ],
    });
    mockEvaluateCertifications.mockResolvedValue({ issued: [], revoked: [], active: [] });
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Certificações \(1\)/ }));

    await waitFor(() => expect(screen.getByTestId('certification-tickets')).toBeTruthy());
    expect(screen.getByTestId('certification-tickets').textContent).toContain('Ativa');
    expect(screen.getByTestId('certification-tickets').textContent).toContain('95%');

    fireEvent.click(screen.getByRole('button', { name: /Avaliar agora/i }));
    await waitFor(() => expect(mockEvaluateCertifications).toHaveBeenCalledTimes(1));
  });

  it('tab Plano de evolução exibe plano do mentor e gera novo', async () => {
    mockGetMentorPlan.mockResolvedValue({
      plan: {
        id: 'p1',
        generatedAt: '2026-07-23T12:00:00Z',
        aggregates: {
          windows: [
            { days: 7, events: 40, errors: 2, errorRate: 0.05, flowsCompleted: 3 },
            { days: 30, events: 150, errors: 10, errorRate: 0.0667, flowsCompleted: 12 },
            { days: 90, events: 400, errors: 30, errorRate: 0.075, flowsCompleted: 33 },
          ],
        },
        plan: {
          resumo: 'Bom desempenho geral.',
          competenciasSugeridas: [{ skill: 'crm', motivo: 'score baixo' }],
          objetivos: [{ descricao: 'Reduzir erros no CRM', prazoDias: 14 }],
          indicadores: [{ nome: 'taxa de erro', meta: '< 5%' }],
        },
      },
    });
    mockGenerateMentorPlan.mockResolvedValue({ id: 'p2', plan: {}, aggregates: {} });
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Plano de evolução/ }));

    await waitFor(() => expect(screen.getByText('Bom desempenho geral.')).toBeTruthy());
    expect(screen.getByText(/Últimos 7 dias/)).toBeTruthy();
    expect(screen.getByText(/Reduzir erros no CRM/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Gerar novo plano/i }));
    await waitFor(() => expect(mockGenerateMentorPlan).toHaveBeenCalledTimes(1));
  });

  it('tab Analytics (admin) carrega overview do tenant', async () => {
    mockGetAnalyticsOverview.mockResolvedValue({
      users: 4,
      avgScore: 0.61,
      skills: [{ skillKey: 'tickets', users: 3, avgScore: 0.7, activeCertifications: 2 }],
      missions: { total: 5, completed: 2 },
      certifications: { active: 3, revoked: 1 },
      simulations: { total: 7 },
      tutorHints30d: 9,
      roi: {
        windowDays: 30,
        current: { events: 100, errors: 5, errorRate: 0.05, medianNavigationMs: 4000 },
        previous: { events: 90, errors: 9, errorRate: 0.1, medianNavigationMs: 5200 },
        errorRateDelta: -0.05,
        navigationMsDelta: -1200,
      },
    });
    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Analytics$/ }));

    await waitFor(() => expect(screen.getByText(/4 com competências/)).toBeTruthy());
    expect(screen.getByText(/3 ativas · 1 revogadas/)).toBeTruthy();
    expect(screen.getByText(/10% → 5%/)).toBeTruthy();
  });

  it('tab Manuais lista manuais e admin gera a partir de replay', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    const manual = {
      id: 'manual-1',
      title: 'Manual — jornada core.support_ticket_flow',
      tenantId: 'system',
      replayId: 'wave-1',
      journeyKey: 'core.support_ticket_flow',
      createdAt: '2026-07-24T12:00:00.000Z',
      stepCount: 2,
      imageCount: 1,
      steps: [
        { order: 1, action: 'click', label: 'Clicar', name: 'Abrir Caixa de Entrada', success: true, image: 'img/01.png' },
        { order: 2, action: 'fill', label: 'Preencher campo', name: 'Escrever nota', success: true, image: null },
      ],
    };
    mockGetManuals.mockResolvedValue({ manuals: [manual] });
    mockGetReplays.mockResolvedValue({
      replays: [{ id: 'wave-1', actions: 12, screens: 2, errors: 0, startTime: '2026-07-24T12:00:00.000Z' }],
    });
    mockGenerateManual.mockResolvedValue({ ...manual, id: 'manual-2', title: 'Manual — jornada core.support_ticket_flow' });
    mockFetchManualImageBlob.mockResolvedValue(new Blob(['png']));

    render(<AcademyPage />);

    await waitFor(() => expect(screen.getByTestId('skill-card-tickets')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Manuais$/ }));

    // manual existente listado
    await waitFor(() => expect(screen.getByTestId('manual-manual-1')).toBeTruthy());
    expect(screen.getByText(/2 passo\(s\) · 1 tela\(s\)/)).toBeTruthy();

    // gerador (admin) com replay selecionado
    await waitFor(() => expect(screen.getByTestId('manual-generator')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Gerar manual' }));
    await waitFor(() => expect(mockGenerateManual).toHaveBeenCalledWith('wave-1', undefined));
    await waitFor(() => expect(screen.getByTestId('manual-manual-2')).toBeTruthy());

    // expandir exibe passos e carrega imagem via blob autenticado
    fireEvent.click(screen.getAllByRole('button', { name: 'Visualizar' })[0]);
    await waitFor(() => expect(screen.getByText(/Passo 1 — Abrir Caixa de Entrada/)).toBeTruthy());
    await waitFor(() => expect(mockFetchManualImageBlob).toHaveBeenCalledWith('manual-2', 'img/01.png'));
  });
});
