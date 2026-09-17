import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchmarkResearchGovernancePage } from './BenchmarkResearchGovernancePage';
import { fetchJson } from '../api/client';

const testDoubles = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock('../api/client', () => ({
  fetchJson: vi.fn(),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: testDoubles.showToast,
    ToastContainer: () => null,
  }),
}));

const proposedProposal = {
  id: 'prop-1abcdef1234',
  vertical: 'fitness',
  runId: 'run-1',
  patchSha256: 'aabbccddee00112233445566778899aabb',
  status: 'proposed',
  caveats: [],
  decisionReason: null,
  proposedBy: 'pesquisa-auto',
  reviewedBy: null,
  appliedBy: null,
  proposedAt: '2026-09-16T10:00:00.000Z',
  reviewedAt: null,
  appliedAt: null,
  evaluation: {
    context: {
      vertical: 'fitness',
      runId: 'run-1',
      generatedAt: '2026-09-16T09:55:00.000Z',
      benchmarksInSample: 12,
      sourcesResearched: 5,
      evidenceCount: 30,
      findingsByKind: { gap: 2, update: 1 },
      noveltyByClassification: { new: 3 },
    },
    whatChanges: [
      { type: 'add', benchmarkId: 'bench-retencao-90d', reason: 'Cobrir jornada de retenção' },
      { type: 'remove', benchmarkId: 'bench-obsoleto', reason: 'Fonte descontinuada' },
    ],
    sufficiency: {
      before: { totalBenchmarks: 12, criticalJourneysCovered: 3 },
      after: { totalBenchmarks: 13, criticalJourneysCovered: 4 },
      gatesFlipping: ['coverage-critical'],
    },
    pros: ['Amplia cobertura de retenção'],
    cons: ['Aumenta custo de manutenção'],
    risks: ['Fonte pouco estável'],
    practicalAssessment: 'Mudança segura de aplicar com monitoramento.',
    recommendation: { verdict: 'caution', reasons: ['Ganho real, mas exige revisão mensal'] },
    nonGoals: ['Não altera thresholds de release'],
  },
};

const appliedProposal = {
  id: 'prop-2bcdef05678',
  vertical: 'beauty',
  runId: 'run-2',
  patchSha256: 'ffeeddccbbaa99887766554433221100ffee',
  status: 'applied',
  caveats: ['Monitorar por 2 ciclos'],
  decisionReason: 'Aprovada com ressalvas',
  proposedBy: 'pesquisa-auto',
  reviewedBy: 'dev-ana',
  appliedBy: 'dev-ana',
  proposedAt: '2026-09-10T10:00:00.000Z',
  reviewedAt: '2026-09-11T10:00:00.000Z',
  appliedAt: '2026-09-12T10:00:00.000Z',
  evaluation: {
    context: { vertical: 'beauty', runId: 'run-2', benchmarksInSample: 8, sourcesResearched: 3, evidenceCount: 10 },
    whatChanges: [{ type: 'update', benchmarkId: 'bench-agenda', reason: 'Atualizar fonte' }],
    sufficiency: { before: { totalBenchmarks: 8 }, after: { totalBenchmarks: 8 }, gatesFlipping: [] },
    pros: ['Mantém amostra atualizada'],
    cons: [],
    risks: [],
    practicalAssessment: 'Atualização de rotina.',
    recommendation: { verdict: 'recommended', reasons: ['Sem impacto em gates'] },
    nonGoals: [],
  },
};

function mockFetchJsonImpl(url, init) {
  const method = init?.method || 'GET';

  if (method === 'GET' && String(url).startsWith('/api/benchmark-research/proposals?')) {
    return Promise.resolve({ proposals: [proposedProposal, appliedProposal] });
  }
  if (method === 'GET' && url === '/api/benchmark-research/proposals') {
    return Promise.resolve({ proposals: [proposedProposal, appliedProposal] });
  }
  if (method === 'GET' && url === '/api/benchmark-research/proposals/prop-1abcdef1234') {
    return Promise.resolve({ proposal: proposedProposal });
  }
  if (method === 'GET' && url === '/api/benchmark-research/proposals/prop-2bcdef05678') {
    return Promise.resolve({ proposal: appliedProposal });
  }
  if (method === 'POST' && url === '/api/benchmark-research/proposals/prop-1abcdef1234/review') {
    return Promise.resolve({ reviewToken: 'tok-123', expiresAt: '2026-09-17T12:00:00.000Z' });
  }
  if (method === 'POST' && url === '/api/benchmark-research/proposals/prop-1abcdef1234/approve') {
    const body = JSON.parse(init.body);
    return Promise.resolve({
      proposal: { ...proposedProposal, status: 'approved', caveats: body.caveats, reviewedBy: 'dev-ana' },
    });
  }
  if (method === 'POST' && url === '/api/benchmark-research/proposals/prop-1abcdef1234/reject') {
    return Promise.resolve({ proposal: { ...proposedProposal, status: 'rejected' } });
  }

  return Promise.reject(new Error(`URL não mockada: ${method} ${url}`));
}

