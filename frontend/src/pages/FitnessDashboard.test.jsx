/* @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FitnessDashboard } from './FitnessDashboard';

const showToastMock = vi.fn();
const getFitnessDashboardMock = vi.fn();
const createFitnessMembershipMock = vi.fn();
const saveFitnessAttendanceMock = vi.fn();
const createFitnessClassMock = vi.fn();
const createFitnessScheduleMock = vi.fn();
const createFitnessCheckinMock = vi.fn();
const createFitnessGoalMock = vi.fn();
const saveFitnessActivityProfessionalMock = vi.fn();
const saveFitnessActivityResourceMock = vi.fn();

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

vi.mock('../api/fitness', () => ({
  getFitnessDashboard: (...args) => getFitnessDashboardMock(...args),
  createFitnessMembership: (...args) => createFitnessMembershipMock(...args),
  saveFitnessAttendance: (...args) => saveFitnessAttendanceMock(...args),
  createFitnessClass: (...args) => createFitnessClassMock(...args),
  createFitnessSchedule: (...args) => createFitnessScheduleMock(...args),
  createFitnessCheckin: (...args) => createFitnessCheckinMock(...args),
  createFitnessGoal: (...args) => createFitnessGoalMock(...args),
  saveFitnessActivityProfessional: (...args) => saveFitnessActivityProfessionalMock(...args),
  saveFitnessActivityResource: (...args) => saveFitnessActivityResourceMock(...args),
}));

describe('FitnessDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFitnessDashboardMock.mockResolvedValue({
      summary: {
        classesActive: 1,
        schedulesTotal: 1,
        membershipsActive: 1,
        checkinsTotal: 1,
        retentionCandidates: 1,
        idleResources: 1,
        upsellCandidates: 1,
      },
      classes: [
        { id: 'class-1', name: 'Yoga', category: 'mind', durationMinutes: 60, defaultCapacity: 10, active: true },
      ],
      schedules: [
        { id: 'sch-1', classId: 'class-1', startAt: '2026-03-07T10:00:00.000Z', capacity: 10, remainingCapacity: 9, bookedCount: 1 },
      ],
      memberships: [
        { id: 'mem-1', memberId: 'member-1', planName: 'Gold', allowedWeeklyFrequency: 3, allowedCategories: ['mind'] },
      ],
      attendance: [],
      goals: [],
      checkins: [{ id: 'check-1', memberId: 'member-1', source: 'manual', checkedInAt: '2026-03-07T10:00:00.000Z' }],
      waitingList: [],
      recentSchedules: [],
      retentionCandidates: [{ id: 'ret-1', memberId: 'member-1', planName: 'Gold', inactiveDays: 15 }],
      professionals: [{ id: 'pro-1', name: 'Lia', roleType: 'instructor', specialties: ['yoga'] }],
      resources: [{ id: 'res-1', name: 'Sala 1', resourceType: 'room', capacity: 10 }],
      activityProfessionals: [],
      activityResources: [],
      schedulesByProfessional: [],
      schedulesByResource: [],
      idleResources: [{ id: 'res-1', name: 'Sala 1', idleSchedules: 0 }],
      operationalConflicts: [{ scheduleId: 'sch-1', classId: 'class-1', reason: 'capacity_conflict', remainingCapacity: 0, professionalIds: [], resourceIds: [] }],
      upsellCandidates: [{ id: 'up-1', memberId: 'member-1', planName: 'Gold', reason: 'Alta frequência', bookedCount: 3, allowedWeeklyFrequency: 3 }],
    });
    createFitnessMembershipMock.mockResolvedValue({ ok: true });
    saveFitnessAttendanceMock.mockResolvedValue({ ok: true });
    createFitnessClassMock.mockResolvedValue({ ok: true });
    createFitnessScheduleMock.mockResolvedValue({ ok: true });
    createFitnessCheckinMock.mockResolvedValue({ ok: true });
    createFitnessGoalMock.mockResolvedValue({ ok: true });
    saveFitnessActivityProfessionalMock.mockResolvedValue({ ok: true });
    saveFitnessActivityResourceMock.mockResolvedValue({ ok: true });
  });

  it('renderiza dados principais do dashboard Fitness', async () => {
    render(<FitnessDashboard />);

    expect(await screen.findByText('Fitness Dashboard')).toBeInTheDocument();
    expect((await screen.findAllByText('Yoga')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Retenção/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Waiting List Fitness/i)).toBeInTheDocument();
    expect(await screen.findByText(/Recursos Ociosos/i)).toBeInTheDocument();
    expect(await screen.findByText(/Upsell de Plano/i)).toBeInTheDocument();
  });

  it('envia membership com categorias permitidas e attendance com auto waiting list', async () => {
    const { container } = render(<FitnessDashboard />);
    await screen.findByText('Fitness Dashboard');

    let memberInputs = screen.getAllByPlaceholderText('Member ID');
    fireEvent.change(memberInputs[0], { target: { value: 'member-2' } });
    fireEvent.change(screen.getByPlaceholderText('Plano'), { target: { value: 'Studio' } });
    const membershipDateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(membershipDateInputs[0], { target: { value: '2026-03-07' } });
    fireEvent.change(screen.getByPlaceholderText('Turmas permitidas (IDs)'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByPlaceholderText('Categorias permitidas'), { target: { value: 'mind, yoga' } });
    fireEvent.change(screen.getByPlaceholderText('Frequência semanal'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await waitFor(() => {
      expect(createFitnessMembershipMock).toHaveBeenCalledWith(expect.objectContaining({
        memberId: 'member-2',
        planName: 'Studio',
        allowedClasses: ['class-1'],
        allowedCategories: ['mind', 'yoga'],
        allowedWeeklyFrequency: 2,
      }));
    });

    memberInputs = screen.getAllByPlaceholderText('Member ID');
    const selects = screen.getAllByRole('combobox');
    const attendanceSelect = selects.find((element) => element.textContent.includes('Aula') && !element.textContent.includes('Aula opcional'));
    fireEvent.change(attendanceSelect, { target: { value: 'sch-1' } });
    fireEvent.change(memberInputs[1], { target: { value: 'member-2' } });
    const waitingListCheckbox = screen.getByLabelText(/Entrar na waiting list se lotar/i);
    fireEvent.change(waitingListCheckbox, { target: { checked: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar presença' }));

    await waitFor(() => {
      expect(saveFitnessAttendanceMock).toHaveBeenCalledWith(expect.objectContaining({
        classScheduleId: 'sch-1',
        memberId: 'member-2',
        autoJoinWaitingList: true,
      }));
    });
  });

  it('envia vinculos de atividade com profissional e recurso', async () => {
    render(<FitnessDashboard />);
    await screen.findByText('Fitness Dashboard');

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects.find((element) => element.textContent.includes('Turma/atividade')), { target: { value: 'class-1' } });
    fireEvent.change(selects.find((element) => element.textContent.includes('Profissional')), { target: { value: 'pro-1' } });
    fireEvent.change(screen.getByPlaceholderText('Duração específica'), { target: { value: '50' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar vínculo' })[0]);

    await waitFor(() => {
      expect(saveFitnessActivityProfessionalMock).toHaveBeenCalledWith(expect.objectContaining({
        activityId: 'class-1',
        professionalId: 'pro-1',
        durationMinutes: 50,
      }));
    });
  });
});
