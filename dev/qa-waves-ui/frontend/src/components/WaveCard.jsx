import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import StatusBadge from './StatusBadge';
import WaveItemsTable from './WaveItemsTable';

export default function WaveCard({ wave, selectionState, checked, selectedItemIds, onToggleWave, onToggleItem, onPlayLatest }) {
  const [expanded, setExpanded] = useState(false);
  const checkboxRef = useRef(null);

  useEffect(() => {
    if (!checkboxRef.current) return;
    checkboxRef.current.indeterminate = selectionState === 'partial';
  }, [selectionState]);

  return (
    <article className="wave-card">
      <header className="wave-header">
        <div className="wave-header-left">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={checked}
            onChange={(event) => onToggleWave(wave.id, event.target.checked)}
          />
          <div>
            <h3>{wave.name}</h3>
            <p>{wave.description}</p>
          </div>
        </div>
        <div className="wave-header-right">
          <button className="secondary" onClick={() => onPlayLatest(wave.id)}>
            <Play size={15} /> Play
          </button>
          <StatusBadge status={wave.status} />
          <button className="icon-btn" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />} {expanded ? 'Recolher' : 'Expandir'}
          </button>
        </div>
      </header>

      <div className="wave-meta-grid">
        <span>Cobertura: {wave.coverage}%</span>
        <span>Itens: {wave.itemsCount}</span>
        <span>Replays: {wave.replayCount}</span>
        <span>Ultima execucao: {wave.lastRunAt ? new Date(wave.lastRunAt).toLocaleString('pt-BR') : '-'}</span>
      </div>

      {expanded && (
        <WaveItemsTable
          wave={wave}
          selectedItemIds={selectedItemIds}
          onToggleItem={onToggleItem}
        />
      )}
    </article>
  );
}
