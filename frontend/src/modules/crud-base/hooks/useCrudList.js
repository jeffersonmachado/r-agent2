import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Hook para gerenciar carregamento de lista em páginas CRUD.
 *
 * @param {Function} fetchFn - Função async que retorna os itens (array ou objeto com propriedade items/data).
 * @param {Object} [options]
 * @param {string} [options.itemsKey='items'] - Chave do objeto retornado que contém o array.
 * @param {any} [options.params] - Parâmetros padrão usados quando loadItems é chamado sem argumentos.
 * @param {boolean} [options.loadOnMount=false] - Se true, carrega ao montar.
 * @param {boolean} [options.reloadOnParamsChange=false] - Se true, recarrega quando `params` mudar.
 * @returns {{ allItems, loading, error, loadItems, reload }}
 */
export function useCrudList(fetchFn, {
  itemsKey = 'items',
  params,
  loadOnMount = false,
  reloadOnParamsChange = false,
} = {}) {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const paramsSignature = useMemo(() => JSON.stringify(params ?? null), [params]);

  const loadItems = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const resolvedArgs = args.length > 0
        ? args
        : (params === undefined
            ? []
            : (Array.isArray(params) ? params : [params]));
      const result = await fetchFn(...resolvedArgs);
      const list = Array.isArray(result)
        ? result
        : (result?.[itemsKey] ?? []);
      setAllItems(list);
      return list;
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Erro ao carregar dados');
      return [];
    } finally {
      setLoading(false);
    }
  }, [fetchFn, itemsKey, paramsSignature]);

  useEffect(() => {
    if (loadOnMount || (reloadOnParamsChange && params !== undefined)) {
      loadItems();
    }
  }, [loadOnMount, reloadOnParamsChange, paramsSignature, loadItems]);

  const reload = useCallback(() => loadItems(), [loadItems]);

  return { allItems, loading, error, loadItems, reload };
}
