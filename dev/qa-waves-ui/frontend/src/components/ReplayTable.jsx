import StatusBadge from './StatusBadge';

export default function ReplayTable({
  replays,
  pagination,
  sortBy,
  sortDir,
  onSortChange,
  onPageChange,
  onOpenDetails,
  onPlay,
  onReexecute
}) {
  function toggleSort(key) {
    if (sortBy === key) {
      onSortChange(key, sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    onSortChange(key, 'asc');
  }

  function sortLabel(key, label) {
    const marker = sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return (
      <button className="sort-header" onClick={() => toggleSort(key)}>
        {label}
        {marker}
      </button>
    );
  }

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{sortLabel('name', 'Replay')}</th>
              <th>{sortLabel('waveName', 'Onda')}</th>
              <th>{sortLabel('itemName', 'Item')}</th>
              <th>Seed</th>
              <th>{sortLabel('channel', 'Canal')}</th>
              <th>{sortLabel('status', 'Resultado')}</th>
              <th>{sortLabel('startedAt', 'Data/hora')}</th>
              <th>{sortLabel('durationMs', 'Duracao')}</th>
              <th>{sortLabel('critical', 'Criticidade')}</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {replays.map((replay) => (
              <tr key={replay.id}>
                <td>{replay.name}</td>
                <td>{replay.waveName}</td>
                <td>{replay.itemName}</td>
                <td>{replay.seed}</td>
                <td>{replay.channel}</td>
                <td>
                  <StatusBadge status={replay.status} />
                </td>
                <td>{new Date(replay.startedAt).toLocaleString('pt-BR')}</td>
                <td>{Math.round(replay.durationMs / 1000)}s</td>
                <td>{replay.critical ? 'Alta' : 'Normal'}</td>
                <td>
                  <div className="table-actions">
                    <button className="primary" onClick={() => onPlay(replay.id)}>
                      Play
                    </button>
                    <button className="secondary" onClick={() => onOpenDetails(replay.id)}>
                      Detalhes
                    </button>
                    <button className="secondary" onClick={() => onReexecute(replay.id)}>
                      Reexecutar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination-bar">
        <span>
          Total: {pagination.total} | Pagina {pagination.page} de {pagination.totalPages}
        </span>
        <div className="selection-actions">
          <button
            className="secondary"
            onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1}
          >
            Anterior
          </button>
          <button
            className="secondary"
            onClick={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
            disabled={pagination.page >= pagination.totalPages}
          >
            Proxima
          </button>
        </div>
      </div>
    </div>
  );
}
