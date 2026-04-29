import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QaWavesPage } from './QaWavesPage';
import { fetchJson } from '../api/client';

vi.mock('../api/client', () => ({
  fetchJson: vi.fn(),
}));

vi.mock('../components/qa-waves/JourneyStatusCard', () => ({
  default: () => <div data-testid="journey-status-card" />,
}));

vi.mock('../components/qa-waves/JourneyTree', () => ({
  default: () => <div data-testid="journey-tree" />,
}));

vi.mock('../components/qa-waves/StepBreakdown', () => ({
  default: () => <div data-testid="step-breakdown" />,
}));

const baseScenario = {
  id: 'fitness_trial_class',
  waveId: 'fitness-cliente-novo',
  vertical: 'fitness',
  journeyId: 'cliente_novo',
  journey: 'cliente_novo',
  name: 'Aula experimental',
  version: 'v1',
  source: 'ai_inferred',
  status: 'approved',
  steps: [
    { id: 'step_1', order: 1, type: 'send_message', enabled: true },
  ],
  seeds: [
    { id: 'seed_001', status: 'approved', persona: { type: 'cliente_direto' } },
  ],
  platform: {
    platformScenarioIds: ['business-f1'],
  },
  createdAt: '2026-04-25T18:30:45.769Z',
  updatedAt: '2026-04-25T18:30:45.769Z',
};

function mockFetchJson(url, init) {
  if (url === '/api/qa-waves/journeys') {
    return Promise.resolve({
      domains: [
        {
          id: 'fitness',
          name: 'Fitness',
          journeys: [
            {
              journeyId: 'cliente_novo',
              journeyName: 'Cliente Novo',
              status: 'WARNING',
              steps: [
                {
                  stepId: 'engajamento',
                  stepName: 'Engajamento',
                  totalScenarios: 1,
                  failedScenarios: 0,
                  criticalFailures: 0,
                  status: 'WARNING',
                  successRate: 0,
                  executedRate: 0,
                  riskScore: 0,
                  lastExecutionAt: null,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  if (url === '/api/qa-waves/journey-status') {
    return Promise.resolve({
      items: [{ journeyId: 'cliente_novo', status: 'WARNING' }],
    });
  }

  if (url.startsWith('/api/qa-waves/step-status')) {
    return Promise.resolve({ items: [] });
  }

  if (url === '/api/qa-waves/scenarios') {
    return Promise.resolve({ items: [baseScenario] });
  }

  if (url === '/api/qa-waves/validate-scenario') {
    return Promise.resolve({
      valid: true,
      warnings: [],
      errors: [],
      normalizedScenario: JSON.parse(init.body).scenario,
    });
  }

  if (url === '/api/qa-waves/save-scenario') {
    return Promise.resolve({
      scenario: {
        ...JSON.parse(init.body).scenario,
        version: 'v2',
      },
    });
  }

  if (url === '/api/test-executions') {
    return Promise.resolve({
      executionId: 'meshq-123',
      replayId: 'qa_wave_replay_123',
    });
  }

  if (url === '/api/test-executions/meshq-123') {
    return Promise.resolve({
      executionId: 'meshq-123',
      status: 'processing',
      progress: 0,
    });
  }

  if (url.startsWith('/api/qa-waves/executions')) {
    return Promise.resolve({ items: [] });
  }

  throw new Error(`Unexpected fetchJson call: ${url}`);
}

describe('pages/QaWavesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchJson.mockImplementation(mockFetchJson);
  });

  it('usa endpoint unificado /api/test-executions na execução principal', async () => {
    const user = userEvent.setup();

    render(<QaWavesPage />);

    await screen.findByRole('heading', { name: 'Edição guiada do cenário' });
    expect(screen.queryByRole('textbox', { name: /descrição/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => {
      expect(screen.getByText('Cenário válido (0 aviso(s)).')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => {
      expect(screen.getByText('Cenário salvo com versão v2.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /executar cenário/i }));
    await waitFor(() => {
      expect(screen.getByText(/Execução real enfileirada\./)).toBeInTheDocument();
    });

    const calledUrls = fetchJson.mock.calls.map(([url]) => url);

    expect(calledUrls).toContain('/api/qa-waves/validate-scenario');
    expect(calledUrls).toContain('/api/qa-waves/save-scenario');
    expect(calledUrls).toContain('/api/test-executions');
    expect(calledUrls).not.toContain('/api/qa-waves/run');
    expect(calledUrls.some((url) => String(url).startsWith('/dev/qa-waves/'))).toBe(false);
  });

  it('abre replay usando somente API unificada sem fallback legado', async () => {
    const user = userEvent.setup();

    fetchJson.mockImplementation((url, init) => {
      if (url === '/api/qa-waves/journeys') {
        return Promise.resolve({
          domains: [
            {
              id: 'fitness',
              name: 'Fitness',
              journeys: [
                {
                  journeyId: 'cliente_novo',
                  journeyName: 'Cliente Novo',
                  status: 'GO',
                  steps: [
                    {
                      stepId: 'engajamento',
                      stepName: 'Engajamento',
                      totalScenarios: 1,
                      failedScenarios: 0,
                      criticalFailures: 0,
                      status: 'WARNING',
                      successRate: 0,
                      executedRate: 0,
                      riskScore: 0,
                      lastExecutionAt: null,
                    },
                  ],
                },
              ],
            },
          ],
        });
      }

      if (url === '/api/qa-waves/journey-status') {
        return Promise.resolve({ items: [{ journeyId: 'cliente_novo', status: 'GO' }] });
      }

      if (String(url).startsWith('/api/qa-waves/step-status')) {
        return Promise.resolve({ items: [] });
      }

      if (url === '/api/qa-waves/scenarios') {
        return Promise.resolve({ items: [baseScenario] });
      }

      if (url === '/api/test-executions') {
        return Promise.resolve({
          executionId: 'meshq-123',
          replayId: 'qa_wave_replay_123',
        });
      }

      if (url === '/api/test-executions/meshq-123') {
        return Promise.resolve({
          executionId: 'meshq-123',
          status: 'processing',
          progress: 0,
        });
      }

      if (url.startsWith('/api/qa-waves/executions')) {
        return Promise.resolve({ items: [] });
      }

      if (url === '/api/test-executions/replays/qa_wave_replay_123.json') {
        return Promise.resolve({
          id: 'qa_wave_replay_123',
          steps: [],
          typedEntries: [],
        });
      }

      throw new Error(`Unexpected fetchJson call: ${url}`);
    });

    render(<QaWavesPage />);

    await screen.findByRole('heading', { name: 'Edição guiada do cenário' });

    await user.click(screen.getByRole('button', { name: /executar cenário/i }));
    await waitFor(() => {
      expect(screen.getByText(/Execução real enfileirada\./)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /abrir replay/i }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith('/api/test-executions/replays/qa_wave_replay_123.json');
      expect(fetchJson).not.toHaveBeenCalledWith('/api/qa-waves/replays/qa_wave_replay_123');
    });
  });
});