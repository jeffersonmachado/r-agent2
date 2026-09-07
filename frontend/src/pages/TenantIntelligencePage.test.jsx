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
  applyAllTenantRecommendations: vi.fn(),
  applyTenantRecommendation: vi.fn(),
  dismissTenantRecommendation: vi.fn(),
  evaluateTenantRecommendationOutcome: vi.fn(),
  collectTenantMetricSnapshots: vi.fn().mockResolvedValue({}),
  createTenantGoal: vi.fn().mockResolvedValue({}),
  getTenantOperationalState: vi.fn().mockResolvedValue({ state: null }),
  getTenantRecommendationStats: vi.fn().mockResolvedValue({ stats: null }),
  listInsightEvidence: vi.fn().mockResolvedValue({ items: [] }),
  listTenantGoals: vi.fn().mockResolvedValue({ items: [] }),
  listTenantInsights: vi.fn().mockResolvedValue({ items: [] }),
  listTenantRecommendations: vi.fn().mockResolvedValue({ items: [] }),
  refreshTenantOperationalState: vi.fn().mockResolvedValue({ state: null }),
  searchTenantIntelligence: vi.fn().mockResolvedValue({}),
  updateTenantGoal: vi.fn().mockResolvedValue({}),
}));

vi.mock('../api/tenantCapabilities', () => ({
  getTenantCapabilities: vi.fn().mockResolvedValue({
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel: 'suggest' },
  }),
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

// resetMocks:true (vitest.config) zera implementações de factory antes de cada
// teste — o default de capabilities precisa ser rearmado no nível do arquivo.
beforeEach(async () => {
  const { getTenantCapabilities } = await import('../api/tenantCapabilities');
  getTenantCapabilities.mockResolvedValue({
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel: 'suggest' },
  });
  // resetMocks:true também zera este; default vazio evita TypeError no .catch.
  const { getTenantRecommendationStats } = await import('../api/intelligence');
  getTenantRecommendationStats.mockResolvedValue({ stats: null });
});

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

  it("executedAction send_message 'executed' exibe feedback de mensagem enviada", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-6',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'down',
            executedAction: { kind: 'send_message', status: 'executed', messageId: 'msg-1', conversationId: 'conv-1', executedAt: '2026-09-01T10:00:01.000Z' },
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText(/Mensagem enviada para a fila do canal/);
  });

  it("executedAction schedule 'executed' exibe follow-up agendado com data", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-7',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'down',
            executedAction: { kind: 'schedule', status: 'executed', taskId: 'task-9', dueDate: '2026-09-10T14:00:00.000Z', executedAt: '2026-09-01T10:00:01.000Z' },
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText(/Follow-up agendado para/);
  });

  it("executedAction 'skipped' exibe motivo explícito (sem fingir sucesso)", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-8',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'down',
            executedAction: { kind: 'send_message', status: 'skipped', reason: 'missing_conversation_id', attemptedAt: '2026-09-01T10:00:01.000Z' },
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText(/Sem conversa vinculada/);
    expect(screen.queryByText(/Mensagem enviada/)).toBeNull();
  });

  it('outcome com actionSignals exibe sinal comportamental e razão em PT-BR', async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-10',
        status: 'completed',
        metadata: {
          application: {
            appliedAt: '2026-09-01T10:00:00.000Z',
            appliedBy: 'agent-1',
            baseline: [],
            expectedDirection: 'observe',
            executedAction: { kind: 'send_message', status: 'executed', messageId: 'msg-1', conversationId: 'conv-1', executedAt: '2026-09-01T10:00:01.000Z' },
          },
          outcome: {
            evaluatedAt: '2026-09-02T10:00:00.000Z',
            outcome: 'improved',
            reason: 'action_signal_positive',
            metrics: [],
            actionSignals: [{ type: 'customer_reply', conversationId: 'conv-1', outcome: 'replied', replies: 1, firstReplyAt: '2026-09-01T11:00:00.000Z' }],
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Cliente respondeu após o envio.');
    expect(screen.getByText('Efeito positivo observado na ação executada.')).toBeTruthy();
    expect(screen.queryByText('action_signal_positive')).toBeNull();
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

describe('TenantIntelligencePage — Autonomy UX', () => {
  beforeEach(async () => {
    const { getTenantCapabilities } = await import('../api/tenantCapabilities');
    const { listTenantRecommendations } = await import('../api/intelligence');
    getTenantCapabilities.mockResolvedValue({
      capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel: 'suggest' },
    });
    listTenantRecommendations.mockResolvedValue({ items: [] });
  });

  it("botão 'Aprovar todas' NÃO aparece no nível suggest (default)", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({ items: [openRecommendation] });

    render(<TenantIntelligencePage />);

    await screen.findByText('Aplicar recomendação');
    expect(screen.queryByText('Aprovar todas as recomendações abertas')).toBeNull();
  });

  it("nível approve exibe 'Aprovar todas' e o clique aplica em lote e recarrega as abertas", async () => {
    const { getTenantCapabilities } = await import('../api/tenantCapabilities');
    const { listTenantRecommendations, applyAllTenantRecommendations } = await import('../api/intelligence');
    getTenantCapabilities.mockResolvedValue({
      capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel: 'approve' },
    });
    listTenantRecommendations.mockResolvedValue({ items: [openRecommendation] });
    applyAllTenantRecommendations.mockResolvedValue({
      ok: true,
      applied: 1,
      failed: 0,
      results: [{ recommendationId: 'rec-1', ok: true }],
    });

    render(<TenantIntelligencePage />);

    const batchButton = await screen.findByText('Aprovar todas as recomendações abertas');
    fireEvent.click(batchButton);

    await waitFor(() => {
      expect(applyAllTenantRecommendations).toHaveBeenCalledWith({ limit: 50 });
    });
    await waitFor(() => {
      expect(testDoubles.toast.showToast).toHaveBeenCalledWith('1 recomendações aplicadas', 'success');
    });
    // Recarga das abertas após o lote.
    await waitFor(() => {
      expect(listTenantRecommendations.mock.calls.filter(
        (call) => call[0] && call[0].status === 'open',
      ).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("falha parcial no lote exibe toast de erro com contagem", async () => {
    const { getTenantCapabilities } = await import('../api/tenantCapabilities');
    const { listTenantRecommendations, applyAllTenantRecommendations } = await import('../api/intelligence');
    getTenantCapabilities.mockResolvedValue({
      capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel: 'approve' },
    });
    listTenantRecommendations.mockResolvedValue({ items: [openRecommendation] });
    applyAllTenantRecommendations.mockResolvedValue({
      ok: true,
      applied: 0,
      failed: 1,
      results: [{ recommendationId: 'rec-1', ok: false, error: 'boom' }],
    });

    render(<TenantIntelligencePage />);

    const batchButton = await screen.findByText('Aprovar todas as recomendações abertas');
    fireEvent.click(batchButton);

    await waitFor(() => {
      expect(testDoubles.toast.showToast).toHaveBeenCalledWith(
        '0 recomendações aplicadas; 1 não puderam ser aplicadas',
        'error',
      );
    });
  });

  it("recomendação aplicada com origin 'auto' exibe badge 'Aplicada automaticamente'", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-auto',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-06T10:00:00.000Z',
            appliedBy: 'system',
            origin: 'auto',
            baseline: [],
            expectedDirection: 'down',
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Aplicada automaticamente');
    expect(screen.getByText('Aplicada')).toBeTruthy();
  });

  it("recomendação aplicada manualmente NÃO exibe o badge de automática", async () => {
    const { listTenantRecommendations } = await import('../api/intelligence');
    listTenantRecommendations.mockResolvedValue({
      items: [{
        ...openRecommendation,
        id: 'rec-manual',
        status: 'applied',
        metadata: {
          application: {
            appliedAt: '2026-09-06T10:00:00.000Z',
            appliedBy: 'agent-1',
            origin: 'manual',
            baseline: [],
            expectedDirection: 'down',
          },
        },
      }],
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Aplicada');
    expect(screen.queryByText('Aplicada automaticamente')).toBeNull();
  });
});

describe('TenantIntelligencePage — eficácia das remediações (cadeias causais)', () => {
  beforeEach(() => {
    testDoubles.toast.showToast.mockClear();
    testDoubles.router.navigate.mockClear();
  });

  it('renderiza taxa de sucesso por cadeia quando o stats traz chains avaliadas', async () => {
    const { getTenantRecommendationStats } = await import('../api/intelligence');
    getTenantRecommendationStats.mockResolvedValue({
      stats: {
        chainEfficacy: {
          followUps: 2,
          evaluated: 2,
          chains: {
            'rebalance_queue->manager_escalation': {
              parentAction: 'rebalance_queue', variant: 'manager_escalation',
              total: 2, improved: 1, unchanged: 1, regressed: 0, pending: 0, successRate: 0.5,
            },
          },
        },
      },
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Eficácia das remediações');
    expect(screen.getByText(/Redistribuição de fila/)).toBeTruthy();
    expect(screen.getByText(/Escalonamento ao gestor/)).toBeTruthy();
    expect(screen.getByText(/50% de sucesso \(2 tentativas\)/)).toBeTruthy();
  });

  it('cadeia ainda sem outcome exibe "em andamento" (sem inventar taxa)', async () => {
    const { getTenantRecommendationStats } = await import('../api/intelligence');
    getTenantRecommendationStats.mockResolvedValue({
      stats: {
        chainEfficacy: {
          followUps: 1,
          evaluated: 0,
          chains: {
            'rebalance_queue->staffing_review': {
              parentAction: 'rebalance_queue', variant: 'staffing_review',
              total: 1, improved: 0, unchanged: 0, regressed: 0, pending: 1, successRate: null,
            },
          },
        },
      },
    });

    render(<TenantIntelligencePage />);

    await screen.findByText('Eficácia das remediações');
    expect(screen.getByText(/Reforço de equipe/)).toBeTruthy();
    expect(screen.getByText(/1 em andamento, aguardando resultado/)).toBeTruthy();
  });

  it('sem cadeias no stats → bloco não renderiza', async () => {
    render(<TenantIntelligencePage />);

    await screen.findByText('Top Recomendações');
    expect(screen.queryByText('Eficácia das remediações')).toBeNull();
  });
});
