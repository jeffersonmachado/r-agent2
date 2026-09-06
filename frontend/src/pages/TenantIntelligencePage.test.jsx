import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TenantIntelligencePage } from './TenantIntelligencePage';

const testDoubles = vi.hoisted(() => ({
  toast: { showToast: vi.fn() },
  router: { navigate: vi.fn() },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ currentPath: '/intelligence', navigate: testDoubles.router.navigate }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: testDoubles.toast.showToast, ToastContainer: () => null }),
}));

vi.mock('../api/intelligence', () => ({
  applyTenantRecommendation: vi.fn(),
  dismissTenantRecommendation: vi.fn(),
  evaluateTenantRecommendationOutcome: vi.fn(),
  collectTenantMetricSnapshots: vi.fn().mockResolvedValue({}),
  createTenantGoal: vi.fn().mockResolvedValue({}),
  getTenantOperationalState: vi.fn().mockResolvedValue({ state: null }),
  listInsightEvidence: vi.fn().mockResolvedValue({ items: [] }),
  listTenantGoals: vi.fn().mockResolvedValue({ items: [] }),
  listTenantInsights: vi.fn().mockResolvedValue({ items: [] }),
  listTenantRecommendations: vi.fn().mockResolvedValue({ items: [] }),
  refreshTenantOperationalState: vi.fn().mockResolvedValue({ state: null }),
  searchTenantIntelligence: vi.fn().mockResolvedValue({}),
  updateTenantGoal: vi.fn().mockResolvedValue({}),
}));

const openRecommendation = {
  id: 'rec-1',
  title: 'Reduzir backlog de tickets',
  description: 'Priorizar tickets antigos do suporte.',
  action_type: 'process',
  priority: 'high',
  status: 'open',
  estimated_impact: 'high',
  metadata: {},
};