async function renderAndSelectProposal(cardText) {
  const user = userEvent.setup();
  render(<BenchmarkResearchGovernancePage />);

  await waitFor(() => {
    expect(screen.getByText(cardText)).toBeTruthy();
  });

  return user;
}

describe('BenchmarkResearchGovernancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchJson.mockImplementation(mockFetchJsonImpl);
  });

  it('renderiza a lista com duas propostas em status diferentes', async () => {
    render(<BenchmarkResearchGovernancePage />);

    await waitFor(() => {
      expect(screen.getByText('#prop-1abcdef…')).toBeTruthy();
      expect(screen.getByText('#prop-2bcdef0…')).toBeTruthy();
    });

    expect(screen.getAllByText('Proposta').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aplicada').length).toBeGreaterThan(0);
    expect(screen.getByText(/Pesquisa nunca aplica mudanças diretamente/)).toBeTruthy();
  });

  it('abre o detalhe e mostra a avaliação documentada (prós, contras e riscos)', async () => {
    const user = await renderAndSelectProposal('#prop-1abcdef…');

    await user.click(screen.getByText('#prop-1abcdef…'));

    await waitFor(() => {
      expect(screen.getByText('Amplia cobertura de retenção')).toBeTruthy();
    });

    expect(screen.getByText('Aumenta custo de manutenção')).toBeTruthy();
    expect(screen.getByText('Fonte pouco estável')).toBeTruthy();
    expect(screen.getByText('Mudança segura de aplicar com monitoramento.')).toBeTruthy();
    expect(screen.getAllByText('Recomendada com cautela').length).toBeGreaterThan(0);
    expect(screen.getByText('coverage-critical')).toBeTruthy();
    expect(screen.getByText('bench-retencao-90d')).toBeTruthy();
  });

  it('aprova com ressalvas após iniciar revisão, enviando caveats corretos no body', async () => {
    const user = await renderAndSelectProposal('#prop-1abcdef…');
    await user.click(screen.getByText('#prop-1abcdef…'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar revisão' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Iniciar revisão' }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith(
        '/api/benchmark-research/proposals/prop-1abcdef1234/review',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Aprovar com ressalvas' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Aprovar com ressalvas' }));
    await user.type(
      screen.getByLabelText(/Ressalvas \(uma por linha\)/),
      'Ressalva um\nRessalva dois',
    );
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith(
        '/api/benchmark-research/proposals/prop-1abcdef1234/approve',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const approveCall = fetchJson.mock.calls.find(
      ([url]) => url === '/api/benchmark-research/proposals/prop-1abcdef1234/approve',
    );
    const body = JSON.parse(approveCall[1].body);
    expect(body.reviewToken).toBe('tok-123');
    expect(body.caveats).toEqual(['Ressalva um', 'Ressalva dois']);
  });

  it('não chama a API ao rejeitar sem motivo', async () => {
    const user = await renderAndSelectProposal('#prop-1abcdef…');
    await user.click(screen.getByText('#prop-1abcdef…'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar revisão' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Iniciar revisão' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rejeitar' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Rejeitar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar rejeição' }));

    const rejectCalls = fetchJson.mock.calls.filter(
      ([url]) => url === '/api/benchmark-research/proposals/prop-1abcdef1234/reject',
    );
    expect(rejectCalls).toHaveLength(0);
    expect(testDoubles.showToast).toHaveBeenCalledWith('Informe o motivo da rejeição.', 'warning');
  });

  it('não mostra ações para propostas aplicadas e exibe a trilha de decisão', async () => {
    const user = await renderAndSelectProposal('#prop-2bcdef0…');
    await user.click(screen.getByText('#prop-2bcdef0…'));

    await waitFor(() => {
      expect(screen.getByText('Monitorar por 2 ciclos')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Iniciar revisão' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprovar com ressalvas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rejeitar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
    expect(screen.getByText(/Decisão final registrada/)).toBeTruthy();
    expect(screen.getAllByText(/dev-ana/).length).toBeGreaterThan(0);
  });
});
