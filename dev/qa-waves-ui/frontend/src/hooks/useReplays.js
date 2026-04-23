import { useCallback, useEffect, useState } from 'react';
import { replayService } from '../services/replayService';

export function useReplays(filters) {
  const [replays, setReplays] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 10, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReplay, setSelectedReplay] = useState(null);
  const [selectedReplayAutoPlay, setSelectedReplayAutoPlay] = useState(false);

  const loadReplays = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await replayService.listReplays(filters);
      setReplays(data.replays || []);
      setPagination(data.pagination || { total: 0, page: 1, pageSize: 10, totalPages: 1 });
    } catch (err) {
      setError(err.message || 'Falha ao carregar replays');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadReplays();
  }, [loadReplays]);

  async function openReplay(replayId, options = {}) {
    const details = await replayService.getReplay(replayId);
    setSelectedReplayAutoPlay(Boolean(options.autoPlay));
    setSelectedReplay(details);
  }

  function closeReplay() {
    setSelectedReplay(null);
    setSelectedReplayAutoPlay(false);
  }

  async function reexecuteReplay(replayId) {
    const execution = await replayService.reexecuteReplay(replayId);
    await loadReplays();
    return execution;
  }

  return {
    replays,
    pagination,
    loading,
    error,
    selectedReplay,
    selectedReplayAutoPlay,
    loadReplays,
    openReplay,
    closeReplay,
    reexecuteReplay
  };
}
