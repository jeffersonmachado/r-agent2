export function SupportFiltersBar({
  uiSearch,
  setUiSearch,
  uiChip,
  setUiChip,
  showClosed,
  ticketQueueOptions,
  uiQueue,
  setUiQueue,
  uiContactHistoryOnly,
  setUiContactHistoryOnly,
  canFilterBySelectedContactHistory,
  onClear,
}) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
      <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
        <span>🔍</span>
        <span>Filtros</span>
      </h3>
      <div className="space-y-4">
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

        <div className="overflow-x-auto">
          <div className="flex min-w-max items-center gap-2">
            {[
              { key: 'all', label: 'Todos' },
              { key: 'unread', label: 'Não lidos' },
              { key: 'waiting', label: 'Aguardando' },
              { key: 'in_progress', label: 'Em atendimento' },
              { key: 'closed', label: 'Fechados', disabled: !showClosed, title: "Ative 'Fechados' para incluir tickets fechados" },
              { key: 'unassigned', label: 'Sem responsável' },
            ].map((chip) => {
              const isActive = uiChip === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    chip.disabled
                      ? 'cursor-not-allowed border-border-default bg-bg-default text-text-secondary opacity-50'
                      : isActive
                        ? 'border-primary/40 bg-primary/10 text-text-primary'
                        : 'border-border-default bg-bg-default text-text-secondary hover:border-primary/30 hover:text-text-primary'
                  }`}
                  onClick={() => {
                    if (chip.disabled) return;
                    setUiChip(chip.key);
                  }}
                  disabled={Boolean(chip.disabled)}
                  title={chip.title || chip.label}
                  aria-pressed={isActive}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {ticketQueueOptions.length > 0 ? (
          <div className="flex items-center gap-2">
            <label htmlFor="support-ui-queue-filter" className="text-sm text-text-secondary">Fila</label>
            <select
              id="support-ui-queue-filter"
              value={uiQueue}
              onChange={(event) => setUiQueue(event.target.value)}
              className="rounded-md border border-border-default bg-bg-default px-2.5 py-1.5 text-sm text-text-primary outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Todas as filas</option>
              {ticketQueueOptions.map((queueName) => (
                <option key={queueName} value={queueName}>{queueName}</option>
              ))}
            </select>
          </div>
        ) : null}

        <label className="support-tickets-checkbox">
          <span>Histórico do contato</span>
          <button
            type="button"
            role="switch"
            aria-checked={uiContactHistoryOnly}
            className={`support-tickets-toggle ${uiContactHistoryOnly ? 'active' : ''}`}
            onClick={() => {
              if (!canFilterBySelectedContactHistory) return;
              setUiContactHistoryOnly((prev) => !prev);
            }}
            aria-label="Alternar filtro para listar todos os históricos do contato selecionado"
            disabled={!canFilterBySelectedContactHistory}
            title={canFilterBySelectedContactHistory ? 'Listar todos os históricos do contato selecionado' : 'Selecione um ticket com contato ou telefone para usar este filtro'}
          >
            <span className="support-tickets-toggle-knob" />
          </button>
        </label>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-border-default bg-bg-default px-2.5 py-1 text-xs text-text-secondary transition hover:text-text-primary"
          >
            Limpar
          </button>
        </div>
      </div>
    </div>
  );
}
