import DateTimeRangeFilter from './DateTimeRangeFilter';

export default function ReplayFilters({ filters, onChange, onReset, waves, activeCount }) {
  const allItems = waves.flatMap((wave) => wave.items || []);

  return (
    <section className="filters-panel">
      <div className="filters-header">
        <h3>Filtros de replay</h3>
        <button className="secondary" onClick={onReset}>Limpar filtros ({activeCount})</button>
      </div>

      <div className="filters-grid">
        <label>
          Onda
          <select value={filters.waveId} onChange={(event) => onChange('waveId', event.target.value)}>
            <option value="">Todas</option>
            {waves.map((wave) => (
              <option key={wave.id} value={wave.id}>
                {wave.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Item
          <select value={filters.itemId} onChange={(event) => onChange('itemId', event.target.value)}>
            <option value="">Todos</option>
            {allItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select value={filters.status} onChange={(event) => onChange('status', event.target.value)}>
            <option value="">Todos</option>
            <option value="success">Sucesso</option>
            <option value="failure">Falha</option>
            <option value="executing">Executando</option>
            <option value="pending">Pendente</option>
          </select>
        </label>

        <label>
          Canal
          <select value={filters.channel} onChange={(event) => onChange('channel', event.target.value)}>
            <option value="">Todos</option>
            <option value="webchat">Webchat</option>
            <option value="voice">Voice</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>

        <label className="query-field">
          Busca livre
          <input
            placeholder="nome, onda, item ou seed"
            value={filters.query}
            onChange={(event) => onChange('query', event.target.value)}
          />
        </label>

        <label>
          Ordenar por
          <select value={filters.sortBy} onChange={(event) => onChange('sortBy', event.target.value)}>
            <option value="startedAt">Data/hora</option>
            <option value="name">Replay</option>
            <option value="waveName">Onda</option>
            <option value="itemName">Item</option>
            <option value="channel">Canal</option>
            <option value="status">Status</option>
            <option value="durationMs">Duracao</option>
            <option value="critical">Criticidade</option>
          </select>
        </label>

        <label>
          Direcao
          <select value={filters.sortDir} onChange={(event) => onChange('sortDir', event.target.value)}>
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
        </label>
      </div>

      <DateTimeRangeFilter filters={filters} onChange={onChange} />
    </section>
  );
}
