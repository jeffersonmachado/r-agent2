import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const navigateMock = vi.fn();
const showToastMock = vi.fn();
const getOnboardingStatusMock = vi.fn();
const startOnboardingMock = vi.fn();
const completeOnboardingStepMock = vi.fn();
const completeOnboardingMock = vi.fn();
const createInitialTemplatesMock = vi.fn();
const getConfigMock = vi.fn();
const getIntegrationConfigReadinessMock = vi.fn();
const updateConfigMock = vi.fn();

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: { id: 'agent-1', role: 'admin' },
    isAuthenticated: true,
    loading: false,
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: navigateMock }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    ToastContainer: () => <div data-testid="toast-container" />,
  }),
}));

vi.mock('../modules/crud-base', () => ({
  CrudPageBase: ({ children }) => <div data-testid="crud-base">{children}</div>,
}));

vi.mock('../api/onboarding', () => ({
  getOnboardingStatus: (...args) => getOnboardingStatusMock(...args),
  startOnboarding: (...args) => startOnboardingMock(...args),
  completeOnboardingStep: (...args) => completeOnboardingStepMock(...args),
  completeOnboarding: (...args) => completeOnboardingMock(...args),
  createInitialTemplates: (...args) => createInitialTemplatesMock(...args),
}));

vi.mock('../api/config', () => ({
  getConfig: (...args) => getConfigMock(...args),
  getIntegrationConfigReadiness: (...args) => getIntegrationConfigReadinessMock(...args),
  updateConfig: (...args) => updateConfigMock(...args),
}));

describe('OnboardingPage SMTP integrations flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/onboarding?source=login&required=integrations');

    getOnboardingStatusMock.mockResolvedValue({
      onboarding: {
        progress: 20,
        completed: false,
        currentStep: 'create_admin_user',
        startedAt: '2026-05-11T10:00:00.000Z',
        steps: [
          {
            id: 'create_admin_user',
            label: 'Criar usuário administrador',
            description: 'Crie o primeiro usuário administrador do tenant',
            required: true,
            completed: false,
          },
        ],
      },
    });

    getConfigMock.mockResolvedValue({
      notifications: {
        email: {
          enabled: false,
          smtp: {
            host: '',
            port: 587,
            secure: false,
            username: '',
            password: '',
          },
          fromAddress: '',
          fromName: '',
        },
      },
    });

    getIntegrationConfigReadinessMock.mockResolvedValue({
      ready: false,
      missing: [
        { path: 'notifications.email.smtp.host', reason: 'Campo obrigatório quando notifications.email.enabled=true' },
      ],
    });

    updateConfigMock.mockResolvedValue({ success: true });
  });

  it('renderiza o bloco SMTP para onboarding obrigatório de integrações e navega para Config', async () => {
    const { OnboardingPage } = await import('../pages/OnboardingPage');

    render(<OnboardingPage />);

    expect(await screen.findByText('Integrações obrigatórias')).toBeInTheDocument();
    expect(screen.getByText(/Configure o SMTP do tenant aqui no onboarding/i)).toBeInTheDocument();
    expect(screen.getByText('Pendências detectadas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Abrir tela de configurações/i }));
    expect(navigateMock).toHaveBeenCalledWith('/config?tab=email');
  });

  it('salva a configuração SMTP e revalida integrações', async () => {
    getIntegrationConfigReadinessMock
      .mockResolvedValueOnce({
        ready: false,
        missing: [{ path: 'notifications.email.smtp.host', reason: 'missing' }],
      })
      .mockResolvedValueOnce({ ready: true, missing: [] });

    const { OnboardingPage } = await import('../pages/OnboardingPage');
    render(<OnboardingPage />);

    await screen.findByText('Integrações obrigatórias');

    fireEvent.click(screen.getByLabelText(/Habilitar Email transacional/i));
    fireEvent.change(screen.getByPlaceholderText('smtp.exemplo.com'), { target: { value: 'smtp.mail.local' } });
    fireEvent.change(screen.getByPlaceholderText('587'), { target: { value: '1025' } });
    fireEvent.change(screen.getByPlaceholderText('usuario'), { target: { value: 'mailer-user' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'mailer-pass' } });
    fireEvent.change(screen.getByPlaceholderText('no-reply@exemplo.com'), { target: { value: 'qa@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('Operações'), { target: { value: 'QA Waves' } });

    fireEvent.click(screen.getByRole('button', { name: /Salvar SMTP/i }));

    await waitFor(() => {
      expect(updateConfigMock).toHaveBeenCalledTimes(1);
    });

    expect(updateConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        email: expect.objectContaining({
          enabled: true,
          smtp: expect.objectContaining({
            host: 'smtp.mail.local',
            port: 1025,
            secure: false,
            username: 'mailer-user',
            password: 'mailer-pass',
          }),
          fromAddress: 'qa@example.test',
          fromName: 'QA Waves',
        }),
      }),
    }));

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('Configuração SMTP salva com sucesso!', 'success');
    });
  });
});
