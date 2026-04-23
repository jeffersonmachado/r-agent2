import StatusBadge from './StatusBadge';

export default function ExecutionQueuePanel({ execution, history }) {
  return (
    <section className="execution-panel">
      <h3>Fila de execucao</h3>
      {!execution && <p>Nenhuma execucao ativa no momento.</p>}
      {execution && (
        <div>
          <div className="execution-topline">
            <span>ID: {execution.executionId}</span>
            <StatusBadge status={execution.status} />
          </div>
          <ul className="queue-list">
            {execution.items.map((item) => (
              <li key={item.itemId}>
                <span>{item.itemName}</span>
                <span>{item.channel}</span>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4>Ultimas execucoes</h4>
      <ul className="history-list">
        {history.slice(0, 5).map((item) => (
          <li key={item.executionId}>
            <span>{item.executionId}</span>
            <span>{new Date(item.startedAt).toLocaleString('pt-BR')}</span>
            <StatusBadge status={item.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
