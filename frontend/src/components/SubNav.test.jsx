import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubNav } from './SubNav';

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    currentPath: '/support',
    navigate: vi.fn(),
  }),
}));

describe('SubNav', () => {
  it('mostra tenant e vertical efetiva no resumo de contexto', () => {
    render(
      <SubNav
        agent={{ role: 'admin', tenantId: 'tenant-demo' }}
        currentPath="/support"
        tenantLabel="tenant-demo"
        verticalLabels={['Fitness']}
      />,
    );

    expect(screen.getByText('Conta: tenant-demo')).toBeInTheDocument();
    expect(screen.getByText('Vertical: Fitness')).toBeInTheDocument();
  });
});