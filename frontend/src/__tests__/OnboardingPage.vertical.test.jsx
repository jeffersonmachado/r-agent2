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
const setTenantVerticalMock = vi.fn();

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
  setTenantVertical: (...args) => setTenantVerticalMock(...args),
}));

function buildOnboarding({ connectChannelCompleted = false } = {}) {
  return {
    progress: 40,
    completed: false,
    currentStep: 'configure_ai_provider',
    startedAt: '2026-09-05T10:00:00.000Z',
    steps: [
      {
        id: 'create_admin_user',
        label: 'Criar usuário administrador',
        description: 'Crie o primeiro usuário administrador do tenant',
        required: true,
        category: 'required',
        autoDetect: true,
        completed: true,
      },
      {
        id: 'connect_channel',
        label: 'Conectar um canal de atendimento',
        description: 'Conecte pelo menos um canal (ex.: WhatsApp) para receber mensagens dos seus clientes. Voz é opcional.',
        required: false,
        category: 'recommended',
        autoDetect: true,
        completed: connectChannelCompleted,
      },
    ],
  };
}

describe('OnboardingPage — vertical e canal de atendimento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/onboarding');
    setTenantVerticalMock.mockResolvedValue({ vertical: 'fitness' });
  });

  it('renderiza o select de segmento com as verticais canônicas e persiste a escolha', async () => {
    getOnboardingStatusMock.mockResolvedValue({ onboarding: buildOnboarding() });

    const { OnboardingPage } = await import('../pages/OnboardingPage');
    render(<OnboardingPage />);

    expect(await screen.findByText('Qual é o segmento da sua empresa?')).toBeInTheDocument();

    const select = screen.getByLabelText('Selecionar segmento da empresa');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual([
      'Selecione o segmento...',
      'Beleza e Estética',
      'Academia e Fitness',
      'Padaria',
      'Alimentação/Restaurante',
      'Serviços',
      'Clínica e Saúde',
      'Varejo/Mercado',
    ]);

    fireEvent.change(select, { target: { value: 'fitness' } });

    await waitFor(() => {
      expect(setTenantVerticalMock).toHaveBeenCalledWith('fitness');
    });
  });

  it('exibe CTA para conectar canal quando o step não está completo', async () => {
    getOnboardingStatusMock.mockResolvedValue({ onboarding: buildOnboarding({ connectChannelCompleted: false }) });

    const { OnboardingPage } = await import('../pages/OnboardingPage');
    render(<OnboardingPage />);

    const cta = await screen.findByRole('button', { name: 'Conectar canal' });
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/whatsapp-connections');
  });

  it('exibe estado completo quando o canal já foi detectado', async () => {
    getOnboardingStatusMock.mockResolvedValue({ onboarding: buildOnboarding({ connectChannelCompleted: true }) });

    const { OnboardingPage } = await import('../pages/OnboardingPage');
    render(<OnboardingPage />);

    expect(await screen.findByText('Conectar um canal de atendimento')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conectar canal' })).not.toBeInTheDocument();
  });
});
