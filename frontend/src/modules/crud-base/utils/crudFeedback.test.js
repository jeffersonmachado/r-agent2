import { describe, expect, it, vi } from 'vitest';
import { resolveCrudErrorMessage, showCrudError, showCrudSuccess } from './crudFeedback';

describe('modules/crud-base/utils/crudFeedback', () => {
  it('resolveCrudErrorMessage prioriza body.message', () => {
    const message = resolveCrudErrorMessage({ body: { message: 'Erro body' }, message: 'Erro message' });
    expect(message).toBe('Erro body');
  });

  it('resolveCrudErrorMessage usa fallback quando não há mensagem útil', () => {
    const message = resolveCrudErrorMessage({}, 'Fallback');
    expect(message).toBe('Fallback');
  });

  it('showCrudError envia toast de erro com mensagem resolvida', () => {
    const showToast = vi.fn();
    const message = showCrudError(showToast, { message: 'Falha' }, 'Fallback');

    expect(message).toBe('Falha');
    expect(showToast).toHaveBeenCalledWith('Falha', 'error');
  });

  it('showCrudSuccess envia toast de sucesso', () => {
    const showToast = vi.fn();
    const message = showCrudSuccess(showToast, 'Concluido');

    expect(message).toBe('Concluido');
    expect(showToast).toHaveBeenCalledWith('Concluido', 'success');
  });
});
