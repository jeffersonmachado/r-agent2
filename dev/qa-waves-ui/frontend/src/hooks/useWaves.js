import { useCallback, useEffect, useMemo, useState } from 'react';
import { wavesService } from '../services/wavesService';

export function useWaves(search, options = {}) {
  const [waves, setWaves] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 6, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const paginationEnabled = options.paginationEnabled !== false;

  const loadWaves = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await wavesService.listWaves(
        paginationEnabled ? { page, pageSize: 6 } : { page: 1, pageSize: 200 }
      );
      setWaves(data.waves || []);
      setPagination(data.pagination || { total: 0, page: 1, pageSize: 6, totalPages: 1 });
    } catch (err) {
      setError(err.message || 'Falha ao carregar ondas');
    } finally {
      setLoading(false);
    }
  }, [page, paginationEnabled]);

  useEffect(() => {
    loadWaves();
  }, [loadWaves]);

  useEffect(() => {
    if (search?.trim()) {
      setPage(1);
    }
  }, [search]);

  const filteredWaves = useMemo(() => {
    if (!search?.trim()) return waves;
    const q = search.toLowerCase();
    return waves.filter((wave) => {
      const inWave = `${wave.name} ${wave.description}`.toLowerCase().includes(q);
      const inItems = (wave.items || []).some((item) => `${item.name} ${item.channel} ${item.type}`.toLowerCase().includes(q));
      return inWave || inItems;
    });
  }, [waves, search]);

  return {
    waves: filteredWaves,
    allWaves: waves,
    page,
    setPage,
    pagination,
    loading,
    error,
    reloadWaves: loadWaves
  };
}
