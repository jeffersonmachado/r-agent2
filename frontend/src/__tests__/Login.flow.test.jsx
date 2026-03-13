import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLogin = vi.fn();
const mockUpdateAgent = vi.fn();
const mockNavigate = vi.fn();
const mockShowToast = vi.fn();
const mockValidateTenantAiCredentials = vi.fn();
const mockListAllTenants = vi.fn();
const mockListTenants = vi.fn();

async function loadLoginWithMocks() {
  // Com `isolate: false` (vitest.config.mjs), mocks e cache de módulos podem “vazar”
  // entre arquivos. Para garantir previsibilidade, resetamos o grafo de módulos e
  // aplicamos mocks ANTES de importar o componente.
  vi.resetModules();
  // Alguns testes do projeto usam `vi.mock` hoisted; garantimos que nossos mocks
  // prevaleçam neste arquivo.
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
    useToast: () => ({
      showToast: mockShowToast,
    }),
  }));

  vi.doMock('../styles/themeContext', () => ({
    useTheme: () => ({
      themeName: 'light',
      toggleTheme: vi.fn(),
      theme: {
        colors: {
          bg: {
            primary: '#fff',
            secondary: '#fff',
            tertiary: '#fff',
            hover: '#f5f5f5',
          },
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

describe('Login (via formulário) - seleção de tenant obrigatória', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // requestAnimationFrame usado no Login.jsx
    vi.stubGlobal('requestAnimationFrame', (cb) => cb());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deve limpar auth_token/auth_agent ao submeter e redirecionar direto para /support (usuário comum com tenantId)', async () => {
    const user = userEvent.setup();
    const { Login } = await loadLoginWithMocks();

    localStorage.setItem('auth_token', 'old-token');
    localStorage.setItem('auth_agent', JSON.stringify({ tenantId: 'old-tenant' }));
    localStorage.setItem('auth_last_tenant_id', 'old-last-tenant');

    mockLogin.mockResolvedValueOnce({
      token: 'new-token',
      agent: { id: 'a1', username: 'u1', tenantId: 't1', role: 'operator' },
    });

    mockValidateTenantAiCredentials.mockResolvedValueOnce({ valid: true });

    render(<Login />);

    await user.type(await screen.findByPlaceholderText('Digite seu username'), 'u1');
    await user.type(await screen.findByPlaceholderText('Digite sua senha'), 'pw');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    // sessão local deve ter sido zerada no início do submit
    expect(localStorage.getItem('auth_token')).toBe(null);
    expect(localStorage.getItem('auth_agent')).toBe(null);

    // não deve reaproveitar last tenant em login via formulário
    expect(localStorage.getItem('auth_last_tenant_id')).toBe(null);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/support');
    });

    // No fluxo atual, usuário comum com tenantId não passa pelo modal de seleção
    expect(screen.queryByText(/Selecione o Tenant/i)).not.toBeInTheDocument();
    expect(mockValidateTenantAiCredentials).not.toHaveBeenCalled();
  });

  it('deve listar tenants para super-admin e manter originalTenantId ao selecionar tenant diferente', async () => {
    const user = userEvent.setup();
    const { Login } = await loadLoginWithMocks();

    mockLogin.mockResolvedValueOnce({
      token: 'new-token',
      agent: { id: 'sa', username: 'systemadmin', tenantId: 'system', role: 'super_admin' },
    });

    mockListAllTenants.mockResolvedValueOnce({
      tenants: [
        { id: 'system', name: 'System' },
        { id: 'tenant-demo', name: 'Tenant Demo' },
      ],
    });

    mockValidateTenantAiCredentials.mockResolvedValueOnce({ valid: true });

    render(<Login />);

    await user.type(await screen.findByPlaceholderText('Digite seu username'), 'systemadmin');
    await user.type(await screen.findByPlaceholderText('Digite sua senha'), 'pw');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText(/Selecione o Tenant/i)).toBeInTheDocument();

    // Em modo explícito, começa desabilitado
    expect(screen.getByRole('button', { name: 'Acessar' })).toBeDisabled();

    // seleciona tenant-demo e confirma
    await user.click(screen.getByText('Tenant Demo'));
    await user.click(screen.getByRole('button', { name: 'Acessar' }));

    await waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-demo',
          originalTenantId: 'system',
          username: 'systemadmin',
        })
      );
      expect(mockValidateTenantAiCredentials).toHaveBeenCalledWith({ tenantId: 'tenant-demo' });
    });
  });
});
