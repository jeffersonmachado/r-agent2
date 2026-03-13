export function SupportFiltersBar({
  uiSearch = '',
  setUiSearch = null,
  ticketQueueOptions = [],
  uiQueue = '',
  setUiQueue = null,
  onClear = null,
}) {
  if (!setUiSearch && !setUiQueue && !onClear) return null;

  return (
    <div className="support-filters-card">
      <div className="support-filters-title">Filtros</div>
      <div className="support-filters-grid">
        {setUiSearch ? (
          <input
            type="text"
            value={uiSearch}
            onChange={(event) => setUiSearch(event.target.value)}
            placeholder="Pesquisar ticket, contato ou telefone"
            className="support-form-input"
            aria-label="Pesquisar tickets"
          />
        ) : null}
        {setUiQueue && ticketQueueOptions.length > 0 ? (
          <select
            value={uiQueue}
            onChange={(event) => setUiQueue(event.target.value)}
            className="support-form-select"
            aria-label="Filtrar por fila"
          >
            <option value="">Todas as filas</option>
            {ticketQueueOptions.map((queueName) => (
              <option key={queueName} value={queueName}>{queueName}</option>
            ))}
          </select>
        ) : null}
      </div>
      {onClear ? (
        <div className="support-filters-actions">
          <button type="button" onClick={onClear} className="support-filters-clear">Limpar</button>
        </div>
      ) : null}
    </div>
  );
}
