import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    currentPath: '/support',
    navigate: vi.fn(),
  }),
}));

describe('Sidebar', () => {
  it('mostra a vertical inferida do tenant no rodape', () => {
    render(
      <Sidebar
        agent={{ role: 'admin', tenantId: 'tenant-demo' }}
        currentPath="/support"
        resolvedVerticalKeys={['fitness']}
      />,
    );

    expect(screen.getByText('Vertical')).toBeInTheDocument();
    expect(screen.getByText('Fitness')).toBeInTheDocument();
  });
});