import { memo } from 'react';
import { Button } from '../../../styles/Button';
import { useIncrementalList, useLoadMoreSentinel } from '../../../hooks/useIncrementalList';

function getAgingInfo(ticket) {
  const ts = ticket?.createdAt || ticket?.updatedAt;
  if (!ts || ticket?.status !== 'waiting') return null;
  const ageMin = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  let color;
  let label;
  if (ageMin > 60) {
    color = '#ef4444';
    label = ageMin >= 120 ? `aguardando há ${Math.floor(ageMin / 60)}h` : `aguardando há ${ageMin}min`;
  } else if (ageMin > 30) {
    color = '#f59e0b';
    label = `aguardando há ${ageMin}min`;
  } else {
    color = '#22c55e';
    label = ageMin < 1 ? 'recém criado' : `aguardando há ${ageMin}min`;
  }
  return { color, label };
}

const SupportTicketCard = memo(function SupportTicketCard({
  ticket,
  selected,
  onSelect,
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
}) {
  return (
    <div
      role="listitem"
      tabIndex={0}
      onClick={() => onSelect(ticket)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(ticket);
        }
      }}
      className={`support-ticket-card ${selected ? 'selected' : ''}`}
      data-testid="ticket-card"
      data-ticket-id={ticket.id}
      data-ticket-status={ticket.status}
      aria-label={[
        `Chamado ${getTicketDisplayId ? getTicketDisplayId(ticket) : ticket.id}`,
        getContactName(ticket),
        formatTicketStatus(ticket.status),
        ticket.unreadCount > 0 ? `${ticket.unreadCount} mensagens não lidas` : '',
      ].filter(Boolean).join(', ')}
      aria-selected={selected}
    >
      <div className="support-ticket-contact-row">
        <span className="support-ticket-contact-name">{highlightText(getContactName(ticket), uiSearchDebounced)}</span>
        {(() => {
          const cname = getContactName(ticket);
          const isMaskedFallback = /^Contato\s/.test(cname) && /•/.test(cname);
          return !isMaskedFallback && ticket.phoneNumber ? (
            <span className="support-ticket-contact-phone" aria-label={`Telefone: ${ticket.phoneNumber}`}>
              {getPhoneNode(ticket)}
            </span>
          ) : null;
        })()}
      </div>
      <div className="support-ticket-id-row">
        {(() => {
          const aging = getAgingInfo(ticket);
          return aging ? (
            <span
              className="support-ticket-aging"
              style={{ color: aging.color }}
              title={aging.label}
              aria-label={aging.label}
            >●</span>
          ) : null;
        })()}
        {shouldShowTicketModeBadge?.(ticket.mode) ? (
          <span className="support-ticket-mode-badge">{formatTicketMode(ticket.mode)}</span>
        ) : null}
      </div>
      <div className="support-ticket-top-row">
        <div className="support-ticket-status-group">
          <span className={`support-ticket-status ${getStatusClass(ticket.status)}`} aria-label={`Status: ${formatTicketStatus(ticket.status)}`}>
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
  );
});

export const SupportTicketList = memo(function SupportTicketList({
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
  // Lista pode chegar a ~2.000 chamados: renderiza em blocos de 200
  // (IntersectionObserver + botão manual como fallback).
  const {
    visibleItems: visibleTickets,
    hasMore: hasMoreTickets,
    loadMore: loadMoreTickets,
    visibleCount: visibleTicketCount,
    totalCount: totalTicketCount,
  } = useIncrementalList(ticketsView, { batchSize: 200 });
  const loadMoreSentinelRef = useLoadMoreSentinel({ enabled: hasMoreTickets, onLoadMore: loadMoreTickets });

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
          {visibleTickets.map((ticket) => (
            <SupportTicketCard
              key={ticket.id}
              ticket={ticket}
              selected={selectedTicket?.id === ticket.id}
              onSelect={handleSelectTicket}
              uiSearchDebounced={uiSearchDebounced}
              highlightText={highlightText}
              getContactName={getContactName}
              getPhoneNode={getPhoneNode}
              formatTicketMode={formatTicketMode}
              shouldShowTicketModeBadge={shouldShowTicketModeBadge}
              getStatusClass={getStatusClass}
              formatTicketStatus={formatTicketStatus}
              formatTime={formatTime}
              formatBadgeCount={formatBadgeCount}
              getTicketPreview={getTicketPreview}
              getAssignedLabel={getAssignedLabel}
              getQueueLabel={getQueueLabel}
              getTicketDisplayId={getTicketDisplayId}
            />
          ))}
          {hasMoreTickets ? (
            <div ref={loadMoreSentinelRef} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={loadMoreTickets}
                aria-label={`Carregar mais chamados (${visibleTicketCount} de ${totalTicketCount} exibidos)`}
              >
                Carregar mais chamados ({visibleTicketCount}/{totalTicketCount})
              </Button>
            </div>
          ) : null}
          <div aria-hidden="true" style={{ height: 1 }} />
        </div>
      )}
    </div>
  );
});
