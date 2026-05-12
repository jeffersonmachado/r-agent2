import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLogin = vi.fn();
const mockUpdateAgent = vi.fn();
const mockNavigate = vi.fn();
const mockShowToast = vi.fn();
const mockValidateTenantAiCredentials = vi.fn();
const mockGetIntegrationConfigReadiness = vi.fn();
const mockListAllTenants = vi.fn();
const mockListTenants = vi.fn();

async function loadLoginWithMocks() {
  vi.resetModules();
  vi.unmock('../context/authContext');
  vi.unmock('../hooks/useRouter');
  vi.unmock('../components/Toast');
  vi.unmock('../styles/themeContext');
  vi.unmock('../api/config');
  vi.unmock('../api/superAdmin');
  vi.unmock('../api/tenants');

  vi.doMock('../context/authContext', () => ({
    useAuth: () => ({
      login: mockLogin,
      isAuthenticated: false,
      agent: null,
      updateAgent: mockUpdateAgent,
    }),
  }));

  vi.doMock('../hooks/useRouter', () => ({
    useRouter: () => ({
      navigate: mockNavigate,
      currentPath: '/login',
    }),
  }));

  vi.doMock('../components/Toast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
  }));

  vi.doMock('../styles/themeContext', () => ({
    useTheme: () => ({
      themeName: 'light',
      toggleTheme: vi.fn(),
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

  vi.doMock('../api/config', () => ({
    validateTenantAiCredentials: mockValidateTenantAiCredentials,
    getIntegrationConfigReadiness: mockGetIntegrationConfigReadiness,
  }));

  vi.doMock('../api/superAdmin', () => ({
    listAllTenants: mockListAllTenants,
  }));

  vi.doMock('../api/tenants', () => ({
    listTenants: mockListTenants,
  }));

  const [{ Login }] = await Promise.all([
    import('../components/Login'),
  ]);

  return { Login };
}

describe('Login redirect for SMTP onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb) => cb());

    mockLogin.mockResolvedValue({
      token: 'new-token',
      agent: { id: 'sa', username: 'systemadmin', tenantId: 'system', role: 'super_admin' },
    });

    mockListAllTenants.mockResolvedValue({
      tenants: [
        { id: 'system', name: 'System' },
        { id: 'tenant-demo', name: 'Tenant Demo' },
      ],
    });

    mockValidateTenantAiCredentials.mockResolvedValue({ valid: true });
    mockGetIntegrationConfigReadiness.mockResolvedValue({
      ready: false,
      missing: [
        { path: 'notifications.email.smtp.host' },
        { path: 'notifications.email.fromAddress' },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redireciona para onboarding de integrações já apontando para SMTP', async () => {
    const user = userEvent.setup();
    const { Login } = await loadLoginWithMocks();

    render(<Login />);

    await user.type(await screen.findByPlaceholderText('Digite seu username'), 'systemadmin');
    await user.type(await screen.findByPlaceholderText('Digite sua senha'), 'pw');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/Selecione o Tenant/i)).toBeInTheDocument();
    await user.click(screen.getByText('Tenant Demo'));
    await user.click(screen.getByRole('button', { name: 'Acessar' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding?source=login&required=integrations&tab=email');
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('notifications.email.smtp.host'),
      'warning',
      9000
    );
  });
});
