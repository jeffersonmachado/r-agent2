import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdateAgent = vi.fn();
const mockListAllTenants = vi.fn();

async function loadTenantGateWithMocks({ agent, isAuthenticated = true } = {}) {
  vi.resetModules();

  vi.doMock('../context/authContext', () => ({
    useAuth: () => ({
      isAuthenticated,
      agent,
      updateAgent: mockUpdateAgent,
    }),
  }));

  vi.doMock('../styles/themeContext', () => ({
    useTheme: () => ({
      themeName: 'light',
      theme: {
        colors: {
          bg: { primary: '#fff', secondary: '#fff', tertiary: '#fff', hover: '#f5f5f5' },
          border: { default: '#ddd', hover: '#ccc' },
          text: { primary: '#111', secondary: '#333', tertiary: '#666' },
          accent: { primary: '#00f', light: '#ccf' },
          status: { error: '#f00' },
        },
      },
    }),
  }));

  vi.doMock('../api/superAdmin', () => ({
    listAllTenants: mockListAllTenants,
  }));

  vi.doMock('../api/tenants', () => ({
    listTenants: vi.fn(),
  }));

  const [{ TenantGate }] = await Promise.all([import('../components/TenantGate')]);
  return { TenantGate };
}

describe('TenantGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    // Importante: com `isolate: false`, garantimos que mocks deste arquivo não “vazem”
    // para outros testes.
    vi.resetModules();
    vi.unmock('../context/authContext');
    vi.unmock('../styles/themeContext');
    vi.unmock('../api/superAdmin');
    vi.unmock('../api/tenants');
  });

  it('deve abrir modal e exigir seleção explícita quando super-admin está em tenant=system', async () => {
    const user = userEvent.setup();
    const { TenantGate } = await loadTenantGateWithMocks({
      agent: { id: 'sa', username: 'systemadmin', role: 'super_admin', tenantId: 'system' },
      isAuthenticated: true,
    });

    mockListAllTenants.mockResolvedValueOnce({
      tenants: [
        { id: 'system', name: 'System' },
        { id: 'tenant-demo', name: 'Tenant Demo' },
      ],
    });

    render(<TenantGate />);

    expect(await screen.findByText('Selecione o Tenant')).toBeInTheDocument();
    // No gate, a confirmação é automática ao clicar no tenant.

    await user.click(screen.getByText('Tenant Demo'));

    await waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-demo',
          originalTenantId: 'system',
        }),
      );
    });

    expect(localStorage.getItem('auth_effective_tenant_id')).toBe('tenant-demo');
  });

  it('deve permitir selecionar explicitamente o tenant system (fecha o gate ao persistir effectiveTenantId)', async () => {
    const user = userEvent.setup();
    const { TenantGate } = await loadTenantGateWithMocks({
      agent: { id: 'sa', username: 'systemadmin', role: 'super_admin', tenantId: 'system' },
      isAuthenticated: true,
    });

    mockListAllTenants.mockResolvedValueOnce({
      tenants: [
        { id: 'system', name: 'System' },
        { id: 'tenant-demo', name: 'Tenant Demo' },
      ],
    });

    render(<TenantGate />);
    expect(await screen.findByText('Selecione o Tenant')).toBeInTheDocument();

    await user.click(screen.getByText('System'));

    await waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'system',
          originalTenantId: 'system',
        }),
      );
    });

    expect(localStorage.getItem('auth_effective_tenant_id')).toBe('system');
  });
});

