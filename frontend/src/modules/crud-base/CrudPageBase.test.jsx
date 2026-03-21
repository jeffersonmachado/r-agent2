import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrudPageBase } from './CrudPageBase';

describe('modules/crud-base/CrudPageBase', () => {
  it('renderiza o título informado', () => {
    render(<CrudPageBase title="Minha Página" />);
    expect(screen.getByText('Minha Página')).toBeTruthy();
  });

  it('renderiza children dentro do container', () => {
    render(
      <CrudPageBase title="Título">
        <span data-testid="child">conteúdo</span>
      </CrudPageBase>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renderiza actions quando fornecido', () => {
    render(
      <CrudPageBase
        title="Título"
        actions={<button>Novo</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Novo' })).toBeTruthy();
  });

  it('não renderiza bloco de actions quando omitido', () => {
    const { container } = render(<CrudPageBase title="Título" />);
    // .support-controls não deve aparecer quando actions é null/undefined
    expect(container.querySelector('.support-controls')).toBeNull();
  });

  it('renderiza filters quando fornecido', () => {
    render(
      <CrudPageBase
        title="Título"
        filters={<div data-testid="filters-block">filtros</div>}
      />,
    );
    expect(screen.getByTestId('filters-block')).toBeTruthy();
  });

  it('mantém support-page e aceita className adicional no elemento raiz', () => {
    const { container } = render(<CrudPageBase title="X" className="is-mobile" />);
    expect(container.firstChild.className).toContain('support-page');
    expect(container.firstChild.className).toContain('is-mobile');
  });

  it('oculta header quando hideHeader=true', () => {
    const { container } = render(<CrudPageBase title="X" hideHeader />);
    expect(container.querySelector('.support-header')).toBeNull();
  });
});
