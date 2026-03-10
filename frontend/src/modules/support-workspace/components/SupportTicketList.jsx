import { PlatformGrid } from '../../platform-grid';

export function SupportTicketList({
  showOthers,
  setShowOthers,
  showClosed,
  setShowClosed,
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
  sentinelRef,
  isLoadingPage,
  supportGridColumns,
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
              aria-checked={showOthers}
              className={`support-tickets-toggle ${showOthers ? 'active' : ''}`}
              onClick={() => setShowOthers((prev) => !prev)}
              aria-label="Alternar visualização de chamados de outros agentes"
            >
              <span className="support-tickets-toggle-knob" />
            </button>
          </label>

          <label className="support-tickets-checkbox">
            <span>Fechados</span>
            <button
              type="button"
              role="switch"
              aria-checked={showClosed}
              className={`support-tickets-toggle ${showClosed ? 'active' : ''}`}
              onClick={() => setShowClosed((prev) => !prev)}
              aria-label="Alternar visualização de chamados fechados"
            >
              <span className="support-tickets-toggle-knob" />
            </button>
          </label>
        </div>
      </div>
      {isMobile ? (
        loading ? (
          <p>Carregando...</p>
        ) : ticketsView.length === 0 ? (
          <p className="support-tickets-empty">Nenhum chamado disponível</p>
        ) : (
          <div className="support-tickets-list" role="list">
            {ticketsView.map((ticket) => (
              <div
                key={ticket.id}
                role="listitem"
                tabIndex={0}
                onClick={() => handleSelectTicket(ticket)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectTicket(ticket);
                  }
                }}
                className={`support-ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                aria-label={`Chamado ${ticket.id}, ${ticket.status === 'waiting' ? 'Aguardando' : ticket.status === 'in_progress' ? 'Em atendimento' : 'Fechado'}, ${ticket.unreadCount > 0 ? `${ticket.unreadCount} mensagens não lidas` : ''}`}
                aria-selected={selectedTicket?.id === ticket.id}
              >
                <div className="support-ticket-contact-row">
                  <span className="support-ticket-contact-name">{highlightText(getContactName(ticket), uiSearchDebounced)}</span>
                  <span className="support-ticket-contact-phone" aria-label={`Telefone: ${ticket.phoneNumber || '-'}`}>
                    {getPhoneNode(ticket)}
                  </span>
                </div>
                <div className="support-ticket-id-row">
                  <span className="support-ticket-id">#{ticket.id}</span>
                  <span className="support-ticket-mode-badge">{formatTicketMode(ticket.mode)}</span>
                </div>
                <div className="support-ticket-top-row">
                  <div className="support-ticket-status-group">
                    <span className={`support-ticket-status ${getStatusClass(ticket.status)}`} aria-label={`Status: ${ticket.status}`}>
                      {formatTicketStatus(ticket.status)}
                    </span>
                    <span className="support-ticket-time">{formatTime(ticket.updatedAt)}</span>
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
            <div ref={sentinelRef} aria-hidden="true" style={{ height: '1px' }} />
            {isLoadingPage && !loading ? (
              <p style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>Carregando mais...</p>
            ) : null}
          </div>
        )
      ) : (
        <>
          <PlatformGrid
            columns={supportGridColumns}
            rows={ticketsView}
            loading={loading}
            dense
            onRowClick={handleSelectTicket}
            rowClassName={(ticket) => (selectedTicket?.id === ticket.id ? 'pg-tr--selected' : '')}
            emptyState={{
              title: 'Nenhum chamado disponível',
              description: 'Ajuste os filtros para localizar conversas.',
            }}
          />
          <div ref={sentinelRef} aria-hidden="true" style={{ height: '1px' }} />
          {isLoadingPage && !loading ? (
            <p style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>Carregando mais...</p>
          ) : null}
        </>
      )}
    </div>
  );
}