describe('TenantIntelligencePage — recomendações executáveis', () => {
  beforeEach(() => {
    testDoubles.toast.showToast.mockClear();
    testDoubles.router.navigate.mockClear();
  });

  it("recomendação 'open' renderiza Aplicar/Dispensar e aplicar atualiza o status para 'Aplicada'", async () => {
    const { listTenantRecommendations, applyTenantRecommendation } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({ items: [openRecommendation] });
    applyTenantRecommendation.mockResolvedValue({
      ok: true,
      recommendation: {
        ...openRecommendation,
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'down',
          },
        },
      },
    });

    render(<TenantIntelligencePage />);

    const applyButton = await screen.findByText('Aplicar recomendação');
    expect(screen.getByText('Dispensar')).toBeTruthy();
    expect(screen.getByText('Aberta')).toBeTruthy();

    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(applyTenantRecommendation).toHaveBeenCalledWith('rec-1');
    });
    await screen.findByText('Aplicada');
    expect(screen.queryByText('Aplicar recomendação')).toBeNull();
    expect(screen.getByText('Avaliar resultado')).toBeTruthy();
  });

  it("recomendação 'applied' renderiza 'Avaliar resultado' e exibe 'Resultado: melhorou' com deltaPct", async () => {
    const { listTenantRecommendations, evaluateTenantRecommendationOutcome } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-2',
        status: 'applied',
        metadata: {
          application: { appliedAt: '2026-09-01T10:00:00.000Z', appliedBy: 'agent-1', baseline: [], expectedDirection: 'down' },
        },
      }],
    });

    const outcome = {
      evaluatedAt: '2026-09-05T10:00:00.000Z',
      outcome: 'improved',
      metrics: [{ metricKey: 'operations.tickets_open', baselineValue: 42, currentValue: 31, delta: -11, deltaPct: -0.26, assessment: 'improved' }],
    };

    evaluateTenantRecommendationOutcome.mockResolvedValue({
      ok: true,
      recommendation: {
        ...openRecommendation,
        id: 'rec-2',
        status: 'completed',
        metadata: {
          application: { appliedAt: '2026-09-01T10:00:00.000Z', appliedBy: 'agent-1', baseline: [], expectedDirection: 'down' },
          outcome,
        },
      },
      outcome,
    });

    render(<TenantIntelligencePage />);

    const evaluateButton = await screen.findByText('Avaliar resultado');
    fireEvent.click(evaluateButton);

    await waitFor(() => {
      expect(evaluateTenantRecommendationOutcome).toHaveBeenCalledWith('rec-2');
    });
    await screen.findByText('Resultado: melhorou');
    expect(screen.getByText(/operations\.tickets_open: 42 → 31 \(-26%\)/)).toBeTruthy();
  });

  it("recomendação 'completed' com outcome regressed exibe 'Resultado: piorou'", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-3',
        status: 'completed',
        metadata: {
          application: { appliedAt: '2026-09-01T10:00:00.000Z', appliedBy: 'agent-1', baseline: [], expectedDirection: 'down' },
          outcome: {
            evaluatedAt: '2026-09-05T10:00:00.000Z',
            outcome: 'regressed',
            metrics: [{ metricKey: 'operations.tickets_open', baselineValue: 31, currentValue: 40, delta: 9, deltaPct: 0.29, assessment: 'regressed' }],
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Resultado: piorou');
    expect(screen.getByText('Concluída')).toBeTruthy();
    expect(screen.queryByText('Aplicar recomendação')).toBeNull();
    expect(screen.queryByText('Avaliar resultado')).toBeNull();
  });

  it('403 no apply exibe mensagem de permissão e não altera o status', async () => {
    const { listTenantRecommendations, applyTenantRecommendation } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({ items: [openRecommendation] });

    const forbiddenError = Object.assign(new Error('Erro HTTP 403'), {
      status: 403,
      body: { error: 'forbidden' },
    });
    applyTenantRecommendation.mockRejectedValue(forbiddenError);

    render(<TenantIntelligencePage />);

    const applyButton = await screen.findByText('Aplicar recomendação');
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(testDoubles.toast.showToast).toHaveBeenCalledWith('Sem permissão para aplicar recomendações', 'error');
    });
    expect(screen.getByText('Aberta')).toBeTruthy();
    expect(screen.getByText('Aplicar recomendação')).toBeTruthy();
  });

  it("recomendação aplicada com executedAction 'executed' exibe 'Tarefa criada no Workspace'", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-4',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'down',
            executedAction: { kind: 'create_task', status: 'executed', taskId: 'task-1', executedAt: '2026-09-01T10:00:01.000Z' },
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Tarefa criada no Workspace para execução operacional.');
    expect(screen.queryByText(/não pôde ser executada automaticamente/)).toBeNull();
  });

  it("recomendação aplicada com executedAction 'failed' exibe aviso de execução manual", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-5',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'down',
            executedAction: { kind: 'create_task', status: 'failed', error: 'workspace indisponivel', attemptedAt: '2026-09-01T10:00:01.000Z' },
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText(/não pôde ser executada automaticamente/);
    expect(screen.queryByText('Tarefa criada no Workspace para execução operacional.')).toBeNull();
  });

  it('insight com causas prováveis e projeção exibe ambos no card', async () => {
    const { listTenantInsights } = await import('../api/intelligence');
    listTenantInsights.mockResolvedValue({
      items: [{
        id: 'ins-1',
        type: 'goal_off_track',
        title: 'Meta fora do esperado: Fechar 10 tickets',
        impact: 'high',
        confidence: 0.9,
        metadata: {
          probableCauses: [
            { metricKey: 'operations.abandonment_rate_pct', changeRatio: 0.4, direction: 'up' },
            { metricKey: 'operations.tickets_open', changeRatio: -0.24, direction: 'down' },
          ],
          projection: { projectedValue: 6, targetValue: 10, elapsedFraction: 0.5, projectedStatus: 'will_miss' },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Meta fora do esperado: Fechar 10 tickets');
    expect(screen.getByText(/Possíveis causas: operations\.abandonment_rate_pct \(\+40%\), operations\.tickets_open \(-24%\)/)).toBeTruthy();
    expect(screen.getByText(/Projeção de fechamento:/)).toBeTruthy();
    expect(screen.getByText(/não atinge a meta/)).toBeTruthy();
  });

  it('insight sem explanation/prediction não renderiza blocos extras', async () => {
    const { listTenantInsights } = await import('../api/intelligence');
    listTenantInsights.mockResolvedValue({
      items: [{
        id: 'ins-2',
        type: 'metric_drop',
        title: 'queda relevante em operations.tickets_open',
        impact: 'medium',
        confidence: 0.8,
        metadata: {},
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('queda relevante em operations.tickets_open');
    expect(screen.queryByText(/Possíveis causas:/)).toBeNull();
    expect(screen.queryByText(/Projeção de fechamento:/)).toBeNull();
  });
});
