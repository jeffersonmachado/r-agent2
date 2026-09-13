import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../api/client', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../api/client';
import { QaWavesOperationalHealthPage } from './QaWavesOperationalHealthPage';

/**
 * Defeito provado (2026-09-13): antes do relatório chegar, este painel mostrava
 * saúde de governança NÃO MEDIDA — "Replay Integrity: OK", "Replay Health: Clean"
 * e "Failed Proofs: 0" em VERDE, mais "NO_GO"/"N/A" em vermelho e "Confidence:
 * 0%". A causa é o mesmo padrão da página Enterprise Governance: derivar veredito
 * de `blockers = report?.governance?.blockers || []`, que em `report === null`
 * produz a lista vazia — indistinguível de "nenhum problema".
 *
 * Estes testes exigem: sem dado carregado não existe veredito (nem verde falso,
 * nem vermelho falso).
 */

describe('QaWavesOperationalHealthPage não exibe veredito sem dado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('durante o carregamento não mostra OK/Clean/NO_GO/0%', async () => {
    fetchJson.mockReturnValue(new Promise(() => {}));
    render(<QaWavesOperationalHealthPage />);

    const page = await screen.findByTestId('qa-waves-operational-health-page');
    expect(page.textContent).not.toContain('Clean');
    expect(page.textContent).not.toContain('Blocked');
    expect(page.textContent).not.toContain('0%');
    // 'GO/NO_GO' é RÓTULO da métrica; o veredito só pode existir com dado.
    expect(screen.queryAllByText('NO_GO')).toHaveLength(0);
    expect(screen.queryAllByText('OK')).toHaveLength(0);
  });

  it('após erro segue sem veredito falso', async () => {
    fetchJson.mockRejectedValue(new Error('Falha de rede'));
    render(<QaWavesOperationalHealthPage />);

    await screen.findByText('Falha de rede');
    const page = screen.getByTestId('qa-waves-operational-health-page');
    expect(page.textContent).not.toContain('Clean');
    expect(page.textContent).not.toContain('Blocked');
    expect(screen.queryAllByText('NO_GO')).toHaveLength(0);
  });

  it('com relatório saudável mostra os vereditos corretos', async () => {
    fetchJson.mockResolvedValue({
      summary: { goNoGo: 'GO', operationalConfidenceScore: 100 },
      governance: { goNoGo: 'GO', blockers: [] },
    });
    render(<QaWavesOperationalHealthPage />);

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeTruthy();
    });
    expect(screen.getByText('Clean')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('com relatório degradado mostra os vereditos negativos', async () => {
    fetchJson.mockResolvedValue({
      summary: { goNoGo: 'NO_GO', operationalConfidenceScore: 40 },
      governance: { goNoGo: 'NO_GO', blockers: [{ kind: 'mutation' }] },
    });
    render(<QaWavesOperationalHealthPage />);

    await waitFor(() => {
      expect(screen.getByText('Blocked')).toBeTruthy();
    });
    expect(screen.getAllByText('NO_GO').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Clean')).toHaveLength(0);
  });
});
