import { useEffect, useMemo, useState } from 'react';
import { ReplayDetailsModal, ReplayFilters, ReplayTable } from '../components';
import { useReplayFilters } from '../hooks/useReplayFilters';
import { useReplays } from '../hooks/useReplays';
import { useWaves } from '../hooks/useWaves';

export default function ReplayPage({ refreshKey }) {
  const [message, setMessage] = useState('');
  const { allWaves } = useWaves('', { paginationEnabled: false });
  const { filters, updateFilter, resetFilters, activeCount } = useReplayFilters();
  const replayFilters = useMemo(() => filters, [filters]);
  const {
    replays,
    pagination,
    loading,
    error,
    selectedReplay,
    selectedReplayAutoPlay,
    openReplay,
    closeReplay,
    reexecuteReplay,
    loadReplays
  } =
    useReplays(replayFilters);

  async function handleReexecute(replayId) {
    const execution = await reexecuteReplay(replayId);
    setMessage(`Reexecucao iniciada: ${execution.executionId}`);
  }

  useEffect(() => {
    if (refreshKey) {
      loadReplays().catch(() => {});
    }
  }, [refreshKey, loadReplays]);

  return (
    <section className="panel">
      <ReplayFilters
        filters={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        waves={allWaves}
        activeCount={activeCount}
      />

      {message && <p className="info-text">{message}</p>}
      {loading && <p>Carregando replays...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <ReplayTable
          replays={replays}
          pagination={pagination}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={(nextSortBy, nextSortDir) => {
            updateFilter('sortBy', nextSortBy);
            updateFilter('sortDir', nextSortDir);
          }}
          onPageChange={(nextPage) => updateFilter('page', nextPage)}
          onOpenDetails={(replayId) => openReplay(replayId, { autoPlay: false })}
          onPlay={(replayId) => openReplay(replayId, { autoPlay: true })}
          onReexecute={handleReexecute}
        />
      )}

      <ReplayDetailsModal replay={selectedReplay} autoPlay={selectedReplayAutoPlay} onClose={closeReplay} />
    </section>
  );
}
