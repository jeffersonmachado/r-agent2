import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactsPage } from '../pages/crm/ContactsPage';

const { scheduleModalMock, setContactsMock, listContactsMock } = vi.hoisted(() => ({
  scheduleModalMock: vi.fn(),
  setContactsMock: vi.fn(),
  listContactsMock: vi.fn(async () => ({
    items: [{ id: 'contact-1', name: 'Ana Silva', email: 'ana@x.com', phone: '5511999999999' }],
    total: 1,
  })),
}));

vi.mock('../components/ScheduleModal', () => ({
  ScheduleModal: (props) => {
    scheduleModalMock(props);
    return <div data-testid="schedule-modal-mock">{props?.title || 'schedule-modal'}</div>;
  },
}));

vi.mock('../context/crm/CrmContext', () => ({
  useCrm: () => ({
    contacts: [{ id: 'contact-1', name: 'Ana Silva', email: 'ana@x.com', phone: '5511999999999' }],
    setContacts: setContactsMock,
  }),
}));

vi.mock('../hooks/crm/useCrmApi', () => ({
  useCrmApi: () => ({
    listContacts: listContactsMock,
    upsertContact: vi.fn(async () => ({ ok: true })),
    deleteContact: vi.fn(async () => ({ ok: true })),
    loading: false,
  }),
}));

const showToastMock = vi.fn();
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    ToastContainer: () => <div data-testid="toast-container" />,
  }),
}));

describe('ContactsPage schedule integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleModalMock.mockClear();
  });

  it('abre ScheduleModal ao agendar a partir do contato', async () => {
    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Ana Silva/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Ana Silva/i));

    const scheduleBtn = await screen.findByRole('button', { name: /Agendar para este contato/i });
    fireEvent.click(scheduleBtn);

    await waitFor(() => {
      expect(scheduleModalMock).toHaveBeenCalled();
    });

    const props = scheduleModalMock.mock.calls.at(-1)[0];
    expect(props.contextType).toBe('crm');
    expect(props.contextId).toBe('contact-1');
    expect(props.contactId).toBe('contact-1');
    expect(props.defaultPurpose).toBe('reunião');
  });
});
