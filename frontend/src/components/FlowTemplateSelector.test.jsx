import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FlowTemplateSelector } from './FlowTemplateSelector';

/**
 * REGRESSÃO MEDIDA EM BROWSER (jornada funcional de 2026-10-13, rota `/editor`):
 *
 *   Warning: React has detected a change in the order of Hooks called by
 *   FlowTemplateSelector. This will lead to bugs and errors if not fixed.
 *   Rendered more hooks than during the previous render.   (3x — pageerror)
 *
 * Causa: o `useMemo` das tags disponíveis estava DEPOIS dos `return` antecipados
 * de `selectedTemplate`, `loading` e `error`. Na primeira renderização
 * `loading === true` retornava antes do hook; quando o fetch terminava, a render
 * seguinte chamava UM HOOK A MAIS e o React abortava o componente. A tela
 * `/editor` ficava com 2 erros de console + 3 pageerror e o botão "Novo" não
 * abria o seletor de modelos — a ação de criar fluxo sumia.
 *
 * O que se trava aqui:
 *   1. a renderização COMPLETA (loading -> lista) não emite erro de Rules of Hooks;
 *   2. o conteúdo aparece de fato (o crash impedia a render da lista);
 *   3. a transição de estados que expunha o defeito (loading -> vazio / loading ->
 *      com templates) é exercitada nos dois sentidos.
 */

vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const templates = [
  { id: 'tpl-1', name: 'Atendimento', description: 'Fluxo de atendimento', tags: ['atendimento'], tenantId: 'system', scope: 'global' },
  { id: 'tpl-2', name: 'Cobrança', description: 'Fluxo de cobrança', tags: ['financeiro'], tenantId: 'tenant-x', scope: 'tenant' },
];

vi.mock('../templates/flowTemplates', () => ({
  getFlowTemplates: vi.fn(() => Promise.resolve([])),
  createFlowFromTemplate: vi.fn(() => Promise.resolve({})),
  clearTemplatesCache: vi.fn(),
  deleteTemplate: vi.fn(() => Promise.resolve()),
  installFlowFromTemplate: vi.fn(() => Promise.resolve({})),
}));

const { getFlowTemplates } = await import('../templates/flowTemplates');

let consoleErrors;
let consoleOriginal;

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrors = [];
  consoleOriginal = console.error;
  // O sintoma do defeito SAI pelo console.error do React: capturá-lo é a forma
  // direta de provar que ele não ocorre mais.
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (typeof a === 'string' ? a : String(a && a.message ? a.message : a))).join(' '));
  };
});

afterEach(() => {
  console.error = consoleOriginal;
});

/** Erros do React que caracterizam o defeito de Rules of Hooks. */
function errosDeHooks() {
  return consoleErrors.filter((e) => /rules of hooks|change in the order of Hooks|more hooks than during the previous render/i.test(e));
}

describe('components/FlowTemplateSelector — integridade dos hooks', () => {
  it('renderiza a lista sem NENHUM erro de Rules of Hooks (loading -> com templates)', async () => {
    getFlowTemplates.mockResolvedValueOnce(templates);

    render(<FlowTemplateSelector onTemplateSelected={vi.fn()} onCancel={vi.fn()} />);

    // O conteúdo só aparece se o componente sobreviveu à transição de loading.
    await waitFor(() => expect(screen.getByText('Atendimento')).toBeInTheDocument());
    expect(screen.getByText('Cobrança')).toBeInTheDocument();
    expect(errosDeHooks()).toEqual([]);
  });

  it('lista VAZIA (loading -> vazio) também passa pela transição sem quebrar os hooks', async () => {
    getFlowTemplates.mockResolvedValueOnce([]);

    render(<FlowTemplateSelector onTemplateSelected={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(getFlowTemplates).toHaveBeenCalled());
    // O caminho vazio era o que expunha o defeito: a primeira render (loading) não
    // chamava o useMemo e a segunda (sem templates) chamava.
    await waitFor(() => expect(errosDeHooks()).toEqual([]));
  });

  it('erro no carregamento não quebra os hooks (loading -> error)', async () => {
    getFlowTemplates.mockRejectedValueOnce(new Error('falha de rede'));

    render(<FlowTemplateSelector onTemplateSelected={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Erro ao carregar templates/i)).toBeInTheDocument());
    expect(errosDeHooks()).toEqual([]);
  });

  it('o useMemo das tags fica ANTES dos returns antecipados (estrutura que fecha o defeito)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const arquivo = path.resolve(__dirname, 'FlowTemplateSelector.jsx');
    const codigo = fs.readFileSync(arquivo, 'utf8');

    const linhaDoUseMemo = codigo.split('\n').findIndex((l) => l.includes('const availableTags = useMemo'));
    const linhaDoPrimeiroReturn = codigo.split('\n').findIndex((l) => /^\s{2}if \(selectedTemplate\) \{/.test(l));

    expect(linhaDoUseMemo).toBeGreaterThan(-1);
    expect(linhaDoPrimeiroReturn).toBeGreaterThan(-1);
    // Se alguém mover o hook de volta para depois do return, este teste avisa.
    expect(linhaDoUseMemo).toBeLessThan(linhaDoPrimeiroReturn);
  });
});
