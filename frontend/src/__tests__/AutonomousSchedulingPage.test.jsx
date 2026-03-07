import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { AutonomousSchedulingPage } from '../pages/AutonomousSchedulingPage';

const policyMock = vi.fn();
const updatePolicyMock = vi.fn();
const campaignsMock = vi.fn();
const candidatesMock = vi.fn();
const waitingListMock = vi.fn();
const metricsMock = vi.fn();
const runtimeMock = vi.fn();
const updateRuntimeMock = vi.fn();
const aggregatedMetricsMock = vi.fn();
const insightsMock = vi.fn();
const snapshotsMock = vi.fn();
const snapshotRunMock = vi.fn();
const recommendationsMock = vi.fn();
const previewRunMock = vi.fn();
const templatesMock = vi.fn();
const revenueListMock = vi.fn();
const revenueDetectMock = vi.fn();
const createWaitingMock = vi.fn();
const updateWaitingMock = vi.fn();
const deactivateWaitingMock = vi.fn();
const acceptCandidateMock = vi.fn();
const rejectCandidateMock = vi.fn();
const runDetectionMock = vi.fn();
const createKioskSessionMock = vi.fn();
const kioskCheckinMock = vi.fn();
const kioskAvailabilityMock = vi.fn();
const listKioskSessionsMock = vi.fn();

vi.mock('../context/authContext', () => ({
  useAuth: vi.fn(() => ({ agent: { role: 'admin', tenantId: 'tenant-1' } })),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../api/autonomousScheduling', () => ({
  getAutonomousSchedulingPolicy: (...args) => policyMock(...args),
  updateAutonomousSchedulingPolicy: (...args) => updatePolicyMock(...args),
  listAutonomousCampaigns: (...args) => campaignsMock(...args),
  listAutonomousCampaignCandidates: (...args) => candidatesMock(...args),
  listAutonomousWaitingList: (...args) => waitingListMock(...args),
  getAutonomousSchedulingMetrics: (...args) => metricsMock(...args),
  getAutonomousSchedulingRuntime: (...args) => runtimeMock(...args),
  updateAutonomousSchedulingRuntime: (...args) => updateRuntimeMock(...args),
  getAutonomousAggregatedMetrics: (...args) => aggregatedMetricsMock(...args),
  getAutonomousPredictiveInsights: (...args) => insightsMock(...args),
  listOperationalMetricSnapshots: (...args) => snapshotsMock(...args),
  generateOperationalMetricSnapshot: (...args) => snapshotRunMock(...args),
  listAutonomousRecommendations: (...args) => recommendationsMock(...args),
  previewAutonomousCoreRun: (...args) => previewRunMock(...args),
  listAutonomousTemplates: (...args) => templatesMock(...args),
  listRevenueOpportunities: (...args) => revenueListMock(...args),
  detectRevenueOpportunities: (...args) => revenueDetectMock(...args),
  createAutonomousWaitingListEntry: (...args) => createWaitingMock(...args),
  updateAutonomousWaitingListEntry: (...args) => updateWaitingMock(...args),
  deactivateAutonomousWaitingListEntry: (...args) => deactivateWaitingMock(...args),
  acceptAutonomousCampaignCandidate: (...args) => acceptCandidateMock(...args),
  rejectAutonomousCampaignCandidate: (...args) => rejectCandidateMock(...args),
  runAutonomousGapDetection: (...args) => runDetectionMock(...args),
  createKioskSession: (...args) => createKioskSessionMock(...args),
  kioskCheckin: (...args) => kioskCheckinMock(...args),
  kioskAvailabilityLookup: (...args) => kioskAvailabilityMock(...args),
  listKioskSessions: (...args) => listKioskSessionsMock(...args),
}));

