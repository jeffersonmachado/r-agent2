function getAgingColor(ticket) {
  const ts = ticket?.createdAt || ticket?.updatedAt;
  if (!ts || ticket?.status !== 'waiting') return null;
  const ageMin = (Date.now() - new Date(ts).getTime()) / 60000;
  if (ageMin > 60) return '#ef4444';
  if (ageMin > 30) return '#f59e0b';
  return '#22c55e';
}

export function SupportTicketList({
  loading,
  ticketsView,
  handleSelectTicket,
  selectedTicket,
  uiSearchDebounced,
  highlightText,
  getContactName,
  getPhoneNode,
  formatTicketMode,
  shouldShowTicketModeBadge,
  getStatusClass,
  formatTicketStatus,
  formatTime,
  formatBadgeCount,
  getTicketPreview,
  getAssignedLabel,
  getQueueLabel,
  getTicketDisplayId,
  showOtherAgents = false,
  setShowOtherAgents = null,
  showClosedTickets = false,
  setShowClosedTickets = null,
}) {
  return (
    <div className="support-tickets-panel">
      <div className="support-tickets-header">
        <h2>Chamados</h2>
        <div className="support-tickets-header-filters">
          <label className="support-tickets-checkbox">
            <span>Outros</span>
            <button
              type="button"
              role="switch"
              aria-checked={showOtherAgents}
              className={`support-tickets-toggle ${showOtherAgents ? 'active' : ''}`}
              aria-label="Alternar visualização de chamados de outros agentes"
              onClick={() => setShowOtherAgents?.((current) => !current)}
            >
              <span className="support-tickets-toggle-knob" />
            </button>
          </label>
          <label className="support-tickets-checkbox">
            <span>Fechados</span>
            <button
              type="button"
              role="switch"
              aria-checked={showClosedTickets}
              className={`support-tickets-toggle ${showClosedTickets ? 'active' : ''}`}
              aria-label="Alternar visualização de chamados fechados"
              onClick={() => setShowClosedTickets?.((current) => !current)}
            >
              <span className="support-tickets-toggle-knob" />
            </button>
          </label>
        </div>
      </div>
      {loading ? (
        <p>Carregando...</p>
      ) : ticketsView.length === 0 ? (
        <p className="support-tickets-empty">Nenhum chamado disponível</p>
      ) : (
        <div className="support-tickets-list" data-testid="ticket-list" role="list">
          {ticketsView.map((ticket) => (
            <div
              key={ticket.id}
              role="listitem"
              tabIndex={0}
              onClick={() => handleSelectTicket(ticket)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelectTicket(ticket);
                }
              }}
              className={`support-ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
              data-testid="ticket-card"
              data-ticket-id={ticket.id}
              data-ticket-status={ticket.status}
              aria-label={`Chamado ${ticket.id}, ${formatTicketStatus(ticket.status)}, ${ticket.unreadCount > 0 ? `${ticket.unreadCount} mensagens não lidas` : ''}`}
              aria-selected={selectedTicket?.id === ticket.id}
            >
              <div className="support-ticket-contact-row">
                <span className="support-ticket-contact-name">{highlightText(getContactName(ticket), uiSearchDebounced)}</span>
                {!/^Contato[\s•]/i.test(getContactName(ticket)) ? (
                  <span className="support-ticket-contact-phone" aria-label={`Telefone: ${ticket.phoneNumber || '-'}`}>
                    {getPhoneNode(ticket)}
                  </span>
                ) : null}
              </div>
              <div className="support-ticket-id-row">
                {(() => {
                  const agingColor = getAgingColor(ticket);
                  return agingColor ? (
                    <span
                      className="support-ticket-aging"
                      style={{ color: agingColor }}
                      title="Tempo aguardando"
                      aria-label="Indicador de tempo de espera"
                    >●</span>
                  ) : null;
                })()}
                {shouldShowTicketModeBadge?.(ticket.mode) ? (
                  <span className="support-ticket-mode-badge">{formatTicketMode(ticket.mode)}</span>
                ) : null}
              </div>
              <div className="support-ticket-top-row">
                <div className="support-ticket-status-group">
                  <span className={`support-ticket-status ${getStatusClass(ticket.status)}`} aria-label={`Status: ${ticket.status}`}>
                    {formatTicketStatus(ticket.status)}
                  </span>
                  <span className="support-ticket-time">{formatTime(ticket.updatedAt || ticket.createdAt)}</span>
                </div>
                {ticket.unreadCount > 0 ? (
                  <span className="support-ticket-unread-badge" role="status" aria-label={`${ticket.unreadCount} mensagens não lidas`}>
                    {formatBadgeCount(ticket.unreadCount)}
                  </span>
                ) : null}
              </div>
              <div className="support-ticket-preview">{getTicketPreview(ticket, uiSearchDebounced)}</div>
              <div className="support-ticket-meta-row">
                {getAssignedLabel(ticket)} • {getQueueLabel(ticket)}
              </div>
            </div>
          ))}
          <div aria-hidden="true" style={{ height: 1 }} />
        </div>
      )}
    </div>
  );
}
