import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrudFilters } from './hooks/useCrudFilters';

describe('modules/crud-base/useCrudFilters', () => {
  it('retorna os valores iniciais dos filtros', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ search: '', status: '' }),
    );
    expect(result.current.filters).toEqual({ search: '', status: '' });
  });

  it('setFilter atualiza uma chave específica sem perder as demais', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ search: '', status: '' }),
    );
    act(() => result.current.setFilter('search', 'ativo'));
    expect(result.current.filters).toEqual({ search: 'ativo', status: '' });
  });

  it('resetFilters restaura os valores iniciais', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ search: '', status: '' }),
    );
    act(() => result.current.setFilter('search', 'algo'));
    act(() => result.current.resetFilters());
    expect(result.current.filters).toEqual({ search: '', status: '' });
  });

  it('hasActiveFilters é false quando todos os filtros estão vazios', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ search: '', status: '' }),
    );
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('hasActiveFilters é true quando qualquer filtro string tem valor', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ search: '', status: '' }),
    );
    act(() => result.current.setFilter('status', 'active'));
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('hasActiveFilters é true quando filtro array tem itens', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ tags: [] }),
    );
    act(() => result.current.setFilter('tags', ['a', 'b']));
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('hasActiveFilters é false quando filtro array está vazio', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ tags: [] }),
    );
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('setFilters substitui o objeto de filtros por completo', () => {
    const { result } = renderHook(() =>
      useCrudFilters({ search: '', status: '' }),
    );
    act(() => result.current.setFilters({ search: 'x', status: 'done' }));
    expect(result.current.filters).toEqual({ search: 'x', status: 'done' });
  });
});
