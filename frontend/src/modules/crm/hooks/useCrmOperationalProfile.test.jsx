import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useCrmOperationalProfile } from './useCrmOperationalProfile';

const getCrmContactOperationalProfileMock = vi.fn();

vi.mock('../../../api/crm', () => ({
  getCrmContactOperationalProfile: (...args) => getCrmContactOperationalProfileMock(...args),
}));

function Probe({ contactId, enabled }) {
  const state = useCrmOperationalProfile({ contactId, enabled, timelineLimit: 10 });
  return (
    <div>
      <span data-testid="loading">{state.loading ? 'true' : 'false'}</span>
      <span data-testid="timeline-count">{state.timeline.length}</span>
      <span data-testid="has-profile">{state.profile ? 'yes' : 'no'}</span>
    </div>
  );
}

describe('useCrmOperationalProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('não consulta API quando feature está desabilitada', async () => {
    render(<Probe contactId="contact-1" enabled={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(getCrmContactOperationalProfileMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('timeline-count').textContent).toBe('0');
  });

  test('consulta API e popula estado quando habilitada', async () => {
    getCrmContactOperationalProfileMock.mockResolvedValueOnce({
      profile: { contact: { id: 'contact-1' } },
      timeline: { items: [{ id: 'evt-1' }] },
    });

    render(<Probe contactId="contact-1" enabled />);

    await waitFor(() => {
      expect(getCrmContactOperationalProfileMock).toHaveBeenCalledWith('contact-1', { timelineLimit: 10 });
      expect(screen.getByTestId('timeline-count').textContent).toBe('1');
      expect(screen.getByTestId('has-profile').textContent).toBe('yes');
    });
  });
});
