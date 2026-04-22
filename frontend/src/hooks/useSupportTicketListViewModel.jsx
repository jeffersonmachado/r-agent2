import React, { useCallback, useMemo } from 'react';

export function useSupportTicketListViewModel({
  tickets,
  uiQueue,
  uiSearch,
  phoneMaskingEnabled,
}) {
  const getStatusClass = useCallback((status) => {
    if (status === 'waiting') return 'waiting';
    if (status === 'in_progress') return 'in_progress';
    return 'closed';
  }, []);

  const getModeLabel = useCallback((mode) => {
    const m = (mode || 'bot');
    if (m === 'human') return { label: 'HUMANO', bg: '#fff7ed', fg: '#9a3412' };
    if (m === 'paused') return { label: 'PAUSADO', bg: '#f3f4f6', fg: '#374151' };
    return { label: 'BOT', bg: '#ecfdf5', fg: '#065f46' };
  }, []);

  const formatTicketStatus = useCallback((status) => {
    if (status === 'waiting') return 'Aguardando';
    if (status === 'in_progress') return 'Em atendimento';
    if (status === 'closed') return 'Fechado';
    return status || 'Desconhecido';
  }, []);

  const formatTicketMode = useCallback((mode) => getModeLabel(mode).label, [getModeLabel]);

  const formatTime = useCallback((timestamp) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, []);

  const formatBadgeCount = useCallback((count) => {
    if (!count) return '0';
    if (count > 99) return '99+';
    return String(count);
  }, []);

  const getPhoneNode = useCallback((ticket) => ({ phone: ticket?.phoneNumber, mask: phoneMaskingEnabled }), [phoneMaskingEnabled]);

  const getContactName = useCallback((ticket) => (
    ticket?.contactName
      || ticket?.contact?.name
      || ticket?.context?.contactName
      || ticket?.context?.contact?.name
      || ticket?.phoneNumber
      || 'Sem contato'
  ), []);

  const highlightText = useCallback((text, searchTerm) => {
    const rawText = String(text || '');
    const needle = String(searchTerm || '').trim();
    if (!needle) return rawText;
    const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedNeedle})`, 'ig');
    return rawText.split(regex).map((part, index) => {
      const key = `${part}-${index}`;
      if (part.toLowerCase() === needle.toLowerCase()) {
        return React.createElement('mark', { key }, part);
      }
      return React.createElement(React.Fragment, { key }, part);
    });
  }, []);

  const getTicketPreview = useCallback((ticket, searchTerm) => {
    const preview = ticket?.lastUserMessage || ticket?.lastMessage || 'Sem mensagens recentes';
    return highlightText(preview, searchTerm);
  }, [highlightText]);

  const getAssignedLabel = useCallback((ticket) => (ticket?.assignedTo ? `Atendente: ${ticket.assignedTo}` : 'Sem responsavel'), []);
  const getQueueLabel = useCallback((ticket) => (ticket?.queue ? `Fila: ${ticket.queue}` : 'Sem fila'), []);

  const uiSearchDebounced = String(uiSearch || '').trim();

  const ticketQueueOptions = useMemo(() => (
    Array.from(new Set((tickets || []).map((ticket) => ticket?.queue).filter(Boolean))).sort()
  ), [tickets]);

  const ticketsView = useMemo(() => {
    return (tickets || []).filter((ticket) => {
      if (uiQueue && ticket?.queue !== uiQueue) return false;
      if (!uiSearchDebounced) return true;
      const haystack = [
        ticket?.id,
        getContactName(ticket),
        ticket?.phoneNumber,
        ticket?.lastUserMessage,
        ticket?.assignedTo,
        ticket?.queue,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(uiSearchDebounced.toLowerCase());
    });
  }, [tickets, uiQueue, uiSearchDebounced, getContactName]);

  const supportGridColumns = useMemo(() => ([
    {
      id: 'contact',
      header: 'Contato',
      render: (ticket) => (
        <div>
          <div style={{ fontWeight: 600 }}>{highlightText(getContactName(ticket), uiSearchDebounced)}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{ticket?.phoneNumber || '-'}</div>
        </div>
      ),
      sortValue: (ticket) => getContactName(ticket),
    },
    {
      id: 'status',
      header: 'Status',
      render: (ticket) => (
        <div>
          <span className={`support-ticket-status ${getStatusClass(ticket.status)}`}>{formatTicketStatus(ticket.status)}</span>
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{formatTicketMode(ticket.mode)}</div>
        </div>
      ),
      sortValue: (ticket) => ticket?.status,
      width: '160px',
    },
    {
      id: 'preview',
      header: 'Ultima mensagem',
      render: (ticket) => (
        <div>
          <div>{getTicketPreview(ticket, uiSearchDebounced)}</div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            {getAssignedLabel(ticket)} • {getQueueLabel(ticket)}
          </div>
        </div>
      ),
    },
    {
      id: 'updatedAt',
      header: 'Atualizacao',
      render: (ticket) => (
        <div>
          <div>{formatTime(ticket.updatedAt || ticket.createdAt)}</div>
          {ticket.unreadCount > 0 ? (
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#e74c3c', fontWeight: 700 }}>
              {formatBadgeCount(ticket.unreadCount)} nao lida(s)
            </div>
          ) : null}
        </div>
      ),
      sortValue: (ticket) => ticket?.updatedAt || ticket?.createdAt,
      width: '120px',
    },
  ]), [
    formatBadgeCount,
    formatTicketMode,
    formatTicketStatus,
    formatTime,
    getAssignedLabel,
    getContactName,
    getQueueLabel,
    getStatusClass,
    getTicketPreview,
    highlightText,
    uiSearchDebounced,
  ]);

  return {
    getStatusClass,
    getModeLabel,
    formatTicketStatus,
    formatTicketMode,
    formatTime,
    formatBadgeCount,
    getPhoneNode,
    getContactName,
    highlightText,
    getTicketPreview,
    getAssignedLabel,
    getQueueLabel,
    uiSearchDebounced,
    ticketQueueOptions,
    ticketsView,
    supportGridColumns,
  };
}
