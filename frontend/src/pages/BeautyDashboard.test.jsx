/* @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BeautyDashboard } from './BeautyDashboard';

const showToastMock = vi.fn();
const getBeautyDashboardMock = vi.fn();
const createBeautyProfessionalMock = vi.fn();
const createBeautyServiceMock = vi.fn();
const saveBeautyAssignmentMock = vi.fn();
const updateBeautyCompositionsMock = vi.fn();
const updateBeautyLoyaltyMock = vi.fn();
const updateBeautyPreferenceMock = vi.fn();
const resolveBeautyBundleMock = vi.fn();
const listBeautyCompositionsMock = vi.fn();
const createBeautyBookingMock = vi.fn();

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: { role: 'admin', tenantId: 'tenant-1' },
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../utils/menuPermissions', () => ({
  hasPermission: () => true,
}));

vi.mock('../api/beauty', () => ({
  getBeautyDashboard: (...args) => getBeautyDashboardMock(...args),
  createBeautyProfessional: (...args) => createBeautyProfessionalMock(...args),
  createBeautyService: (...args) => createBeautyServiceMock(...args),
  saveBeautyAssignment: (...args) => saveBeautyAssignmentMock(...args),
  updateBeautyCompositions: (...args) => updateBeautyCompositionsMock(...args),
  updateBeautyLoyalty: (...args) => updateBeautyLoyaltyMock(...args),
  updateBeautyPreference: (...args) => updateBeautyPreferenceMock(...args),
  resolveBeautyBundle: (...args) => resolveBeautyBundleMock(...args),
  listBeautyCompositions: (...args) => listBeautyCompositionsMock(...args),
  createBeautyBooking: (...args) => createBeautyBookingMock(...args),
  updateBeautyProfessional: vi.fn(),
  updateBeautyService: vi.fn(),
}));

describe('BeautyDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBeautyDashboardMock.mockResolvedValue({
      summary: {
        professionalsActive: 1,
        servicesActive: 1,
        assignmentsTotal: 1,
        waitingListBeauty: 1,
      },
      professionals: [
        { id: 'pro-1', name: 'Ana', specialty: 'Cabelo', scheduleRef: 'ana', active: true },
      ],
      services: [
        { id: 'svc-1', name: 'Escova', category: 'hair', defaultDuration: 45, defaultPrice: 80, active: true },
      ],
      assignments: [
        { id: 'asg-1', serviceId: 'svc-1', professionalId: 'pro-1', durationMinutes: 40, priceAmount: 90 },
      ],
      loyalty: [],
      preferences: [],
      waitingList: [{ id: 'wait-1', contactId: 'contact-1', serviceType: 'Escova' }],
      recentSchedules: [],
      reactivationCandidates: [{ id: 'loy-1', contactId: 'contact-1', inactiveDays: 50 }],
    });
    listBeautyCompositionsMock.mockResolvedValue({ items: [] });
    createBeautyProfessionalMock.mockResolvedValue({ ok: true });
    createBeautyServiceMock.mockResolvedValue({ ok: true });
    saveBeautyAssignmentMock.mockResolvedValue({ ok: true });
    updateBeautyCompositionsMock.mockResolvedValue({ ok: true });
    updateBeautyLoyaltyMock.mockResolvedValue({ ok: true });
    updateBeautyPreferenceMock.mockResolvedValue({ ok: true });
    resolveBeautyBundleMock.mockResolvedValue({ bundle: { items: [], totalDurationMinutes: 0, totalPriceAmount: 0 } });
    createBeautyBookingMock.mockResolvedValue({ ok: true });
  });

  it('renderiza dados principais do dashboard Beauty', async () => {
    render(<BeautyDashboard />);

    expect(await screen.findByText('Beauty Dashboard')).toBeInTheDocument();
    expect((await screen.findAllByText('Ana')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Escova')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: /Waiting List Beauty/i })).toBeInTheDocument();
    expect((await screen.findAllByText(/Reativação/i)).length).toBeGreaterThan(0);
  });

  it('envia criação de profissional', async () => {
    render(<BeautyDashboard />);
    await screen.findByText('Beauty Dashboard');

    const inputs = screen.getAllByPlaceholderText('Nome');
    fireEvent.change(inputs[0], { target: { value: 'Beatriz' } });
    fireEvent.change(screen.getByPlaceholderText('Especialidade'), { target: { value: 'Unhas' } });
    fireEvent.change(screen.getByPlaceholderText('scheduleRef'), { target: { value: 'bea' } });

    const addButtons = screen.getAllByRole('button', { name: 'Adicionar' });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(createBeautyProfessionalMock).toHaveBeenCalledWith({
        name: 'Beatriz',
        specialty: 'Unhas',
        specialties: [],
        maxDailySessions: null,
        scheduleRef: 'bea',
        active: true,
      });
    });
  });

  it('envia booking operacional minimo', async () => {
    render(<BeautyDashboard />);
    await screen.findByText('Beauty Dashboard');

    const bookingSection = screen.getByRole('heading', { name: 'Booking Operacional' }).closest('section');
    const scoped = within(bookingSection);
    fireEvent.change(scoped.getByPlaceholderText('Contact ID'), { target: { value: 'contact-1' } });
    const selects = scoped.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'svc-1' } });
    fireEvent.change(selects[1], { target: { value: 'pro-1' } });
    fireEvent.change(bookingSection.querySelector('input[type="datetime-local"]'), { target: { value: '2026-03-07T10:00' } });
    fireEvent.click(scoped.getByRole('button', { name: 'Criar booking' }));

    await waitFor(() => {
      expect(createBeautyBookingMock).toHaveBeenCalledWith(expect.objectContaining({
        contactId: 'contact-1',
        serviceId: 'svc-1',
        professionalId: 'pro-1',
      }));
    });
  });
});
