import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CRMTimelinePanel } from './CRMTimelinePanel';

describe('CRMTimelinePanel', () => {
  test('exibe mensagem de flag desabilitada', () => {
    render(
      <CRMTimelinePanel
        enabled={false}
        contactId="contact-1"
        profile={null}
        timeline={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/desabilitado para este tenant/i)).toBeInTheDocument();
  });

  test('renderiza itens da timeline quando disponíveis', () => {
    render(
      <CRMTimelinePanel
        enabled
        contactId="contact-1"
        profile={{ relationships: { opportunitiesCount: 2, revenueOpportunitiesCount: 1 } }}
        timeline={[
          { id: 'evt-1', type: 'support_ticket_created', created_at: '2026-03-01T10:00:00.000Z', source_module: 'support', payload: { status: 'waiting' } },
        ]}
        loading={false}
      />,
    );

    expect(screen.getByText(/Timeline CRM/i)).toBeInTheDocument();
    expect(screen.getByText(/opps 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Status: waiting/i)).toBeInTheDocument();
  });
});
