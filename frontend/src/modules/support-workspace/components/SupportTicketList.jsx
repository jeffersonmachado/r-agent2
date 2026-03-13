import { PlatformGrid } from '../../platform-grid';

export function SupportTicketList({
  isMobile,
  loading,
  ticketsView,
  handleSelectTicket,
  selectedTicket,
  uiSearchDebounced,
  highlightText,
  getContactName,
  getPhoneNode,
  formatTicketMode,
  getStatusClass,
  formatTicketStatus,
  formatTime,
  formatBadgeCount,
  getTicketPreview,
  getAssignedLabel,
  getQueueLabel,
  supportGridColumns,
}) {
  return (
    <div className="support-tickets-panel">
      <div className="support-tickets-header">
        <h2>Chamados</h2>
      </div>
      {isMobile ? (
        loading ? (
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
                aria-label={`Chamado ${ticket.id}, ${formatTicketStatus(ticket.status)}`}
                aria-selected={selectedTicket?.id === ticket.id}
              >
                <div className="support-ticket-contact-row">
                  <span className="support-ticket-contact-name">{highlightText(getContactName(ticket), uiSearchDebounced)}</span>
                  <span className="support-ticket-contact-phone" aria-label={`Telefone: ${ticket.phoneNumber || '-'}`}>
                    {getPhoneNode(ticket)}
                  </span>
                </div>
                <div className="support-ticket-id-row">
                  <span className="support-ticket-id">#{ticket.id.slice(0, 12)}</span>
                  <span className="support-ticket-mode-badge">{formatTicketMode(ticket.mode)}</span>
                </div>
                <div className="support-ticket-top-row">
                  <div className="support-ticket-status-group">
                    <span className={`support-ticket-status ${getStatusClass(ticket.status)}`} aria-label={`Status: ${ticket.status}`}>
                      {formatTicketStatus(ticket.status)}
                    </span>
                    <span className="support-ticket-time">{formatTime(ticket.updatedAt || ticket.createdAt)}</span>
                  </div>
                  {ticket.unreadCount > 0 ? (
                    <span className="support-ticket-unread-badge" role="status" aria-label={`${ticket.unreadCount} mensagens nao lidas`}>
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
          </div>
        )
      ) : (
        <PlatformGrid
          columns={supportGridColumns}
          rows={ticketsView}
          loading={loading}
          dense
          onRowClick={handleSelectTicket}
          rowClassName={(ticket) => (selectedTicket?.id === ticket.id ? 'pg-tr--selected' : '')}
          emptyState={{
            title: 'Nenhum chamado disponivel',
            description: 'Ajuste os filtros para localizar conversas.',
          }}
        />
      )}
    </div>
  );
}
