import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformSupportPage } from './PlatformSupportPage';

const testDoubles = vi.hoisted(() => ({
  auth: { agent: { id: 'a-sup', role: 'auditor', classification: 'SUPPORT' } },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({ agent: testDoubles.auth.agent }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: vi.fn(), currentPath: '/platform-support' }),
}));

vi.mock('../modules/crud-base', () => ({
  CrudPageBase: ({ children }) => <div>{children}</div>,
}));

describe('PlatformSupportPage — gate por classificação', () => {
  beforeEach(() => {
    testDoubles.auth.agent = { id: 'a-sup', role: 'auditor', classification: 'SUPPORT' };
  });

  it('PRODUCTION vê apenas o aviso de acesso restrito', () => {
    testDoubles.auth.agent = { id: 'a-prod', role: 'operator', classification: 'PRODUCTION' };
    render(<PlatformSupportPage />);

    expect(screen.getByText('Acesso restrito ao suporte da plataforma.')).toBeTruthy();
    expect(screen.queryByText('Replays de diagnóstico')).toBeNull();
    expect(screen.queryByText('Auditoria')).toBeNull();
  });

  it('SUPPORT vê replays de diagnóstico e auditoria, sem status técnico', () => {
    render(<PlatformSupportPage />);

    expect(screen.getByText('Replays de diagnóstico')).toBeTruthy();
    expect(screen.getByText('Auditoria')).toBeTruthy();
    expect(screen.queryByText('Status do Sistema')).toBeNull();
  });

  it('DEVELOPMENT vê também o status técnico do sistema', () => {
    testDoubles.auth.agent = { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' };
    render(<PlatformSupportPage />);

    expect(screen.getByText('Replays de diagnóstico')).toBeTruthy();
    expect(screen.getByText('Auditoria')).toBeTruthy();
    expect(screen.getByText('Status do Sistema')).toBeTruthy();
  });
});
