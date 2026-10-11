import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecurityIntelligencePage } from './SecurityIntelligencePage';
import * as securityIntelApi from '../api/securityIntel';

const testDoubles = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../api/securityIntel', () => ({
  approveSecurityWaiver: vi.fn(),
  createSecurityPatchMission: vi.fn(),
  createSecurityWaiver: vi.fn(),
  generateSecurityPatchPlans: vi.fn(),
  getSecurityFindingTimeline: vi.fn(),
  getSecurityIntelSummary: vi.fn(),
  getSecurityInventory: vi.fn(),
  getSecurityVectorIndex: vi.fn(),
  listSecurityAdvisories: vi.fn(),
  listSecurityFindings: vi.fn(),
  listSecurityPatches: vi.fn(),
  listSecurityWaivers: vi.fn(),
  getSecurityTriage: vi.fn(),
  revokeSecurityWaiver: vi.fn(),
  runSecurityScan: vi.fn(),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: testDoubles.showToast, ToastContainer: () => null }),
}));

const SEM_CORRECAO = 'C|npm:pacote-c@1.0.0';
const AGUARDA_APROVACAO = 'B|npm:pacote-b@1.0.0';
const COM_CORRECAO = 'A|npm:pacote-a@1.0.0';

const findings = [
  {
    finding_key: COM_CORRECAO,
    package_name: 'pacote-a',
    installed_version: '1.0.0',
    advisory_id: 'GHSA-aaaa-bbbb-cccc',
    severity: 'CRITICAL',
    status: 'FIX_AVAILABLE',
    fixed_versions: ['1.0.1'],
    service: 'api',
    cvss_score: 9.8,
    epss: 0.1,
  },
  {
    finding_key: AGUARDA_APROVACAO,
    package_name: 'pacote-b',
    installed_version: '1.0.0',
    advisory_id: 'GHSA-dddd-eeee-ffff',
    severity: 'HIGH',
    status: 'FIX_AVAILABLE',
    fixed_versions: ['1.0.2'],
    service: 'api',
    cvss_score: 7.5,
    epss: 0.02,
  },
  {
    finding_key: SEM_CORRECAO,
    package_name: 'pacote-c',
    installed_version: '1.0.0',
    advisory_id: 'GHSA-gggg-hhhh-iiii',
    severity: 'LOW',
    status: 'NO_FIX_AVAILABLE',
    fixed_versions: [],
    service: 'rag-service',
    cvss_score: 3.1,
    epss: 0.01,
  },
];

const waivers = [{
  waiver_key: 'w-1',
  finding_key: AGUARDA_APROVACAO,
  state: 'PENDING_APPROVAL',
  expires_at: '2026-11-01T00:00:00.000Z',
  approved_by: null,
  reason: 'sem versão corrigida publicada para o runtime atual',
}];

const summary = {
  inventory: { total: 120 },
  findings: { open: 3, byStatus: { NO_FIX_AVAILABLE: 1, FIX_AVAILABLE: 2 }, kevOpen: 0 },
  blockingFindings: 2,
  patchCandidates: 0,
  vexEvaluations: 0,
  advisoryBase: { stale: false, ageHours: 3 },
};

function mockApi() {
  securityIntelApi.getSecurityIntelSummary.mockResolvedValue(summary);
  securityIntelApi.listSecurityFindings.mockResolvedValue({ items: findings, total: findings.length });
  securityIntelApi.listSecurityPatches.mockResolvedValue({ items: [], total: 0 });
  securityIntelApi.listSecurityAdvisories.mockResolvedValue({ syncs: [], advisoriesTotal: 10, kevTotal: 0 });
  securityIntelApi.listSecurityWaivers.mockResolvedValue({ items: waivers, total: waivers.length, maxWaiverDays: 90 });
  securityIntelApi.getSecurityVectorIndex.mockResolvedValue({ verdict: 'HEALTHY', summary: 'ok', unmeasured: [] });
  securityIntelApi.getSecurityTriage.mockResolvedValue({
    groups: [],
    totals: { groups: 0, autoIsolated: 0, requiringHumanApproval: 0, withoutPublishedFix: 0 },
    blockingImpact: {
      gateBlockingPackagesInQueue: [],
      gateBlockingPackages: 0,
      gateBlockingPackagesOutOfQueue: [],
      unitWarning: null,
    },
  });
  securityIntelApi.createSecurityWaiver.mockResolvedValue({ created: true, findingKey: SEM_CORRECAO });
}

describe('SecurityIntelligencePage — ações no grid inicial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('expõe a decisão na própria linha do achado (não só em outra tabela)', async () => {
    render(<SecurityIntelligencePage />);
    await waitFor(() => expect(screen.getByText('Achados de segurança')).toBeTruthy());

    // Achado sem correção publicada → solicitar isenção.
    expect(await screen.findByTestId(`finding-waive-${SEM_CORRECAO}`)).toBeTruthy();
    // Achado com isenção aguardando aprovação → aprovar, e NÃO voltar a solicitar.
    expect(await screen.findByTestId(`finding-approve-${AGUARDA_APROVACAO}`)).toBeTruthy();
    expect(screen.queryByTestId(`finding-waive-${AGUARDA_APROVACAO}`)).toBeNull();
    // Achado com correção disponível e sem isenção → pode ser isentado.
    expect(await screen.findByTestId(`finding-waive-${COM_CORRECAO}`)).toBeTruthy();
  });

  it('clicar em "Isentar (solicitar)" pré-seleciona o achado no formulário de isenção', async () => {
    const user = userEvent.setup();
    render(<SecurityIntelligencePage />);

    const botao = await screen.findByTestId(`finding-waive-${SEM_CORRECAO}`);
    await user.click(botao);

    await waitFor(() => {
      expect(screen.getByTestId('waiver-finding-select').value).toBe(SEM_CORRECAO);
    });
    // Retorno visível: sem isto o clique parece não fazer nada (defeito relatado).
    expect(testDoubles.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Achado selecionado para isenção'),
      'info',
    );
  });

  it('filtro "apenas pendências" mostra só o que exige decisão e declara o corte', async () => {
    const user = userEvent.setup();
    render(<SecurityIntelligencePage />);
    await waitFor(() => expect(screen.getByText('Achados de segurança')).toBeTruthy());

    // Sem filtro: os 3 achados estão no grid.
    expect(screen.getByTestId(`finding-actions-${COM_CORRECAO}`)).toBeTruthy();

    await user.click(screen.getByTestId('findings-only-pending'));

    await waitFor(() => {
      expect(screen.queryByTestId(`finding-actions-${COM_CORRECAO}`)).toBeNull();
    });
    expect(screen.getByTestId(`finding-actions-${SEM_CORRECAO}`)).toBeTruthy();
    expect(screen.getByTestId(`finding-actions-${AGUARDA_APROVACAO}`)).toBeTruthy();

    const resumo = screen.getByTestId('findings-pending-summary').textContent.replace(/\s+/g, ' ');
    expect(resumo).toContain('2');
    expect(resumo).toContain('3 achados carregados');
    expect(resumo).toContain('1 sem correção publicada');
    expect(resumo).toContain('1 com isenção aguardando aprovação');
  });
});
