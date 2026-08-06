import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Paginação incremental client-side para listas longas: renderiza em blocos
 * (`batchSize`) e expõe `loadMore` para revelar o próximo bloco.
 *
 * Com `fromEnd: true` os itens exibidos são os ÚLTIMOS do array (timelines de
 * chat: o botão "carregar anteriores" revela mensagens antigas no topo sem
 * alterar o final visível).
 *
 * O progresso é preservado quando a lista é reconstruída com o mesmo trecho
 * visível (atualizações em tempo real) e reiniciado quando o conjunto muda
 * (busca/filtros/ordenação).
 */
export function useIncrementalList(items, { batchSize = 200, fromEnd = false } = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const prevItemsRef = useRef(safeItems);

  // Ajuste de estado durante a renderização (padrão suportado pelo React):
  // compara o trecho atualmente visível com a nova lista; se não for o mesmo,
  // volta ao primeiro bloco.
  if (prevItemsRef.current !== safeItems) {
    const previous = prevItemsRef.current;
    prevItemsRef.current = safeItems;
    const shared = Math.min(visibleCount, previous.length, safeItems.length);
    let sameWindow = shared > 0;
    for (let i = 0; i < shared && sameWindow; i += 1) {
      const a = fromEnd ? safeItems[safeItems.length - 1 - i] : safeItems[i];
      const b = fromEnd ? previous[previous.length - 1 - i] : previous[i];
      if (a !== b) sameWindow = false;
    }
    if (!sameWindow && visibleCount !== batchSize) {
      setVisibleCount(batchSize);
    }
  }

  const effectiveCount = Math.min(visibleCount, safeItems.length);
  const visibleItems = useMemo(
    () => (fromEnd
      ? safeItems.slice(Math.max(0, safeItems.length - effectiveCount))
      : safeItems.slice(0, effectiveCount)),
    [safeItems, effectiveCount, fromEnd],
  );

  const hasMore = effectiveCount < safeItems.length;

  const loadMore = useCallback(() => {
    setVisibleCount((current) => current + batchSize);
  }, [batchSize]);

  return {
    visibleItems,
    hasMore,
    loadMore,
    visibleCount: effectiveCount,
    totalCount: safeItems.length,
  };
}

/**
 * Sentinela com IntersectionObserver: dispara `onLoadMore` quando o elemento
 * entra na viewport do container de scroll. Se IntersectionObserver não estiver
 * disponível (ou for um stub sem `observe`), não faz nada — nesse caso o
 * chamador deve manter um controle manual (botão "Carregar mais").
 */
export function useLoadMoreSentinel({ enabled, onLoadMore, rootMargin = '240px' }) {
  const sentinelRef = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled) return undefined;
    if (typeof IntersectionObserver !== 'function') return undefined;
    let observer;
    try {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreRef.current?.();
        }
      }, { rootMargin });
    } catch {
      return undefined;
    }
    if (typeof observer.observe !== 'function') return undefined;
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return sentinelRef;
}
