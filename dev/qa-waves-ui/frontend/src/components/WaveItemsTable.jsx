import { useMemo, useState } from 'react';
import StatusBadge from './StatusBadge';

export default function WaveItemsTable({ wave, selectedItemIds, onToggleItem }) {
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  function toggleSort(nextSortBy) {
    if (sortBy === nextSortBy) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(nextSortBy);
      setSortDir('asc');
    }
    setPage(1);
  }

  function readSortValue(item) {
    switch (sortBy) {
      case 'type':
        return item.type || '';
      case 'channel':
        return item.channel || '';
      case 'critical':
        return item.critical ? 1 : 0;
      case 'lastStatus':
        return item.lastStatus || '';
      case 'lastRunAt':
        return item.lastRunAt ? new Date(item.lastRunAt).getTime() : 0;
      case 'name':
      default:
        return item.name || '';
    }
  }

  function compareValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  }

  const orderedItems = useMemo(() => {
    const all = [...(wave.items || [])];
    all.sort((a, b) => {
      const base = compareValues(readSortValue(a), readSortValue(b));
      return sortDir === 'asc' ? base : -base;
    });
    return all;
  }, [wave.items, sortBy, sortDir]);

  const total = orderedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = orderedItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  function sortHeader(key, label) {
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
              <th>Selecionar</th>
              <th>{sortHeader('name', 'Item')}</th>
              <th>{sortHeader('type', 'Tipo')}</th>
              <th>{sortHeader('channel', 'Canal')}</th>
              <th>{sortHeader('critical', 'Criticidade')}</th>
              <th>{sortHeader('lastStatus', 'Ultimo status')}</th>
              <th>{sortHeader('lastRunAt', 'Ultima execucao')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => {
              const checked = selectedItemIds.has(item.id);
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => onToggleItem(wave.id, item.id, event.target.checked)}
                    />
                  </td>
                  <td>{item.name}</td>
                  <td>{item.type}</td>
                  <td>{item.channel}</td>
                  <td>{item.critical ? 'Alta' : 'Normal'}</td>
                  <td>
                    <StatusBadge status={item.lastStatus} />
                  </td>
                  <td>{item.lastRunAt ? new Date(item.lastRunAt).toLocaleString('pt-BR') : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pagination-bar">
        <span>
          Itens: {total} | Pagina {safePage} de {totalPages}
        </span>
        <div className="selection-actions">
          <label>
            Itens/pagina
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </label>
          <button className="secondary" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
            Anterior
          </button>
          <button
            className="secondary"
            onClick={() => setPage(Math.min(totalPages, safePage + 1))}
            disabled={safePage >= totalPages}
          >
            Proxima
          </button>
        </div>
      </div>
    </div>
  );
}
