/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorkspacePage } from './WorkspacePage';

const apiMocks = vi.hoisted(() => ({
  listWorkspaceEntities: vi.fn(),
  createWorkspaceEntity: vi.fn(),
  getWorkspaceTimeline: vi.fn(),
  getWorkspaceInsights: vi.fn(),
  getWorkspaceAutoCorrections: vi.fn(),
  getWorkspaceActions: vi.fn(),
  createWorkspaceAction: vi.fn(),
  executeWorkspaceAutoActions: vi.fn(),
}));

vi.mock('../api/workspace', () => ({
  listWorkspaceEntities: apiMocks.listWorkspaceEntities,
  createWorkspaceEntity: apiMocks.createWorkspaceEntity,
  getWorkspaceTimeline: apiMocks.getWorkspaceTimeline,
  getWorkspaceInsights: apiMocks.getWorkspaceInsights,
  getWorkspaceAutoCorrections: apiMocks.getWorkspaceAutoCorrections,
  getWorkspaceActions: apiMocks.getWorkspaceActions,
  createWorkspaceAction: apiMocks.createWorkspaceAction,
  executeWorkspaceAutoActions: apiMocks.executeWorkspaceAutoActions,
}));

describe('WorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listWorkspaceEntities.mockResolvedValue({
      items: [{ id: 'entity-1', name: 'Cliente 360', type: 'contact', phone: '5511999999999' }],
    });
    apiMocks.createWorkspaceEntity.mockResolvedValue({ entity: { id: 'entity-1' } });
    apiMocks.getWorkspaceTimeline.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0, hasMore: false });
    apiMocks.getWorkspaceInsights.mockResolvedValue({ items: [], persisted: [] });
    apiMocks.getWorkspaceAutoCorrections.mockResolvedValue({ items: [], total: 0 });
    apiMocks.getWorkspaceActions.mockResolvedValue({
      items: [],
      suggestion: { type: 'followup', label: 'Follow-up', reason: 'Teste' },
    });
    apiMocks.createWorkspaceAction.mockResolvedValue({ ok: true });
    apiMocks.executeWorkspaceAutoActions.mockResolvedValue({ items: [] });
  });

  it('renders workspace shell and applies real tab filters', async () => {
    render(<WorkspacePage />);

    await waitFor(() => expect(screen.getAllByText('Cliente 360').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Tickets' }));

    await waitFor(() => {
      expect(apiMocks.getWorkspaceTimeline).toHaveBeenCalledWith('entity-1', expect.objectContaining({ type: 'ticket' }));
    });

    expect(screen.getByRole('button', { name: 'QA/RPA' })).toBeInTheDocument();
  });
});
