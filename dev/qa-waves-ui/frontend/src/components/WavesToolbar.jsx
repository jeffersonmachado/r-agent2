import { RefreshCw, Search } from 'lucide-react';

export default function WavesToolbar({ search, onSearch, onReload, loading }) {
  return (
    <div className="toolbar">
      <div className="input-with-icon">
        <Search size={16} />
        <input
          placeholder="Buscar por onda, item, tipo ou canal"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <button className="secondary" onClick={onReload} disabled={loading}>
        <RefreshCw size={15} /> {loading ? 'Atualizando...' : 'Atualizar'}
      </button>
    </div>
  );
}
