import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FitnessStudentsPage } from './FitnessStudentsPage';

const mocks = vi.hoisted(() => ({
  searchFitnessStudents: vi.fn(),
  getFitnessStudentDetail: vi.fn(),
  registerFitnessCheckIn: vi.fn(),
  registerFitnessCheckOut: vi.fn(),
  createFitnessStudent: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../api/verticalPilot', () => ({
  searchFitnessStudents: (...args) => mocks.searchFitnessStudents(...args),
  getFitnessStudentDetail: (...args) => mocks.getFitnessStudentDetail(...args),
  registerFitnessCheckIn: (...args) => mocks.registerFitnessCheckIn(...args),
  registerFitnessCheckOut: (...args) => mocks.registerFitnessCheckOut(...args),
  createFitnessStudent: (...args) => mocks.createFitnessStudent(...args),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast, ToastContainer: () => null }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchFitnessStudents.mockResolvedValue({ items: [] });
  mocks.getFitnessStudentDetail.mockResolvedValue(null);
  mocks.createFitnessStudent.mockResolvedValue({ subject: { id: 'stu-1' }, membership: { id: 'mem-1' } });
});

describe('FitnessStudentsPage — cadastro de aluno (gap corrigido)', () => {
  it('abre o formulário "Novo Aluno" e cria o aluno via API', async () => {
    render(<FitnessStudentsPage />);

    await userEvent.click(screen.getByRole('button', { name: '+ Novo Aluno' }));

    // Formulário visível
    expect(screen.getByText('Novo Aluno')).toBeTruthy();
    expect(screen.getByPlaceholderText('Nome completo')).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText('Nome completo'), 'Maria Teste');
    await userEvent.type(screen.getByPlaceholderText('+5511...'), '+5511988887777');
    await userEvent.type(screen.getByPlaceholderText('000.000.000-00'), '11122233344');

    await userEvent.click(screen.getByRole('button', { name: 'Criar aluno' }));

    await waitFor(() => {
      expect(mocks.createFitnessStudent).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.createFitnessStudent.mock.calls[0][0];
    expect(payload.name).toBe('Maria Teste');
    expect(payload.phone).toBe('+5511988887777');
    expect(payload.document).toBe('11122233344');
    expect(payload.subjectId).toMatch(/^stu-\d+$/);
    expect(payload.membershipId).toMatch(/^mem-\d+$/);
    expect(payload.billingStatus).toBe('active');
  });

  it('não cria aluno sem nome', async () => {
    render(<FitnessStudentsPage />);

    await userEvent.click(screen.getByRole('button', { name: '+ Novo Aluno' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar aluno' }));

    expect(mocks.createFitnessStudent).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('Informe o nome do aluno', 'error');
  });
});
