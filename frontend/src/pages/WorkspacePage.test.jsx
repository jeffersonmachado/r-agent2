import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkspacePage } from './WorkspacePage';

const testDoubles = vi.hoisted(() => ({
  auth: { agent: { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' } },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: testDoubles.auth.agent,
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
  }),
}));

vi.mock('../api/workspace', () => ({
  listWorkspaceEntities: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getWorkspaceTimeline: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0, hasMore: false }),
  getWorkspaceInsights: vi.fn().mockResolvedValue({ items: [], persisted: [] }),
  getWorkspaceActions: vi.fn().mockResolvedValue({ items: [], suggestion: null }),
  getWorkspaceIncidentRuns: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  createWorkspaceAction: vi.fn().mockResolvedValue({}),
  createWorkspaceEntity: vi.fn().mockResolvedValue({ entity: { id: 'e-1' } }),
  executeWorkspaceAutoActions: vi.fn().mockResolvedValue({}),
}));

describe('WorkspacePage — segregação por classificação', () => {
  beforeEach(() => {
    testDoubles.auth.agent = { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' };
  });

  it('PRODUCTION não vê a tab técnica nem labels técnicos', async () => {
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('Resumo')).toBeTruthy();
    });

    expect(screen.queryByText('QA/RPA')).toBeNull();
    expect(screen.queryByText('Falha QA/RPA')).toBeNull();
    // Filtro técnico da sidebar aparece com rótulo sanitizado
    expect(screen.getByText('Incidentes operacionais')).toBeTruthy();
  });

  it('DEVELOPMENT vê a tab QA/RPA e o filtro técnico', async () => {
    testDoubles.auth.agent = { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' };
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('QA/RPA')).toBeTruthy();
    });

    expect(screen.getByText('Falha QA/RPA')).toBeTruthy();
  });

  it('SUPPORT vê a tab QA/RPA (perfil interno)', async () => {
    testDoubles.auth.agent = { id: 'a-sup', role: 'auditor', classification: 'SUPPORT' };
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('QA/RPA')).toBeTruthy();
    });
  });

  it('PRODUCTION sanitiza eventos técnicos da timeline', async () => {
    const { getWorkspaceTimeline } = await import('../api/workspace');
    getWorkspaceTimeline.mockResolvedValueOnce({
      items: [
        { id: 'ev-1', type: 'evidence', source: 'qa-mesh', summary: 'Falha QA na wave 3', createdAt: '2026-08-01T10:00:00.000Z', payload: {} },
      ],
      total: 1,
      limit: 30,
      offset: 0,
      hasMore: false,
    });
    const { listWorkspaceEntities } = await import('../api/workspace');
    listWorkspaceEntities.mockResolvedValueOnce({ items: [{ id: 'e-1', type: 'contact', name: 'Cliente X' }], total: 1 });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Cliente X').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('Falha QA na wave 3')).toBeNull();
    });
    expect(screen.getAllByText('Instabilidade detectada e recuperada').length).toBeGreaterThan(0);
  });
});
