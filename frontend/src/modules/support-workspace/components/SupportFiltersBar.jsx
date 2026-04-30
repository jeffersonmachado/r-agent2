export function SupportFiltersBar({
  uiSearch = '',
  setUiSearch = null,
  ticketQueueOptions = [],
  uiQueue = '',
  setUiQueue = null,
  onClear = null,
  ticketViewFilter = 'all',
  setTicketViewFilter = null,
  showClosedTickets = false,
}) {
  if (!setUiSearch && !setUiQueue && !onClear) return null;

  const filterOptions = [
    { id: 'all', label: 'Todos', disabled: false },
    { id: 'unread', label: 'Não lidos', disabled: false },
    { id: 'waiting', label: 'Aguardando', disabled: false },
    { id: 'in_progress', label: 'Em atendimento', disabled: false },
    { id: 'closed', label: 'Fechados', disabled: !showClosedTickets },
    { id: 'unassigned', label: 'Sem responsável', disabled: false },
  ];

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
      <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
        <span>🔍</span>
        <span>Filtros</span>
      </h3>
      <div className="space-y-4">
        {setUiSearch ? (
          <div>
            <input
              type="text"
              value={uiSearch}
              onChange={(event) => setUiSearch(event.target.value)}
              placeholder="Pesquisar tickets, contato, número WhatsApp…"
              className="w-full rounded-lg border border-border-default bg-bg-default px-3 py-2 text-sm text-text-primary outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              aria-label="Pesquisar tickets"
            />
          </div>
        ) : null}

        {setTicketViewFilter ? (
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-center gap-2">
              {filterOptions.map((option) => {
                const isActive = ticketViewFilter === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      if (!option.disabled) setTicketViewFilter(option.id);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      isActive
                        ? 'border-primary/40 bg-primary/10 text-text-primary'
                        : option.disabled
                          ? 'cursor-not-allowed border-border-default bg-bg-default text-text-secondary opacity-50'
                          : 'border-border-default bg-bg-default text-text-secondary hover:border-primary/30 hover:text-text-primary'
                    }`}
                    title={option.label}
                    aria-pressed={isActive}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {setUiQueue && ticketQueueOptions.length > 0 ? (
          <div className="flex items-center gap-2">
            <label htmlFor="support-ui-queue-filter" className="text-sm text-text-secondary">Fila</label>
            <select
              id="support-ui-queue-filter"
              value={uiQueue}
              onChange={(event) => setUiQueue(event.target.value)}
              className="rounded-md border border-border-default bg-bg-default px-2.5 py-1.5 text-sm text-text-primary outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              aria-label="Filtrar por fila"
            >
              <option value="">Todas as filas</option>
              {ticketQueueOptions.map((queueName) => (
                <option key={queueName} value={queueName}>{queueName}</option>
              ))}
            </select>
          </div>
        ) : null}

        {onClear ? (
          <div className="flex items-center justify-end">
            <button type="button" onClick={onClear} className="rounded-md border border-border-default bg-bg-default px-2.5 py-1 text-xs text-text-secondary transition hover:text-text-primary">
              Limpar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
