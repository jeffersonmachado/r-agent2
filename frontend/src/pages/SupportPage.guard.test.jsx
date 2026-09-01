import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SupportPage } from './SupportPage';

const testDoubles = vi.hoisted(() => ({
  navigate: vi.fn(),
  showToast: vi.fn(),
  auth: {
    agent: { id: 'a-owner', role: 'owner' },
    capabilities: { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' },
  },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    agent: testDoubles.auth.agent,
    capabilities: testDoubles.auth.capabilities,
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: testDoubles.navigate, currentPath: '/support' }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: testDoubles.showToast,
    ToastContainer: () => null,
  }),
}));

vi.mock('../components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: vi.fn(),
    ConfirmDialog: () => null,
  }),
}));

vi.mock('../hooks/usePhoneMasking', () => ({
  usePhoneMasking: () => ({ enabled: false }),
}));

vi.mock('../modules/crud-base', () => ({
  CrudPageBase: ({ children }) => <div>{children}</div>,
}));

describe('SupportPage — guard de capability (Central de Atendimento legada)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDoubles.auth.agent = { id: 'a-owner', role: 'owner' };
    testDoubles.auth.capabilities = { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' };
  });

  it('tenant simple (caseManagement=false): mostra guard e NÃO renderiza o shell ticket-based', () => {
    render(<SupportPage />);

    expect(screen.getByText('Case Management não está ativo')).toBeTruthy();
    expect(screen.queryByTestId('support-page')).toBeNull();
  });

  it('capabilities ausentes: fail-closed (guard exibido)', () => {
    testDoubles.auth.capabilities = undefined;
    render(<SupportPage />);

    expect(screen.getByText('Case Management não está ativo')).toBeTruthy();
    expect(screen.queryByTestId('support-page')).toBeNull();
  });

  it('guard aponta para o Inbox (superfície canônica)', () => {
    render(<SupportPage />);

    fireEvent.click(screen.getByText('Ir para Caixa de Entrada'));
    expect(testDoubles.navigate).toHaveBeenCalledWith('/inbox');
  });

  it('guard oferece CTA de ativação apenas para owner/admin/super_admin', () => {
    testDoubles.auth.agent = { id: 'a-op', role: 'operator' };
    render(<SupportPage />);

    expect(screen.getByText('Case Management não está ativo')).toBeTruthy();
    expect(screen.queryByText('Ativar em Configurações')).toBeNull();
  });

  it('admin vê o CTA de ativação que leva a /config', () => {
    testDoubles.auth.agent = { id: 'a-admin', role: 'admin' };
    render(<SupportPage />);

    fireEvent.click(screen.getByText('Ativar em Configurações'));
    expect(testDoubles.navigate).toHaveBeenCalledWith('/config');
  });
});
