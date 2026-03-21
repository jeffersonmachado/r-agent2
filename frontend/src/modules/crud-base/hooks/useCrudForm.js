import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Hook para gerenciar estado de formulário em páginas CRUD.
 *
 * @param {Object|Function} initialData - Dados iniciais ou factory que retorna os dados.
 * @returns {{ formData, setField, setFormData, resetForm, isDirty }}
 */
export function useCrudForm(initialData) {
  const getInitial = useCallback(
    () => (typeof initialData === 'function' ? initialData() : initialData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const initialRef = useRef(getInitial());
  const [formData, setFormData] = useState(() => getInitial());

  const setField = useCallback((key, value) => {
    setFormData((current) => ({ ...current, [key]: value }));
  }, []);

  const resetForm = useCallback((nextData) => {
    const next = nextData !== undefined ? nextData : getInitial();
    initialRef.current = next;
    setFormData(next);
  }, [getInitial]);

  const isDirty = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(initialRef.current),
    [formData],
  );

  return { formData, setField, setFormData, resetForm, isDirty };
}
