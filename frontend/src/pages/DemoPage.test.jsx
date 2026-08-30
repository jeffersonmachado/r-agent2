import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoPage from './DemoPage';
import { fetchJson } from '../api/client';

const testDoubles = vi.hoisted(() => ({
  showToast: vi.fn(),
  auth: { agent: { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' } },
}));

vi.mock('../api/client', () => ({
  fetchJson: vi.fn(),
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: testDoubles.auth.agent,
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: testDoubles.showToast,
    ToastContainer: () => null,
  }),
}));

vi.mock('../components/qa-waves/ReplayDetailsModal', () => ({
  ReplayDetailsModal: () => null,
}));

const mockState = {
  demo: { flag: true, vertical: 'fitness' },
  executiveSummary: {
    title: 'RAP Commercial Demo',
    subtitle: 'Cliente -> IA -> Operacao -> Automacao -> Resultado -> QA -> Replay',
  },
  indicators: {
    leadsGenerated: 4,
    ticketsCreated: 2,
    sla: '92%',
    iaConfidence: '91%',
    qaHealth: 'GO',
    roiEstimated: 'R$ 18.400/m',
    conversion: '37%',
    replayStatus: 'ready',
  },
  journey: {
    active: { journeyName: 'Cliente novo', status: 'GO', successRate: 98, executedRate: 94, totalScenarios: 4, failedScenarios: 0 },
    qaStepStatuses: [],
  },
  timeline: {
    items: [
      { id: '1', type: 'message', source: 'customer', summary: 'Entrada do cliente', createdAt: '2026-05-15T10:00:00.000Z' },
    ],
  },
  ai: {
    intent: 'aula_experimental',
    confidence: '91%',
    nextBestAction: 'confirmar horario',
  },
  support: {
    ticket: {
      id: 'tk-1',
      contactName: 'Ana',
      queue: 'comercial',
      status: 'open',
      channelType: 'whatsapp',
      updatedAt: '2026-05-15T10:03:00.000Z',
    },
  },
  crm: {
    leadCount: 1,
    leads: [{ id: 'lead-1', name: 'Ana', stage: 'qualified', score: 82 }],
  },
  automation: {
    mode: 'autonomous',
    automationsExecuted: 3,
    outcome: 'workflow_operacional',
  },
  qaWaves: {
    wave: 'fitness-cliente-novo',
    stage: 'Cliente novo',
    coverage: 94,
    gaps: 0,
    goNoGo: 'GO',
    replayLinked: 'qa_wave_replay_001',
  },
  replay: {
    replayId: 'qa_wave_replay_001',
    details: null,
  },
};

function mockFetch(url) {
  if (String(url).startsWith('/api/demo/state')) {
    return Promise.resolve(mockState);
  }

  if (url === '/api/demo/run') {
    return Promise.resolve({
      status: 'queued',
      execution: { executionId: 'meshq-demo-1' },
    });
  }

  throw new Error(`Unexpected fetchJson call: ${url}`);
}

describe('pages/DemoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDoubles.auth.agent = { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' };
    fetchJson.mockImplementation(mockFetch);
  });

  it('renderiza demo com vertical fitness por padrao', async () => {
    render(<DemoPage />);

    await screen.findByText('RAP Commercial Demo');

    expect(fetchJson).toHaveBeenCalledWith('/api/demo/state?vertical=fitness', expect.any(Object));
    expect(screen.getByText('Leads gerados')).toBeInTheDocument();
    expect(screen.getByText('QA Waves visivel')).toBeInTheDocument();
  });

  it('permite trocar vertical para beauty', async () => {
    const user = userEvent.setup();
    render(<DemoPage />);

    await screen.findByText('RAP Commercial Demo');
    await user.click(screen.getByRole('button', { name: 'Beauty' }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith('/api/demo/state?vertical=beauty', expect.any(Object));
    });
  });

  it('enfileira execucao pelo botao de run', async () => {
    const user = userEvent.setup();
    render(<DemoPage />);

    await screen.findByText('RAP Commercial Demo');
    await user.click(screen.getByRole('button', { name: /Executar fluxo demo/i }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith('/api/demo/run', expect.any(Object));
      expect(testDoubles.showToast).toHaveBeenCalledWith(expect.stringMatching(/executionId=meshq-demo-1/), 'success');
    });
  });

  it('agente DEVELOPMENT vê as superfícies técnicas (QA Waves, QA health, Replay)', async () => {
    render(<DemoPage />);

    await screen.findByText('RAP Commercial Demo');

    expect(screen.getByText('QA Waves visivel')).toBeInTheDocument();
    expect(screen.getByText('QA health')).toBeInTheDocument();
    expect(screen.getByText(/Replay ready/)).toBeInTheDocument();
    expect(screen.getByText(/QA -> Replay/)).toBeInTheDocument();
  });

  it('agente PRODUCTION não vê superfícies técnicas da demo', async () => {
    testDoubles.auth.agent = { id: 'a-prod', role: 'operator' };
    render(<DemoPage />);

    await screen.findByText('RAP Commercial Demo');

    expect(screen.queryByText('QA Waves visivel')).not.toBeInTheDocument();
    expect(screen.queryByText('QA health')).not.toBeInTheDocument();
    expect(screen.queryByText(/QA -> Replay/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Replay ready/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir QA Waves/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir replay/i })).not.toBeInTheDocument();
    // Conteúdo operacional permanece
    expect(screen.getByText('Leads gerados')).toBeInTheDocument();
  });
});
