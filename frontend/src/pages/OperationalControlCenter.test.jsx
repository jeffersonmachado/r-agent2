import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OperationalControlCenter } from './OperationalControlCenter';

const healthMock = vi.fn();
const metricsMock = vi.fn();
const alertsMock = vi.fn();
const auditMock = vi.fn();
const flagsMock = vi.fn();
const crmSummaryMock = vi.fn();
const updateFlagMock = vi.fn();
const occSignalsMock = vi.fn();
const occRecommendationsMock = vi.fn();
const occOutcomesMock = vi.fn();
const listOperationalPlaybooksAdminMock = vi.fn();
const listQuickActionsForSignalMock = vi.fn();
const listQuickActionsForRecommendationMock = vi.fn();

vi.mock('../api/superAdmin', () => ({
  getOccTenantsHealth: (...args) => healthMock(...args),
  getOccTenantMetrics: (...args) => metricsMock(...args),
  getOccTenantAlerts: (...args) => alertsMock(...args),
  getOccTenantUraAudit: (...args) => auditMock(...args),
  getOccTenantFeatureFlags: (...args) => flagsMock(...args),
  getOccTenantCrmOperationalSummary: (...args) => crmSummaryMock(...args),
  updateOccTenantFeatureFlag: (...args) => updateFlagMock(...args),
  getOccTenantOperationalSignals: (...args) => occSignalsMock(...args),
  generateOccTenantOperationalSignals: vi.fn(),
  updateOccTenantOperationalSignalStatus: vi.fn(),
  getOccTenantOperationalRecommendations: (...args) => occRecommendationsMock(...args),
  getOccTenantOperationalOutcomes: (...args) => occOutcomesMock(...args),
  generateOccTenantOperationalRecommendations: vi.fn(),
  updateOccTenantOperationalRecommendationStatus: vi.fn(),
  listOperationalPlaybooksAdmin: (...args) => listOperationalPlaybooksAdminMock(...args),
  listQuickActionsForSignal: (...args) => listQuickActionsForSignalMock(...args),
  listQuickActionsForRecommendation: (...args) => listQuickActionsForRecommendationMock(...args),
  executeOperationalPlaybookAdmin: vi.fn(),
  stepOperationalPlaybookAdmin: vi.fn(),
}));

describe('OperationalControlCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    healthMock.mockResolvedValue({
      summary: {
        tenantsActive: 1,
        tenantsWithAlerts: 1,
        tenantsWithUraDegraded: 0,
        tenantsWithSchedulingDegraded: 1,
      },
      items: [
        {
          tenantId: 'tenant-1',
          tenantName: 'Tenant 1',
          snapshot: {
            health: { schedulingStatus: 'red' },
            ura: { fallbackCount: 2 },
            scheduling: { conflictsDetected: 3 },
            beauty: { bookingsToday: 4 },
            fitness: { occupancyRate: 75 },
          },
        },
      ],
    });
    metricsMock.mockResolvedValue({
      item: {
        snapshot_payload_json: {
          ura: { averageConfidence: 0.82, fallbackCount: 2 },
          scheduling: { schedulesToday: 5 },
          beauty: { bookingsToday: 4, freeWindowsDetected: 3 },
          fitness: { classesToday: 2, resourceIdleRate: 20 },
          ai: { averageLatency: 180 },
        },
      },
    });
    alertsMock.mockResolvedValue({
      items: [{ id: 'alert-1', alertType: 'scheduling_repeated_professional_conflict', severity: 'high', description: 'Conflito recorrente' }],
    });
    auditMock.mockResolvedValue({
      items: [{ id: 'audit-1', intent: 'agendamento', providerStatus: 'used', departmentId: 'dept-fit', queueName: 'fitness', confidence: 0.9 }],
    });
    flagsMock.mockResolvedValue({
      items: [{ featureKey: 'ura_ai_enabled', enabled: true, config: {} }],
    });
    crmSummaryMock.mockResolvedValue({
      ok: true,
      summary: {
        scope: 'tenant',
        tenantId: 'tenant-1',
        eventsRecentCount: 7,
        opportunitiesCount: 2,
        revenueOpportunitiesCount: 1,
        lastEvent: {
          id: 'crmevt-1',
          type: 'support_ticket_created',
          source_module: 'support',
          created_at: '2026-03-07T10:00:00.000Z',
        },
        recentActivity: true,
      },
    });
    updateFlagMock.mockResolvedValue({ ok: true });
    occSignalsMock.mockResolvedValue({ ok: true, items: [{ id: 'sig-1', type: 'support_backlog_risk', status: 'open', severity: 'high', confidence: 0.8 }] });
    occRecommendationsMock.mockResolvedValue({
      ok: true,
      items: [{
        id: 'rec-1',
        type: 'operational_support_backlog_risk',
        status: 'open',
        description: 'Revisar capacidade da fila de suporte',
        priority: 80,
        impact_level: 'high',
        confidence: 0.78,
        suggested_actions: [{ action: 'review_queue' }],
      }],
    });
    occOutcomesMock.mockResolvedValue({
      ok: true,
      items: [{
        id: 'out-1',
        outcome_type: 'operational_action_executed',
        action_type: 'schedule_callback',
        signal_id: 'sig-1',
        recommendation_id: 'rec-1',
        playbook_execution_id: 'opexec-1',
        produced_at: '2026-03-10T10:30:00.000Z',
        status: 'success',
        result_context_json: {
          result: {
            kind: 'scheduled',
          },
        },
      }],
    });
    listOperationalPlaybooksAdminMock.mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'followup_recovery',
          triggerSignal: 'followup_overdue',
          name: 'Regularizar follow-up atrasado',
          steps: [{ id: 'notify_operator', type: 'notify_operator', title: 'Notificar operador' }],
        },
      ],
    });
    listQuickActionsForSignalMock.mockResolvedValue({ ok: true, items: [] });
    listQuickActionsForRecommendationMock.mockResolvedValue({ ok: true, items: [] });
  });

  test('renderiza resumo e detalhes do tenant selecionado', async () => {
    render(<OperationalControlCenter />);

    await waitFor(() => expect(screen.getByText('Operational Control Center')).toBeInTheDocument());
    expect(screen.getAllByText('Tenant 1').length).toBeGreaterThan(0);
    expect(await screen.findByText('Conflito recorrente')).toBeInTheDocument();
    expect(await screen.findByText('agendamento')).toBeInTheDocument();
    expect(await screen.findByText('ura_ai_enabled')).toBeInTheDocument();
    expect(await screen.findByText(/Último evento:/i)).toBeInTheDocument();
    expect(await screen.findByText(/support_ticket_created/i)).toBeInTheDocument();
    expect((await screen.findAllByText('Outcomes recentes')).length).toBeGreaterThan(0);
    expect(await screen.findByText('operational_action_executed')).toBeInTheDocument();
    expect(await screen.findByText(/schedule_callback/i)).toBeInTheDocument();
  });
});
