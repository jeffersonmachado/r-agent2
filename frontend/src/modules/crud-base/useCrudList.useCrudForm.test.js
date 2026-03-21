import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCrudList } from './hooks/useCrudList';
import { useCrudForm } from './hooks/useCrudForm';

// ─────────────────────────────────────────────
// useCrudList
// ─────────────────────────────────────────────

describe('modules/crud-base/useCrudList', () => {
  it('inicia com allItems vazio e loading false', () => {
    const { result } = renderHook(() =>
      useCrudList(async () => ({ items: [] })),
    );
    expect(result.current.allItems).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('loadItems popula allItems com o array retornado diretamente', async () => {
    const fetchFn = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const { result } = renderHook(() => useCrudList(fetchFn));

    await act(async () => { await result.current.loadItems(); });

    expect(result.current.allItems).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.current.loading).toBe(false);
  });

  it('loadItems usa itemsKey para extrair array do objeto retornado', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ data: [{ id: 10 }] });
    const { result } = renderHook(() =>
      useCrudList(fetchFn, { itemsKey: 'data' }),
    );

    await act(async () => { await result.current.loadItems(); });

    expect(result.current.allItems).toEqual([{ id: 10 }]);
  });

  it('loadItems usa a chave padrão "items" quando não especificada', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ items: [{ id: 99 }] });
    const { result } = renderHook(() => useCrudList(fetchFn));

    await act(async () => { await result.current.loadItems(); });

    expect(result.current.allItems).toEqual([{ id: 99 }]);
  });

  it('captura erro e expõe message em error', async () => {
    const fetchFn = vi.fn().mockRejectedValue({ message: 'Falha de rede' });
    const { result } = renderHook(() => useCrudList(fetchFn));

    await act(async () => { await result.current.loadItems(); });

    expect(result.current.allItems).toEqual([]);
    expect(result.current.error).toBe('Falha de rede');
    expect(result.current.loading).toBe(false);
  });

  it('captura erro via body.message quando disponível', async () => {
    const fetchFn = vi.fn().mockRejectedValue({ body: { message: 'Unauthorized' } });
    const { result } = renderHook(() => useCrudList(fetchFn));

    await act(async () => { await result.current.loadItems(); });

    expect(result.current.error).toBe('Unauthorized');
  });

  it('reload chama loadItems sem argumentos', async () => {
    const fetchFn = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useCrudList(fetchFn));

    await act(async () => { await result.current.reload(); });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('usa params padrão quando loadItems é chamado sem argumentos', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ items: [{ id: 'p1' }] });
    const { result } = renderHook(() =>
      useCrudList(fetchFn, { params: { status: 'active' } }),
    );

    await act(async () => { await result.current.loadItems(); });

    expect(fetchFn).toHaveBeenCalledWith({ status: 'active' });
    expect(result.current.allItems).toEqual([{ id: 'p1' }]);
  });

  it('carrega automaticamente ao montar quando loadOnMount=true', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ items: [{ id: 1 }] });
    const { result } = renderHook(() =>
      useCrudList(fetchFn, { loadOnMount: true }),
    );

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.current.allItems).toEqual([{ id: 1 }]);
    });
  });

  it('recarrega automaticamente quando params muda e reloadOnParamsChange=true', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'a' }] })
      .mockResolvedValueOnce({ items: [{ id: 'b' }] });

    const { result, rerender } = renderHook(
      ({ params }) => useCrudList(fetchFn, { params, reloadOnParamsChange: true }),
      { initialProps: { params: { q: 'one' } } },
    );

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.current.allItems).toEqual([{ id: 'a' }]);
    });

    rerender({ params: { q: 'two' } });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.current.allItems).toEqual([{ id: 'b' }]);
    });
  });
});

// ─────────────────────────────────────────────
// useCrudForm
// ─────────────────────────────────────────────

describe('modules/crud-base/useCrudForm', () => {
  it('inicia com os dados iniciais fornecidos', () => {
    const initial = { name: '', email: '' };
    const { result } = renderHook(() => useCrudForm(initial));
    expect(result.current.formData).toEqual(initial);
  });

  it('setField atualiza um campo sem perder os demais', () => {
    const { result } = renderHook(() =>
      useCrudForm({ name: '', email: '' }),
    );
    act(() => result.current.setField('name', 'João'));
    expect(result.current.formData).toEqual({ name: 'João', email: '' });
  });

  it('isDirty é false quando formData igual ao estado inicial', () => {
    const { result } = renderHook(() =>
      useCrudForm({ name: '' }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('isDirty é true após setField alterar um campo', () => {
    const { result } = renderHook(() =>
      useCrudForm({ name: '' }),
    );
    act(() => result.current.setField('name', 'x'));
    expect(result.current.isDirty).toBe(true);
  });

  it('resetForm restaura os dados para o valor inicial padrão', () => {
    const { result } = renderHook(() =>
      useCrudForm({ name: '' }),
    );
    act(() => result.current.setField('name', 'editado'));
    act(() => result.current.resetForm());
    expect(result.current.formData).toEqual({ name: '' });
    expect(result.current.isDirty).toBe(false);
  });

  it('resetForm aceita nextData e atualiza o baseline de isDirty', () => {
    const { result } = renderHook(() =>
      useCrudForm({ name: '' }),
    );
    act(() => result.current.resetForm({ name: 'novo valor' }));
    // formData atualizado
    expect(result.current.formData).toEqual({ name: 'novo valor' });
    // isDirty false porque baseline foi atualizado para o mesmo objeto
    expect(result.current.isDirty).toBe(false);
  });

  it('suporta initialData como factory function', () => {
    const factory = vi.fn(() => ({ qty: 0 }));
    const { result } = renderHook(() => useCrudForm(factory));
    expect(result.current.formData).toEqual({ qty: 0 });
  });

  it('setFormData substitui o formData por completo', () => {
    const { result } = renderHook(() =>
      useCrudForm({ a: 1, b: 2 }),
    );
    act(() => result.current.setFormData({ a: 99, b: 2 }));
    expect(result.current.formData).toEqual({ a: 99, b: 2 });
    expect(result.current.isDirty).toBe(true);
  });
});
