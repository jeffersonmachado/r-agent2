import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OperationalControlCenter } from './OperationalControlCenter';

const healthMock = vi.fn();
const metricsMock = vi.fn();
const alertsMock = vi.fn();
const auditMock = vi.fn();

vi.mock('../api/superAdmin', () => ({
  getOccTenantsHealth: (...args) => healthMock(...args),
  getOccTenantMetrics: (...args) => metricsMock(...args),
  getOccTenantAlerts: (...args) => alertsMock(...args),
  getOccTenantUraAudit: (...args) => auditMock(...args),
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
  });

  test('renderiza resumo e detalhes do tenant selecionado', async () => {
    render(<OperationalControlCenter />);

    await waitFor(() => expect(screen.getByText('Operational Control Center')).toBeInTheDocument());
    expect(screen.getAllByText('Tenant 1').length).toBeGreaterThan(0);
    expect(await screen.findByText('Conflito recorrente')).toBeInTheDocument();
    expect(await screen.findByText('agendamento')).toBeInTheDocument();
  });
});
