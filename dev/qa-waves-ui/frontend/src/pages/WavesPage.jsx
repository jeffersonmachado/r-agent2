import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  ExecutionQueuePanel,
  ExecutionSelectionBar,
  ReplayDetailsModal,
  WaveCard,
  WavesToolbar,
} from '../components';
import { useExecutionRunner } from '../hooks/useExecutionRunner';
import { replayService } from '../services/replayService';
import { useWaves } from '../hooks/useWaves';
import { useWaveSelection } from '../hooks/useWaveSelection';

export default function WavesPage({ onExecutionCompleted }) {
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [selectedReplay, setSelectedReplay] = useState(null);
  const { waves, allWaves, page, setPage, pagination, loading, error, reloadWaves } = useWaves(search);
  const selection = useWaveSelection(allWaves);

  const execution = useExecutionRunner(async () => {
    await reloadWaves();
    if (onExecutionCompleted) onExecutionCompleted();
  });

  async function handleExecuteSelected() {
    await execution.runSelection({
      selectedWaveIds: Array.from(selection.selectedWaveIds),
      selectedItemIds: Array.from(selection.selectedItemIds)
    });
  }

  async function handlePlayLatestReplay(waveId) {
    setMessage('');
    try {
      const listed = await replayService.listReplays({
        waveId,
        page: 1,
        pageSize: 1,
        sortBy: 'startedAt',
        sortDir: 'desc'
      });
      const latest = listed.replays?.[0];
      if (!latest) {
        setMessage('Nenhum replay encontrado para esta onda.');
        return;
      }

      const details = await replayService.getReplay(latest.id);
      setSelectedReplay(details);
    } catch (playError) {
      setMessage(playError.message || 'Falha ao abrir replay mais recente da onda.');
    }
  }

  return (
    <section className="panel">
      <WavesToolbar search={search} onSearch={setSearch} onReload={reloadWaves} loading={loading} />

      <ExecutionSelectionBar
        summary={selection.selectionSummary}
        onExecute={handleExecuteSelected}
        onClear={selection.clearSelection}
        running={execution.running}
      />

      {error && <p className="error-text">{error}</p>}
      {execution.error && <p className="error-text">{execution.error}</p>}
      {message && <p className="info-text">{message}</p>}

      <div className="waves-layout">
        <div className="waves-column">
          {waves.map((wave, idx) => (
            <motion.div
              key={wave.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.04 }}
            >
              <WaveCard
                wave={wave}
                checked={selection.getWaveSelectionState(wave.id) === 'all'}
                selectionState={selection.getWaveSelectionState(wave.id)}
                selectedItemIds={selection.selectedItemIds}
                onToggleWave={selection.toggleWave}
                onToggleItem={selection.toggleItem}
                onPlayLatest={handlePlayLatestReplay}
              />
            </motion.div>
          ))}
        </div>

        <ExecutionQueuePanel execution={execution.currentExecution} history={execution.executionHistory} />
      </div>

      <div className="pagination-bar">
        <span>
          Total de ondas: {pagination.total} | Pagina {pagination.page} de {pagination.totalPages}
        </span>
        <div className="selection-actions">
          <button className="secondary" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
            Anterior
          </button>
          <button
            className="secondary"
            onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
            disabled={page >= pagination.totalPages}
          >
            Proxima
          </button>
        </div>
      </div>

      <ReplayDetailsModal replay={selectedReplay} autoPlay onClose={() => setSelectedReplay(null)} />
    </section>
  );
}
