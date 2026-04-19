import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VerticalLayout } from './VerticalLayout';

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    currentPath: '/vertical/dashboard',
    navigate: vi.fn(),
  }),
}));

describe('VerticalLayout', () => {
  it('agrupa verticais separadas para super-admin', () => {
    render(
      <VerticalLayout
        agent={{ role: 'super_admin', tenantId: 'system', username: 'systemadmin' }}
        verticalKeys={['beauty', 'fitness', 'ecommerce']}
        currentPath="/vertical/dashboard"
      >
        <div>conteudo</div>
      </VerticalLayout>,
    );

    expect(screen.getByText('Todas as verticais')).toBeInTheDocument();
    expect(screen.getByText('Beauty')).toBeInTheDocument();
    expect(screen.getByText('Fitness')).toBeInTheDocument();
    expect(screen.getByText('E-commerce')).toBeInTheDocument();
    expect(screen.getByText('Agenda')).toBeInTheDocument();
    expect(screen.getByText('Alunos')).toBeInTheDocument();
    expect(screen.getByText(/Modulos especificos desta vertical ainda estao em preparacao/i)).toBeInTheDocument();
  });
});