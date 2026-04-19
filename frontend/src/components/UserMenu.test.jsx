import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserMenu } from './UserMenu';

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: { id: 'a1', name: 'Admin Demo', username: 'admin', role: 'admin', tenantId: 'tenant-demo' },
    logout: vi.fn(),
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

vi.mock('./Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: true,
    authenticated: true,
  }),
}));

vi.mock('../api/tickets', () => ({
  listAllTickets: vi.fn().mockResolvedValue({ tickets: [] }),
}));

vi.mock('../api/auth', () => ({
  logoutAll: vi.fn().mockResolvedValue({ sessionsRemoved: 0 }),
}));

vi.mock('../utils/menuPermissions', () => ({
  getVisibleMenuItems: () => [],
}));

describe('UserMenu', () => {
  it('mostra tenant e vertical no dropdown', async () => {
    render(
      <UserMenu
        showNavigation={false}
        tenantLabel="Tenant Demo"
        verticalLabels={['Fitness']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /menu do usuário/i }));

    await waitFor(() => {
      expect(screen.getByText((content, element) => element?.textContent === '🏢 Tenant Demo')).toBeInTheDocument();
    });
    expect(screen.getByText((content, element) => element?.textContent === '🧭 Fitness')).toBeInTheDocument();
  });
});