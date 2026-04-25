import React from 'react';
import PriorityBadge from './PriorityBadge.jsx';
import StatusBadge from './StatusBadge.jsx';

export function DeliverablesList({ deliverables = [] }) {
  if (!deliverables.length) {
    return <div className="wm-empty-state">Nenhuma entrega encontrada.</div>;
  }

  return (
    <div className="wm-table-wrap">
      <table className="wm-table">
        <thead>
          <tr>
            <th>Entrega</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Projeto</th>
            <th>Prazo</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {deliverables.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </td>
              <td>{item.type}</td>
              <td><StatusBadge status={item.status} /></td>
              <td>{item.project?.name || '-'}</td>
              <td>{new Date(item.dueDate).toLocaleDateString('pt-BR')}</td>
              <td><PriorityBadge priority={item.priority} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DeliverablesList;