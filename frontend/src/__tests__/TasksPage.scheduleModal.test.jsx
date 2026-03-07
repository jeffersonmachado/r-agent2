import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TasksPage } from '../pages/TasksPage';

const { scheduleModalMock } = vi.hoisted(() => ({
  scheduleModalMock: vi.fn(),
}));

vi.mock('../components/ScheduleModal', () => ({
  ScheduleModal: (props) => {
    scheduleModalMock(props);
    return <div data-testid="schedule-modal-mock">{props?.title || 'schedule-modal'}</div>;
  },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

const navigateMock = vi.fn();
vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: navigateMock }),
}));

const showToastMock = vi.fn();
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    ToastContainer: () => <div data-testid="toast-container" />,
  }),
}));

vi.mock('../api/tasks', () => ({
  createTask: vi.fn(async () => ({ ok: true })),
  listTasks: vi.fn(async () => ({
    tasks: [
      {
        id: 'task-1',
        title: 'Cobrar retorno do cliente',
        description: 'Aguardar confirmação interna',
        dueAt: '2026-03-05T15:00:00.000Z',
        reminderAt: null,
        priority: 'normal',
        status: 'open',
      },
    ],
  })),
  completeTask: vi.fn(async () => ({ ok: true })),
  scheduleTaskReminder: vi.fn(async () => ({ ok: true })),
}));

describe('TasksPage schedule integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleModalMock.mockClear();
  });

  it('abre ScheduleModal com contexto task ao clicar em Agendar', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(screen.getByText(/Cobrar retorno do cliente/i)).toBeInTheDocument();
    });

    const scheduleButtons = screen.getAllByRole('button', { name: /^Agendar$/i });
    fireEvent.click(scheduleButtons[0]);

    await waitFor(() => {
      expect(scheduleModalMock).toHaveBeenCalled();
    });

    const props = scheduleModalMock.mock.calls.at(-1)[0];
    expect(props.contextType).toBe('task');
    expect(props.contextId).toBe('task-1');
    expect(props.defaultPurpose).toBe('tarefa futura');
    expect(props.defaultChannel).toBe('internal');
  });
});
