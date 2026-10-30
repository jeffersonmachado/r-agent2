import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QaWavesPage } from './QaWavesPage';
import { fetchJson } from '../api/client';

const testDoubles = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

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

vi.mock('../components/qa-waves/CoverageGapsTab', () => ({
  CoverageGapsTab: ({ domainId }) => <div data-testid="coverage-gaps-tab" data-domain={domainId || ''} />,
}));

vi.mock('../components/qa-waves/QaWavesDocsTab', () => ({
  QaWavesDocsTab: ({ domainId }) => <div data-testid="qa-waves-docs-tab" data-domain={domainId || ''} />,
}));

vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: true,
    authenticated: true,
    authFailed: false,
    send: vi.fn(),
    reconnect: vi.fn(),
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: testDoubles.showToast,
    ToastContainer: () => null,
  }),
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

  if (String(url).startsWith('/api/test-executions/replays')) {
    return Promise.resolve({
      items: [],
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      },
    });
  }

  if (url.startsWith('/api/qa-waves/executions')) {
    return Promise.resolve({ items: [] });
  }

  // Painel de operações longas (LRO) montado na página: lista vazia por padrão nos testes daqui.
  // O painel é coberto por `components/lro/LroOperationsPanel.test.jsx`.
  if (String(url).startsWith('/api/lro')) {
    return Promise.resolve({ items: [] });
  }

  throw new Error(`Unexpected fetchJson call: ${url}`);
}

// REGRESSÃO MEDIDA 2026-10-30 (cold load real de /dev/qa-waves): `/api/qa-waves/executions`
// deu TIMEOUT enquanto as outras três chamadas respondiam 200; com `Promise.all` a página
// ficava em "0 Cenários / 0% / sem domínio" e o usuário via uma tela vazia como se não
// houvesse dado. O contrato agora é: o que chegou é aplicado; o que falhou é anunciado.
describe('pages/QaWavesPage — falha parcial não pode apagar o que já chegou', () => {
  // Sem cleanup explícito o painel do render ANTERIOR sobrevive no DOM e a asserção escopada
  // encontra os botões do teste passado — foi assim que a 2ª variante passou nas DUAS versões
  // do código quando rodada no conjunto (medido 2026-10-30; isolada, ela discriminava).
  afterEach(() => cleanup());

  it('mantém os domínios quando /executions falha, e anuncia a falha', async () => {
    fetchJson.mockImplementation((url, init) => {
      if (url.startsWith('/api/qa-waves/executions')) {
        return Promise.reject(Object.assign(new Error('Request timeout'), { code: 'TIMEOUT' }));
      }
      return mockFetchJson(url, init);
    });

    render(<QaWavesPage />);

    // Asserção ESCOPADA no painel de domínios: é o que fica vazio quando o `Promise.all`
    // descarta as respostas boas. `Fitness` solto na página casaria outros botões e o teste
    // passaria nas DUAS versões (medido: a primeira versão destes testes não discriminava).
    const nav = await screen.findByRole('navigation', { name: /Verticais/i });
    await waitFor(() => {
      expect(within(nav).getAllByRole('button').length).toBeGreaterThan(0);
    });
    expect(within(nav).getByRole('button', { name: /Fitness/i })).toBeInTheDocument();
    expect(testDoubles.showToast).toHaveBeenCalled();
  });

});

describe('pages/QaWavesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDoubles.showToast.mockReset();
    fetchJson.mockImplementation(mockFetchJson);
  });

  it('usa endpoint unificado /api/test-executions na execução principal', async () => {
    const user = userEvent.setup();

    render(<QaWavesPage />);

    await screen.findByRole('heading', { name: 'Edição guiada do cenário' });
    expect(screen.queryByRole('textbox', { name: /descrição/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => {
      expect(testDoubles.showToast).toHaveBeenCalledWith('Cenário válido (0 aviso(s)).', 'success');
    });

    await user.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => {
      expect(testDoubles.showToast).toHaveBeenCalledWith('Cenário salvo com versão v2.', 'success');
    });

    await user.click(screen.getByRole('button', { name: /executar cenário/i }));
    await waitFor(() => {
      expect(testDoubles.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/Execução real enfileirada\./),
        'success'
      );
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

      if (String(url).startsWith('/api/test-executions/replays?')) {
        return Promise.resolve({
          items: [],
          pagination: {
            page: 1,
            pageSize: 20,
            totalItems: 0,
            totalPages: 0,
          },
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
      expect(testDoubles.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/Execução real enfileirada\./),
        'success'
      );
    });

    await user.click(screen.getByRole('button', { name: /abrir replay/i }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith('/api/test-executions/replays/qa_wave_replay_123.json');
      expect(fetchJson).not.toHaveBeenCalledWith('/api/qa-waves/replays/qa_wave_replay_123');
    });
  });
});