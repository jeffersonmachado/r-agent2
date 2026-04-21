import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperationsDashboardPage } from './OperationsDashboardPage';

const showToastMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    agent: { tenantId: 'tenant-a', role: 'admin' },
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: navigateMock,
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    ToastContainer: () => null,
  }),
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../api/operationsDashboard', () => ({
  getOperationsSummary: vi.fn(),
  getOperationsTimeline: vi.fn(),
  getOperationsJobs: vi.fn(),
  getOperationsNotifications: vi.fn(),
  getOperationsInsights: vi.fn(),
}));

vi.mock('../api/marketing', () => ({
  getMarketingGoogleAdsAttributionExceptions: vi.fn(),
}));

import {
  getOperationsSummary,
  getOperationsTimeline,
  getOperationsJobs,
  getOperationsNotifications,
  getOperationsInsights,
} from '../api/operationsDashboard';
import { getMarketingGoogleAdsAttributionExceptions } from '../api/marketing';

vi.mock('../api/verticalPilot', () => ({
  getBeautyAgenda: vi.fn(),
  searchBeautyCustomers: vi.fn(),
  getBeautyCustomerDetail: vi.fn(),
  sendBeautyFollowUp: vi.fn(),
  markBeautyServiceCompleted: vi.fn(),
  markBeautyNoShow: vi.fn(),
  searchFitnessStudents: vi.fn(),
  getFitnessStudentDetail: vi.fn(),
  registerFitnessCheckIn: vi.fn(),
  registerFitnessCheckOut: vi.fn(),
  updateFitnessMembershipBilling: vi.fn(),
}));

vi.mock('../api/scheduling', () => ({
  markScheduleDone: vi.fn(),
  markScheduleNoShow: vi.fn(),
}));

import {
  getBeautyAgenda,
  searchBeautyCustomers,
  getBeautyCustomerDetail,
  sendBeautyFollowUp,
  markBeautyServiceCompleted,
  markBeautyNoShow,
  searchFitnessStudents,
  getFitnessStudentDetail,
  registerFitnessCheckIn,
  registerFitnessCheckOut,
  updateFitnessMembershipBilling,
} from '../api/verticalPilot';

import { markScheduleDone, markScheduleNoShow } from '../api/scheduling';

