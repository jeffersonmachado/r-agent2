import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLogin = vi.fn();
const mockUpdateAgent = vi.fn();
const mockNavigate = vi.fn();
const mockShowToast = vi.fn();
const mockGetOnboardingCheck = vi.fn();
const mockListAllTenants = vi.fn();
const mockListTenants = vi.fn();

async function loadLoginWithMocks() {
  vi.resetModules();
  vi.unmock('../context/authContext');
  vi.unmock('../hooks/useRouter');
  vi.unmock('../components/Toast');
  vi.unmock('../styles/themeContext');
  vi.unmock('../api/onboarding');
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

  vi.doMock('../api/onboarding', () => ({
    getOnboardingCheck: mockGetOnboardingCheck,
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

/**
 * Fluxo atual (onboarding check unificado):
 * - usuário normal com tenantId passa por GET /onboarding/check no login;
 *   se `blocking`, é redirecionado para /onboarding?source=login.
 * - super-admin pula as verificações de onboarding ao selecionar tenant
 *   (vai direto para /workspace).
 */
describe('Login redirect for SMTP onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb) => cb());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usuário normal com onboarding bloqueante (SMTP pendente) é redirecionado para /onboarding', async () => {
    const user = userEvent.setup();

    mockLogin.mockResolvedValue({
      token: 'new-token',
      agent: { id: 'a1', username: 'admin1', tenantId: 'tenant-demo', role: 'admin' },
    });
    mockGetOnboardingCheck.mockResolvedValue({
      blocking: true,
      missingSteps: ['notifications.email.smtp.host', 'notifications.email.fromAddress'],
    });

    const { Login } = await loadLoginWithMocks();
    render(<Login />);

    await user.type(await screen.findByPlaceholderText('Digite seu username'), 'admin1');
    await user.type(await screen.findByPlaceholderText('Digite sua senha'), 'pw');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding?source=login');
    });

    expect(mockGetOnboardingCheck).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      'Configure os itens obrigatórios do onboarding para continuar.',
      'warning',
      8000
    );
    expect(mockNavigate).not.toHaveBeenCalledWith('/workspace');
  });

  it('super-admin selecionando tenant pula verificações de onboarding e vai para /workspace', async () => {
    const user = userEvent.setup();

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

    const { Login } = await loadLoginWithMocks();
    render(<Login />);

    await user.type(await screen.findByPlaceholderText('Digite seu username'), 'systemadmin');
    await user.type(await screen.findByPlaceholderText('Digite sua senha'), 'pw');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/Selecione o Tenant/i)).toBeInTheDocument();
    await user.click(screen.getByText('Tenant Demo'));
    await user.click(screen.getByRole('button', { name: 'Acessar' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/workspace');
    });

    expect(mockGetOnboardingCheck).not.toHaveBeenCalled();
  });
});
