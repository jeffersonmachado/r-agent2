import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock do cliente HTTP antes do import da página.
vi.mock('../api/client', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../api/client';
import { QaWavesEnterpriseGovernancePage } from './QaWavesEnterpriseGovernancePage';

/**
 * Defeito provado (2026-09-13): enquanto o relatório não chegava, a página
 * renderizava vereditos FALSOS — "BLOCKED" em Release Readiness e Deployment
 * Safety, "INVALID" em Replay Integrity e Governance Signatures, "0%" de
 * confiança e badge vermelho em Global GO/NO_GO. A causa era o padrão
 * `report?.x ? 'VALID' : 'INVALID'` sobre `report === null`, que cai sempre no
 * ramo negativo. Num console de governança isso é indistinguível de falha real
 * (e a rota pode demorar, pois a evidência prod-like tem centenas de MB).
 *
 * Estes testes exigem: sem dado carregado não existe veredito.
 */

const HEALTHY_REPORT = {
  governanceStatus: 'GO',
  globalGoNoGo: 'GO',
  operationalConfidence: 100,
  threshold: 95,
  riskLevel: 'LOW',
  replayIntegrity: { valid: true },
  governanceSignature: { valid: true },
  releaseReadiness: { go: true },
  deploymentSafety: { deployAllowed: true },
  activeBlockers: [],
  failedProofs: [],
  runtimeGovernance: { gateStatus: 'go', classification: 'REAL_OK' },
  lastSmokeExecution: { generatedAt: '2026-09-13T03:22:15.929Z', tenantId: 'system' },
  continuousValidationStatus: { status: 'GO', healthy: true },
  replayArtifacts: [],
};

const FORBIDDEN_BEFORE_LOAD = ['BLOCKED', 'INVALID', 'N/A', '0%'];

describe('QaWavesEnterpriseGovernancePage não exibe veredito sem dado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('durante o carregamento não mostra BLOCKED/INVALID/N/A/0%', async () => {
    // Promise que nunca resolve: página fica no estado "carregando".
    fetchJson.mockReturnValue(new Promise(() => {}));
    render(<QaWavesEnterpriseGovernancePage />);

    const page = await screen.findByTestId('qa-waves-enterprise-governance-page');
    expect(page.textContent).not.toContain('BLOCKED');
    expect(page.textContent).not.toContain('INVALID');
    expect(page.textContent).not.toContain('N/A');
    expect(page.textContent).not.toContain('0%');
    for (const forbidden of FORBIDDEN_BEFORE_LOAD) {
      expect(screen.queryAllByText(forbidden)).toHaveLength(0);
    }
  });

  it('após erro de carregamento segue sem veredito falso', async () => {
    fetchJson.mockRejectedValue(new Error('Falha de rede'));
    render(<QaWavesEnterpriseGovernancePage />);

    await screen.findByText('Falha de rede');
    const page = screen.getByTestId('qa-waves-enterprise-governance-page');
    expect(page.textContent).not.toContain('BLOCKED');
    expect(page.textContent).not.toContain('INVALID');
  });

  it('com relatório saudável mostra os vereditos corretos', async () => {
    fetchJson.mockResolvedValue(HEALTHY_REPORT);
    render(<QaWavesEnterpriseGovernancePage />);

    await waitFor(() => {
      expect(screen.getAllByText('VALID')).toHaveLength(2);
    });
    expect(screen.getByText('READY')).toBeTruthy();
    expect(screen.getByText('ALLOWED')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getAllByText('GO').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('INVALID')).toHaveLength(0);
    expect(screen.queryAllByText('BLOCKED')).toHaveLength(0);
  });

  it('com relatório degradado ainda mostra os vereditos negativos', async () => {
    fetchJson.mockResolvedValue({
      ...HEALTHY_REPORT,
      governanceStatus: 'NO_GO',
      globalGoNoGo: 'NO_GO',
      operationalConfidence: 40,
      replayIntegrity: { valid: false },
      governanceSignature: { valid: false },
      releaseReadiness: { go: false },
      deploymentSafety: { deployAllowed: false },
    });
    render(<QaWavesEnterpriseGovernancePage />);

    await waitFor(() => {
      expect(screen.getAllByText('INVALID')).toHaveLength(2);
    });
    expect(screen.getAllByText('BLOCKED')).toHaveLength(2);
    expect(screen.getByText('40%')).toBeTruthy();
  });
});
