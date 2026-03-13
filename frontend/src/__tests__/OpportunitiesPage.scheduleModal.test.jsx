import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpportunitiesPage } from '../pages/crm/OpportunitiesPage';

const { scheduleModalMock, setOpportunitiesMock, setPipelinesMock } = vi.hoisted(() => ({
  scheduleModalMock: vi.fn(),
  setOpportunitiesMock: vi.fn(),
  setPipelinesMock: vi.fn(),
}));

vi.mock('../components/ScheduleModal', () => ({
  ScheduleModal: (props) => {
    scheduleModalMock(props);
    return <div data-testid="schedule-modal-mock">{props?.title || 'schedule-modal'}</div>;
  },
}));

const pipelines = [
  {
    id: 'pipe-1',
    name: 'Comercial',
    stages: [{ id: 'stage-1', name: 'Qualificação' }],
  },
];

const opportunities = [
  {
    id: 'opp-1',
    title: 'Venda ACME',
    description: 'Follow-up inicial',
    pipeline_id: 'pipe-1',
    stage_id: 'stage-1',
    contact_id: 'contact-9',
    value: 5000,
    probability: 60,
  },
];

vi.mock('../context/crm/CrmContext', () => ({
  useCrm: () => ({
    opportunities,
    setOpportunities: setOpportunitiesMock,
    pipelines,
    setPipelines: setPipelinesMock,
  }),
}));

vi.mock('../hooks/crm/useCrmApi', () => ({
  useCrmApi: () => ({
    listOpportunities: vi.fn(async () => ({ items: opportunities })),
    listPipelines: vi.fn(async () => ({ items: pipelines })),
    upsertOpportunity: vi.fn(async () => ({ ok: true })),
    deleteOpportunity: vi.fn(async () => ({ ok: true })),
    moveOpportunityStage: vi.fn(async () => ({ ok: true })),
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

describe('OpportunitiesPage schedule integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleModalMock.mockClear();
  });

  it('abre ScheduleModal ao clicar em Agendar na oportunidade', async () => {
    render(<OpportunitiesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Venda ACME/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Agendar$/i }));

    await waitFor(() => {
      expect(scheduleModalMock).toHaveBeenCalled();
    });

    const props = scheduleModalMock.mock.calls.at(-1)[0];
    expect(props.contextType).toBe('crm');
    expect(props.contextId).toBe('opp-1');
    expect(props.contactId).toBe('contact-9');
    expect(props.defaultPurpose).toBe('follow-up comercial');
  });
});
