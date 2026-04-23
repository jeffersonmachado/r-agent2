import { Play, X } from 'lucide-react';

export default function ExecutionSelectionBar({ summary, onExecute, onClear, running }) {
  return (
    <div className="selection-bar">
      <div>
        <strong>{summary.selectedItemsCount}</strong> itens selecionados em <strong>{summary.selectedWavesCount}</strong>{' '}
        ondas
      </div>
      <div className="selection-actions">
        <button className="secondary" onClick={onClear} disabled={!summary.hasSelection || running}>
          <X size={14} /> Limpar
        </button>
        <button className="primary" onClick={onExecute} disabled={!summary.hasSelection || running}>
          <Play size={14} /> {running ? 'Executando...' : 'Executar selecionados'}
        </button>
      </div>
    </div>
  );
}
