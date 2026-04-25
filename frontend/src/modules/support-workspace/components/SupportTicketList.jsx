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
        <p className="support-tickets-empty">Nenhum chamado disponivel</p>
      ) : (
        <div className="support-tickets-list" role="list">
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
              aria-label={`Chamado ${ticket.id}, ${formatTicketStatus(ticket.status)}, ${ticket.unreadCount > 0 ? `${ticket.unreadCount} mensagens não lidas` : ''}`}
              aria-selected={selectedTicket?.id === ticket.id}
            >
              <div className="support-ticket-contact-row">
                <span className="support-ticket-contact-name">{highlightText(getContactName(ticket), uiSearchDebounced)}</span>
                <span className="support-ticket-contact-phone" aria-label={`Telefone: ${ticket.phoneNumber || '-'}`}>
                  {getPhoneNode(ticket)}
                </span>
              </div>
              <div className="support-ticket-id-row">
                <span className="support-ticket-id" title={ticket.id ? `ID completo: ${ticket.id}` : undefined}>
                  #{getTicketDisplayId ? getTicketDisplayId(ticket) : ticket.id}
                </span>
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
              {ticket.unreadCount > 0 ? (
                <div
                  className="support-ticket-unread-badge sr-only"
                  role="status"
                  aria-label={`${ticket.unreadCount} mensagens não lidas`}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'rgb(231, 76, 60)', color: 'white', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold' }}
                >
                  {formatBadgeCount(ticket.unreadCount)}
                </div>
              ) : null}
            </div>
          ))}
          <div aria-hidden="true" style={{ height: 1 }} />
        </div>
      )}
    </div>
  );
}
