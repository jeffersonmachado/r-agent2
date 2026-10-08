import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// NavigationLink consome o roteador; o path é controlado pelo teste para simular navegação.
let mockPath = '/dev/engineering';

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ currentPath: mockPath, navigate: vi.fn() }),
}));

import { SecondaryNav } from './SecondaryNav';

const superAdmin = { role: 'super_admin', username: 'systemadmin', tenantId: 'system' };

function sectionOf(label) {
  const header = screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') });
  return header.closest('section');
}

function activeItems() {
  return Array.from(document.querySelectorAll('.rap-secondary-nav a.is-active'))
    .map((anchor) => anchor.getAttribute('href'));
}

function renderAt(path) {
  mockPath = path;
  return render(<SecondaryNav agent={superAdmin} currentPath={path} />);
}

beforeEach(() => {
  // jsdom não implementa matchMedia e o componente consulta (max-width: 1080px).
  // O stub é SEMPRE imposto com `matches: false` (desktop): em viewport mobile o
  // accordion mantém a seção ativa aberta de propósito, o que mascararia o teste.
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

describe('SecondaryNav — área Dev', () => {
  it('abre a seção que contém a rota ativa mesmo quando não é a primeira', () => {
    renderAt('/dev/engineering');

    expect(sectionOf('Engineering').classList.contains('is-collapsed')).toBe(false);
  });

  it('não marca dois itens como ativos quando o path de um é prefixo do outro', () => {
    renderAt('/dev/engineering');

    // `/dev` (Central Dev) casa `/dev/engineering` por prefixo — só o mais específico vence.
    expect(activeItems()).toEqual(['/dev/engineering']);
  });

  it('mantém a seção aberta ao navegar entre itens dela (regressão do snapshot que "grudava")', () => {
    const { rerender } = renderAt('/dev/engineering');
    expect(sectionOf('Engineering').classList.contains('is-collapsed')).toBe(false);

    mockPath = '/dev/engineering/models';
    act(() => {
      rerender(<SecondaryNav agent={superAdmin} currentPath={mockPath} />);
    });

    expect(sectionOf('Engineering').classList.contains('is-collapsed')).toBe(false);
    expect(activeItems()).toEqual(['/dev/engineering/models']);
  });

  it('mantém a seção da rota ativa aberta ao trocar de área (deep-link)', () => {
    const { rerender } = renderAt('/workspace');
    mockPath = '/dev/engineering/findings';
    act(() => {
      rerender(<SecondaryNav agent={superAdmin} currentPath={mockPath} />);
    });

    expect(sectionOf('Engineering').classList.contains('is-collapsed')).toBe(false);
  });

  it('respeita o clique do usuário para recolher a seção ativa', () => {
    renderAt('/dev/engineering');
    const header = screen.getByRole('button', { name: /^Engineering/i });

    act(() => {
      header.click();
    });

    expect(sectionOf('Engineering').classList.contains('is-collapsed')).toBe(true);
  });
});

describe('SecondaryNav — área Clientes', () => {
  it('não oferece atalho para a página legada /support e mostra a seção CRM', () => {
    renderAt('/crm');

    expect(screen.queryByRole('link', { name: /Relacionamento|Central de Atendimento/i })).toBeNull();
    expect(document.querySelector('.rap-secondary-nav a[href="/support"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'CRM' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Painel CRM' })).toHaveLength(1);
  });
});
