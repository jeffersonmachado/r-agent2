import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CasesPage } from './CasesPage';

const testDoubles = vi.hoisted(() => ({
  navigate: vi.fn(),
  showToast: vi.fn(),
  auth: {
    agent: { id: 'a-owner', role: 'owner' },
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
  },
  listCases: vi.fn(),
  getCase: vi.fn(),
}));

vi.mock('../api/cases', () => ({
  listCases: (...args) => testDoubles.listCases(...args),
  getCase: (...args) => testDoubles.getCase(...args),
  linkConversationToCase: vi.fn(),
  unlinkConversationFromCase: vi.fn(),
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
  useRouter: () => ({ navigate: testDoubles.navigate, currentPath: '/cases' }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: testDoubles.showToast,
    ToastContainer: () => null,
  }),
}));

vi.mock('../modules/crud-base', () => ({
  CrudPageBase: ({ children }) => <div>{children}</div>,
}));

describe('CasesPage — guard de capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDoubles.auth.agent = { id: 'a-owner', role: 'owner' };
    testDoubles.auth.capabilities = { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' };
    testDoubles.listCases.mockResolvedValue({ cases: [], total: 0 });
  });

  it('capability desligada: mostra guard e NÃO chama a API de cases', () => {
    testDoubles.auth.capabilities = { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' };
    render(<CasesPage />);

    expect(screen.getByText('Case Management não está ativo')).toBeTruthy();
    expect(testDoubles.listCases).not.toHaveBeenCalled();
  });

  it('guard oferece CTA de configuração apenas para owner/admin/super_admin', () => {
    testDoubles.auth.capabilities = { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' };
    testDoubles.auth.agent = { id: 'a-op', role: 'operator' };
    render(<CasesPage />);

    expect(screen.getByText('Case Management não está ativo')).toBeTruthy();
    expect(screen.queryByText('Ativar em Configurações')).toBeNull();
  });

  it('capability ligada: carrega e lista chamados', async () => {
    testDoubles.listCases.mockResolvedValue({
      cases: [{ id: 'c-1', subject: 'Reclamação de fatura', status: 'open', priority: 'high', updatedAt: '2026-08-20T10:00:00.000Z' }],
      total: 1,
    });
    render(<CasesPage />);

    await waitFor(() => {
      expect(screen.getByText('Reclamação de fatura')).toBeTruthy();
    });
    expect(testDoubles.listCases).toHaveBeenCalledWith({ status: undefined, limit: 100, offset: 0 });
    expect(screen.getByText('1 chamado(s)')).toBeTruthy();
  });
});
