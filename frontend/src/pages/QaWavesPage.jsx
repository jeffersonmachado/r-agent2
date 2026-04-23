import React, { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api/client';
import DateTimeRangeFilter from '../components/qa-waves/DateTimeRangeFilter';
import ReplayDetailsModal from '../components/qa-waves/ReplayDetailsModal';
import StatusBadge from '../components/qa-waves/StatusBadge';
import '../components/qa-waves/qaWaves.css';

const initialFilters = {
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  status: '',
};

export function QaWavesPage() {
  const [waves, setWaves] = useState([]);
  const [replays, setReplays] = useState([]);
  const [details, setDetails] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('page', String(page));
    params.set('pageSize', '10');
    params.set('sortBy', 'startedAt');
    params.set('sortDir', 'desc');
    return params.toString();
  }, [filters, page]);

  async function loadWaves() {
    const response = await fetchJson('/api/qa-waves/waves');
    setWaves(Array.isArray(response.items) ? response.items : []);
  }

  async function loadReplays() {
    const response = await fetchJson(`/api/qa-waves/replays?${queryString}`);
    setReplays(Array.isArray(response.items) ? response.items : []);
    setPagination(response.pagination || { page: 1, totalPages: 1, total: 0 });
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadWaves(), loadReplays()]);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar QA Waves');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [queryString]);

  async function handleExecuteWave(wave) {
    setError('');
    setSuccess('');
    try {
      const scenarioIds = (wave.items || []).map((item) => item.id).filter(Boolean);
      if (scenarioIds.length === 0) {
        setError('Esta wave nao possui cenarios para execucao');
        return;
      }
      await fetchJson('/api/qa-waves/executions', {
        method: 'POST',
        body: JSON.stringify({ scenarioIds }),
      });
      setSuccess(`Execucao da ${wave.name} enfileirada com sucesso`);
      await loadReplays();
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execucao da wave');
    }
  }

  async function handleReplayDetails(replayId) {
    setError('');
    try {
      const response = await fetchJson(`/api/qa-waves/replays/${encodeURIComponent(replayId)}`);
      setDetails(response);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar detalhes do replay');
    }
  }

  async function handleReplayReexecute(replayId) {
    setError('');
    setSuccess('');
    try {
      await fetchJson(`/api/qa-waves/replays/${encodeURIComponent(replayId)}/reexecute`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSuccess('Replay enfileirado para reexecucao');
    } catch (err) {
      setError(err?.message || 'Falha ao reexecutar replay');
    }
  }

  function onFilterChange(event) {
    const { name, value } = event.target;
    setPage(1);
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="qa-waves-page">
      <header className="qa-waves-header">
        <h1 className="qa-waves-title">QA Waves Integrado</h1>
        <p className="qa-waves-subtitle">
          Opera na mesma API e frontend do r-agent2, sem porta adicional.
        </p>
      </header>

      {error ? <div className="qa-waves-feedback error">{error}</div> : null}
      {success ? <div className="qa-waves-feedback success">{success}</div> : null}

      <section className="qa-waves-panel">
        <h2 className="qa-waves-section-title">Filtros de Replay</h2>
        <DateTimeRangeFilter
          filters={filters}
          onChange={onFilterChange}
          onClear={() => {
            setFilters(initialFilters);
            setPage(1);
          }}
        />
      </section>

      <div className="qa-waves-main">
        <section className="qa-waves-panel qa-waves-sidebar">
          <h2 className="qa-waves-section-title">Waves</h2>
          <div className="qa-waves-waves-grid">
            {waves.map((wave) => (
              <article key={wave.id} className="qa-waves-wave-card">
                <h3>{wave.name}</h3>
                <p className="qa-waves-wave-meta">
                  Itens: {wave.totalItems} | Criticos: {wave.criticalItems} | Coverage: {wave.coverage}%
                </p>
                <button type="button" onClick={() => handleExecuteWave(wave)}>
                  Executar Wave
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="qa-waves-panel qa-waves-content">
          <h2 className="qa-waves-section-title">Replays</h2>
          {loading ? <p>Carregando...</p> : null}
          <div className="qa-waves-replays-table-wrap">
            <table className="qa-waves-table">
            <thead>
              <tr>
                <th align="left">Replay</th>
                <th align="left">Wave</th>
                <th align="left">Status</th>
                <th align="left">Inicio</th>
                <th align="left">Duracao (ms)</th>
                <th align="left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {replays.map((replay) => (
                <tr key={replay.id}>
                  <td>{replay.itemName}</td>
                  <td>{replay.waveName}</td>
                  <td><StatusBadge status={replay.status} /></td>
                  <td>{new Date(replay.startedAt).toLocaleString('pt-BR')}</td>
                  <td>{replay.durationMs}</td>
                  <td className="qa-waves-actions-cell">
                    <button type="button" onClick={() => handleReplayDetails(replay.id)}>Detalhes</button>
                    <button type="button" onClick={() => handleReplayReexecute(replay.id)}>
                      Reexecutar
                    </button>
                  </td>
                </tr>
              ))}
              {replays.length === 0 ? (
                <tr>
                  <td colSpan={6}>Nenhum replay encontrado</td>
                </tr>
              ) : null}
            </tbody>
            </table>
          </div>

          <div className="qa-waves-pagination">
            <button type="button" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              Anterior
            </button>
            <span>Pagina {pagination.page} de {pagination.totalPages}</span>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Proxima
            </button>
          </div>
        </section>
      </div>

      <ReplayDetailsModal details={details} onClose={() => setDetails(null)} />
    </div>
  );
}

export default QaWavesPage;
