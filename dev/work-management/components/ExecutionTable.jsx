import React from 'react';
import StatusBadge from './StatusBadge.jsx';

function formatDuration(value) {
  const seconds = Math.round(Number(value || 0) / 1000);
  return `${seconds}s`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

export function ExecutionTable({ executions = [], itemsById = {}, onOpenExecution, onOpenReplay }) {
  if (!executions.length) {
    return <div className="wm-empty-state">Nenhuma execucao para os filtros atuais.</div>;
  }

  return (
    <div className="wm-table-wrap">
      <table className="wm-table">
        <thead>
          <tr>
            <th>Work item</th>
            <th>Status</th>
            <th>Ambiente</th>
            <th>Tenant</th>
            <th>Duracao</th>
            <th>Data</th>
            <th>Acoes</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={execution.id}>
              <td>
                <strong>{itemsById[execution.workItemId]?.title || execution.workItemId}</strong>
              </td>
              <td><StatusBadge status={execution.status} /></td>
              <td>{execution.environment}</td>
              <td>{execution.tenant}</td>
              <td>{formatDuration(execution.duration)}</td>
              <td>{formatDate(execution.timestamp)}</td>
              <td>
                <div className="wm-table-actions">
                  <button type="button" className="wm-button wm-button-secondary" onClick={() => onOpenExecution?.(execution.id)}>
                    Ver execucao
                  </button>
                  <button type="button" className="wm-button wm-button-secondary" onClick={() => onOpenReplay?.(execution.id)}>
                    Replay relacionado
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ExecutionTable;