describe('pages/OperationsDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOperationsSummary.mockResolvedValue({
      summary: {
        beauty: { appointmentsToday: 10, completedServices: 8, noShow: 1, reactivations: 2 },
        fitness: { checkInsToday: 30, activeStudents: 120, lowFrequency: 11, blocked: 4 },
        system: { jobsExecuted: 40, jobsError: 3, notificationsSent: 70, notificationFailures: 6 },
      },
      meta: { derivedMetrics: [] },
    });

    getOperationsTimeline.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
    });

    getOperationsJobs.mockResolvedValue({
      summary: { executed: 0, success: 0, failed: 0, avgDurationMs: null, retries: 0, pending: 0, backlogEstimated: 0 },
      items: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
    });

    getOperationsNotifications.mockResolvedValue({
      summary: { sent: 0, failed: 0, skipped: 0, providerDependent: 0 },
      items: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
      meta: { dataSource: 'event_ledger_notification_delivery', warnings: [] },
    });

    getOperationsInsights.mockResolvedValue({
      summary: { total: 0, byVertical: { beauty: 0, fitness: 0 } },
      items: [],
    });
    getMarketingGoogleAdsAttributionExceptions.mockResolvedValue({
      ok: true,
      alert: {
        severity: 'warning',
        currentCount: 4,
        previousCount: 2,
        growthFactor: 2,
      },
    });

    getBeautyAgenda.mockResolvedValue({ summary: { total: 0 }, items: [] });
    searchBeautyCustomers.mockResolvedValue({ items: [] });
    getBeautyCustomerDetail.mockResolvedValue(null);
    sendBeautyFollowUp.mockResolvedValue({ ok: true });
    markBeautyServiceCompleted.mockResolvedValue({ ok: true });
    markBeautyNoShow.mockResolvedValue({ ok: true });
    searchFitnessStudents.mockResolvedValue({ items: [] });
    getFitnessStudentDetail.mockResolvedValue(null);
    registerFitnessCheckIn.mockResolvedValue({ ok: true });
    registerFitnessCheckOut.mockResolvedValue({ ok: true });
    updateFitnessMembershipBilling.mockResolvedValue({ ok: true });
    markScheduleDone.mockResolvedValue({ ok: true });
    markScheduleNoShow.mockResolvedValue({ ok: true });
  });

  it('renderiza resumo executivo e estado vazio da agenda beauty', async () => {
    render(<OperationsDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Painel Operacional Beauty + Fitness')).toBeInTheDocument();
      expect(screen.getByText('Agendamentos hoje')).toBeInTheDocument();
      expect(screen.getByText('Concluidos')).toBeInTheDocument();
      expect(screen.getByText('Check-ins hoje')).toBeInTheDocument();
      expect(screen.getByText('Jobs executados')).toBeInTheDocument();
      expect(screen.getByText('Atribuição Ads')).toBeInTheDocument();
      expect(screen.getByText('Alerta')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Nenhum agendamento encontrado para o dia selecionado.')).toBeInTheDocument();
    });

    expect(getBeautyAgenda).toHaveBeenCalled();
  });

  it('mostra erro via toast quando falha ao carregar resumo', async () => {
    getOperationsSummary.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    render(<OperationsDashboardPage />);

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('Erro ao carregar resumo do painel operacional', 'error');
    });
  });

  it('renderiza insights ao trocar de aba', async () => {
    getOperationsInsights.mockResolvedValueOnce({
      summary: { total: 1, byVertical: { beauty: 1, fitness: 0 } },
      items: [
        {
          vertical: 'beauty',
          type: 'no_show_risk',
          score: 0.82,
          scoreSource: 'engine',
          reason: 'High no-show risk',
          action: 'send_confirmation_reminder',
          subjectId: 'sub-1',
        },
      ],
    });

    render(<OperationsDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Insights Operacionais'));

    await waitFor(() => {
      expect(screen.getByText('no_show_risk')).toBeInTheDocument();
      expect(screen.getByText(/High no-show risk/i)).toBeInTheDocument();
    });
  });

  it('busca cliente beauty e abre detalhe operacional', async () => {
    searchBeautyCustomers.mockResolvedValueOnce({
      items: [
        {
          subjectId: 'sub-beauty-1',
          customerId: 'cust-1',
          name: 'Maria Silva',
          document: '12345678900',
        },
      ],
    });

    getBeautyCustomerDetail.mockResolvedValueOnce({
      customer: {
        subjectId: 'sub-beauty-1',
        customerId: 'cust-1',
        name: 'Maria Silva',
        document: '12345678900',
      },
      indicators: {
        noShowRiskScore: 0.2,
        eligibleForReturn: true,
        followUpStatus: 'sent',
      },
      automation: {
        confirmationSent: true,
        reminder24hSent: true,
        reminderNearSent: false,
        followUpSent: true,
        reactivationSent: false,
      },
      bundle: {
        remaining: 2,
        total: 5,
        bundleType: 'facial',
      },
      recentAppointments: [],
      timeline: [],
      nextAppointment: null,
    });

    render(<OperationsDashboardPage />);

    await userEvent.click(screen.getByText('Atendimento Beauty'));

    await userEvent.type(screen.getByPlaceholderText('Buscar cliente por nome, documento, subjectId ou codigo'), 'Maria');
    await userEvent.click(screen.getByText('Buscar cliente'));

    await waitFor(() => {
      expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => {
      expect(screen.getByText('Registrar follow-up manual')).toBeInTheDocument();
      expect(screen.getByText(/no-show risk:/i)).toBeInTheDocument();
    });

    expect(getBeautyCustomerDetail).toHaveBeenCalledWith('sub-beauty-1', { limit: 150 });
  });

  it('executa check-in rapido no fitness', async () => {
    searchFitnessStudents.mockResolvedValueOnce({
      items: [
        {
          subjectId: 'sub-fit-1',
          membershipId: 'mem-1',
          name: 'Joao Treino',
          accessLabel: 'liberado',
          billingStatus: 'active',
          effectiveBillingStatus: 'active',
        },
      ],
    });

    render(<OperationsDashboardPage />);

    await userEvent.click(screen.getByText('Check-in Fitness'));
    await userEvent.type(screen.getByPlaceholderText('Buscar aluno por nome, documento, codigo ou subjectId'), 'Joao');
    await userEvent.click(screen.getByText('Buscar aluno'));

    await waitFor(() => {
      expect(screen.getByText('Joao Treino')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Check-in'));

    await waitFor(() => {
      expect(registerFitnessCheckIn).toHaveBeenCalledWith({
        subjectId: 'sub-fit-1',
        membershipId: 'mem-1',
        metadata: { triggeredBy: 'manual_ui' },
      });
    });
  });
});