describe('AutonomousSchedulingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyMock.mockResolvedValue({ policy: { settings: { verticalTemplate: 'beauty', allowedChannels: ['whatsapp'], preferredTimeWindows: [] }, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6] } });
    campaignsMock.mockResolvedValue({
      items: [
        { id: 'agc-1', status: 'running', serviceType: 'corte', gapStartAt: '2026-03-06T10:30:00.000Z', gapEndAt: '2026-03-06T11:00:00.000Z', sentInvites: 1, maxInvites: 8, contextType: 'ticket', contextId: 'ticket-1' },
      ],
    });
    candidatesMock.mockResolvedValue({
      items: [
        { id: 'cand-1', contactId: 'contact-1', inviteStatus: 'sent', score: 90, scoreBreakdown: { waitingList: 70 }, contact: { name: 'Cliente 1', phone: '5511999999999' } },
      ],
    });
    waitingListMock.mockResolvedValue({
      items: [
        { id: 'awl-1', contactId: 'contact-1', priority: 80, desiredChannel: 'whatsapp', serviceType: 'corte', contact: { name: 'Cliente 1', phone: '5511999999999' } },
      ],
    });
    metricsMock.mockResolvedValue({ metrics: { campaignsOpen: 1, campaignsFilled: 2, accepts: 3, campaignsExpired: 1, fillRate: 66 } });
    runtimeMock.mockResolvedValue({ runtime: { runIntervalMinutes: 15, maxCampaignsPerRun: 8, maxInvitesPerRun: 40, enabledChannelsJson: ['whatsapp'] } });
    aggregatedMetricsMock.mockResolvedValue({ items: [{ verticalTemplate: 'beauty', serviceType: 'corte', fillRate: 66, acceptRate: 50 }] });
    insightsMock.mockResolvedValue({ insights: { idleRisk: 'medium', noShowRisk: 'low', fillProbability: 0.64, recommendedAction: 'monitor', reasonCodes: ['service_affinity'] } });
    snapshotsMock.mockResolvedValue({ items: [{ id: 'oms-1', vertical_template: 'beauty', service_type: 'corte', snapshot_date: '2026-03-06', fill_rate: 66, accept_rate: 50 }] });
    snapshotRunMock.mockResolvedValue({ ok: true, created: 1 });
    recommendationsMock.mockResolvedValue({ items: [{ type: 'preventive_campaign', title: 'Rodar campanha preventiva', message: 'Há risco alto de ociosidade.', severity: 'warning', confidence: 0.7, reasonCodes: ['high_idle_risk'] }] });
    previewRunMock.mockResolvedValue({ preview: { eligibleGaps: [{}], eligibleCampaigns: [{}], recommendations: [{}], revenueOpportunities: [], reasons: [{ code: 'simulation_mode', message: 'Preview run calcula efeitos sem disparar ações reais.' }] } });
    templatesMock.mockResolvedValue({ items: [{ key: 'beauty' }, { key: 'fitness' }, { key: 'food' }, { key: 'services' }] });
    revenueListMock.mockResolvedValue({ items: [{ id: 'rev-1', type: 'fill_gap', service_type: 'corte', confidence: 0.72, reasonCodes: ['revenue_recovery'] }] });
    revenueDetectMock.mockResolvedValue({ ok: true });
    createWaitingMock.mockResolvedValue({ ok: true });
    updateWaitingMock.mockResolvedValue({ ok: true });
    deactivateWaitingMock.mockResolvedValue({ ok: true });
    acceptCandidateMock.mockResolvedValue({ ok: true });
    rejectCandidateMock.mockResolvedValue({ ok: true });
    runDetectionMock.mockResolvedValue({ created: 1 });
    updateRuntimeMock.mockResolvedValue({ ok: true, runtime: { runIntervalMinutes: 15, maxCampaignsPerRun: 8, maxInvitesPerRun: 40, enabledChannelsJson: ['whatsapp'] } });
    createKioskSessionMock.mockResolvedValue({ ok: true });
    kioskCheckinMock.mockResolvedValue({ ok: true });
    kioskAvailabilityMock.mockResolvedValue({ ok: true, slots: [] });
    listKioskSessionsMock.mockResolvedValue({ items: [{ id: 'kiosk-1', kiosk_code: 'default', status: 'open', contact_id: 'contact-1', ticket_id: 'ticket-1', status_reason: 'checked_in' }] });
    updatePolicyMock.mockResolvedValue({ ok: true, policy: { settings: { verticalTemplate: 'fitness', allowedChannels: ['whatsapp'] }, allowedWeekdays: [1, 2, 3] } });
  });

  it('renderiza métricas e campanhas sem quebrar', async () => {
    render(<AutonomousSchedulingPage />);
    await screen.findByText(/Agenda Autônoma/i);
    expect(await screen.findByText(/Campanhas abertas/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/Cliente 1/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Runtime operacional/i)).toBeInTheDocument();
    expect(await screen.findByText(/Predictive insights/i)).toBeInTheDocument();
    expect(await screen.findByText(/Revenue engine/i)).toBeInTheDocument();
    expect(await screen.findByText(/Rodar campanha preventiva/i)).toBeInTheDocument();
    expect(await screen.findByText(/Nenhum snapshot persistido ainda|2026-03-06/i)).toBeInTheDocument();
  });

  it('permite aceitar candidato e desativar waiting list', async () => {
    render(<AutonomousSchedulingPage />);
    await screen.findAllByText(/Cliente 1/i);

    fireEvent.click(screen.getByRole('button', { name: /Aceitar/i }));
    await waitFor(() => expect(acceptCandidateMock).toHaveBeenCalledWith('agc-1', 'cand-1'));

    fireEvent.click(screen.getByRole('button', { name: /Desativar/i }));
    await waitFor(() => expect(deactivateWaitingMock).toHaveBeenCalledWith('awl-1'));
  });

  it('permite gerar snapshot e preview run', async () => {
    render(<AutonomousSchedulingPage />);
    await screen.findByText(/Agenda Autônoma/i);

    fireEvent.click(screen.getByRole('button', { name: /Gerar snapshot/i }));
    await waitFor(() => expect(snapshotRunMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Preview run/i }));
    await waitFor(() => expect(previewRunMock).toHaveBeenCalled());
    expect(await screen.findByText(/Gaps elegíveis/i)).toBeInTheDocument();
  });
});
