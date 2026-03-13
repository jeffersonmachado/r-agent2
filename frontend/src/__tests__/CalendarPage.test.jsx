import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalendarPage } from '../pages/CalendarPage';

const mocks = vi.hoisted(() => ({
  getMyCalendarMock: vi.fn(),
  getResourceCalendarMock: vi.fn(),
  createResourceBlockMock: vi.fn(),
  deleteResourceBlockMock: vi.fn(),
  showToastMock: vi.fn(),
  useRouterMock: vi.fn(),
}));

vi.mock('../api/calendar', () => ({
  getMyCalendar: (...args) => mocks.getMyCalendarMock(...args),
  getResourceCalendar: (...args) => mocks.getResourceCalendarMock(...args),
  createResourceBlock: (...args) => mocks.createResourceBlockMock(...args),
  deleteResourceBlock: (...args) => mocks.deleteResourceBlockMock(...args),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: mocks.showToastMock,
    ToastContainer: () => <div data-testid="toast-container" />,
  }),
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: { id: 'agent-1', role: 'operator' },
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => mocks.useRouterMock(),
}));

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRouterMock.mockReturnValue({ currentPath: '/agenda' });
    mocks.getMyCalendarMock.mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'sch-1',
          type: 'schedule',
          title: 'Retorno',
          startAt: '2026-03-05T13:00:00.000Z',
          endAt: '2026-03-05T13:30:00.000Z',
          contextType: 'ticket',
          contextId: 'ticket-10',
        },
      ],
    });
    mocks.getResourceCalendarMock.mockResolvedValue({ ok: true, items: [] });
    mocks.createResourceBlockMock.mockResolvedValue({ ok: true, block: { id: 'blk-1' } });
    mocks.deleteResourceBlockMock.mockResolvedValue({ ok: true, block: { id: 'blk-1', active: false } });
  });

  it('renderiza eventos da minha agenda', async () => {
    render(<CalendarPage />);

    await waitFor(() => {
      expect(mocks.getMyCalendarMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/Retorno/i)).toBeInTheDocument();
    expect(screen.getByText(/Contexto: ticket/i)).toBeInTheDocument();
  });

  it('cria e remove bloqueio', async () => {
    mocks.getMyCalendarMock
      .mockResolvedValueOnce({ ok: true, items: [] })
      .mockResolvedValueOnce({
        ok: true,
        items: [
          {
            id: 'blk-1',
            type: 'block',
            title: 'Indisponível',
            startAt: '2026-03-05T13:00:00.000Z',
            endAt: '2026-03-05T14:00:00.000Z',
            reason: 'Almoço',
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, items: [] });

    render(<CalendarPage />);
    await waitFor(() => expect(mocks.getMyCalendarMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Criar bloqueio/i }));
    const datetimeInputs = document.querySelectorAll('input[type=\"datetime-local\"]');
    fireEvent.change(datetimeInputs[0], { target: { value: '2026-03-05T10:00' } });
    fireEvent.change(datetimeInputs[1], { target: { value: '2026-03-05T11:00' } });
    fireEvent.change(document.querySelector('textarea'), { target: { value: 'Almoço' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^Criar bloqueio$/i })[1]);

    await waitFor(() => expect(mocks.createResourceBlockMock).toHaveBeenCalledTimes(1));
    expect(mocks.createResourceBlockMock.mock.calls[0][0]).toBe('agent-1');

    expect(await screen.findByText(/Indisponível/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remover/i }));

    await waitFor(() => expect(mocks.deleteResourceBlockMock).toHaveBeenCalledTimes(1));
    expect(mocks.deleteResourceBlockMock.mock.calls[0][0]).toBe('agent-1');
    expect(mocks.deleteResourceBlockMock.mock.calls[0][1]).toBe('blk-1');
  });
});
