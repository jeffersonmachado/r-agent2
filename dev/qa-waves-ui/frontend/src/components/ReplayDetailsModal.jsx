import StatusBadge from './StatusBadge';
import ReplayPlayer from './ReplayPlayer';

export default function ReplayDetailsModal({ replay, autoPlay = false, onClose }) {
  if (!replay) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>{replay.name}</h3>
          <button className="secondary" onClick={onClose}>Fechar</button>
        </header>
        <div className="details-grid">
          <span>ID: {replay.id}</span>
          <span>Onda: {replay.waveName}</span>
          <span>Item: {replay.itemName}</span>
          <span>Canal: {replay.channel}</span>
          <span>Seed: {replay.seed}</span>
          <span>
            Status: <StatusBadge status={replay.status} />
          </span>
          <span>Inicio: {new Date(replay.startedAt).toLocaleString('pt-BR')}</span>
          <span>Fim: {new Date(replay.finishedAt).toLocaleString('pt-BR')}</span>
          <span>Duracao: {Math.round(replay.durationMs / 1000)}s</span>
          <span>Criticidade: {replay.critical ? 'Alta' : 'Normal'}</span>
          <span>Historico: {replay.historyFile || 'Nao encontrado'}</span>
          <span>Artefato: {replay.replayArtifact || 'Nao encontrado'}</span>
        </div>

        <section className="typed-section">
          <h4>Digitado no replay</h4>
          {Array.isArray(replay.typedEntries) && replay.typedEntries.length > 0 ? (
            <ul className="typed-list">
              {replay.typedEntries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.field}:</strong> {entry.value}
                  {entry.selector ? <span> | seletor: {entry.selector}</span> : null}
                  {entry.at ? <span> | {new Date(entry.at).toLocaleString('pt-BR')}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma digitacao identificada neste replay.</p>
          )}
        </section>

        <section className="typed-section">
          <h4>Player do replay</h4>
          <ReplayPlayer playback={replay.playback} autoPlay={autoPlay} />
        </section>
      </div>
    </div>
  );
}
