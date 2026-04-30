import React, { useCallback, useMemo } from 'react';

const looksLikePhone = (value) => /^\+?\d[\d\s().-]{7,}$/.test(String(value || '').trim());

const extractPhone = (ticket) => (
  ticket?.phoneNumber
  || ticket?.phone_number
  || ticket?.phone
  || ticket?.contactPhone
  || ticket?.contact_phone
  || ticket?.contact?.phone
  || ticket?.contact?.waId
  || ticket?.contact?.wa_id
  || ticket?.contact?.whatsapp
  || ticket?.contact?.whatsappNumber
  || ticket?.context?.metadata?.phoneNumber
  || ticket?.context?.metadata?.phone_number
  || ticket?.context?.metadata?.phone
  || ticket?.context?.metadata?.waId
  || ticket?.context?.metadata?.wa_id
  || ticket?.context?.variables?.phoneNumber
  || ticket?.context?.variables?.phone_number
  || ticket?.context?.variables?.phone
  || ticket?.context?.variables?.waId
  || ticket?.context?.variables?.wa_id
  || ticket?.from
  || ticket?.remoteJid
  || null
);

const buildAnonymousContactName = (ticket, phoneMaskingEnabled) => {
  const phone = String(extractPhone(ticket) || '').replace(/\D/g, '');
  if (!phone) return 'Contato sem nome';
  const last4 = phone.slice(-4) || '----';
  if (phoneMaskingEnabled) return `Contato ••••${last4}`;
  return `Contato ${phone}`;
};

const truncateId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'Sem ID';
  if (raw.length <= 14) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
};

const redactSensitiveText = (value) => {
  const text = String(value || '');
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, 'CPF oculto')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, 'CNPJ oculto')
    .replace(/\+?55?\s?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}\b/g, 'telefone oculto');
};

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
    const m = (mode || '').toLowerCase();
    if (m === 'human') return { label: 'HUMANO', bg: '#fff7ed', fg: '#9a3412' };
    if (m === 'paused') return { label: 'PAUSADO', bg: '#f3f4f6', fg: '#374151' };
    if (m === 'bot') return { label: 'BOT', bg: '#ecfdf5', fg: '#065f46' };
    return { label: null, bg: '#f3f4f6', fg: '#374151' };
  }, []);

  const formatTicketStatus = useCallback((status) => {
    if (status === 'waiting') return 'Aguardando';
    if (status === 'in_progress') return 'Em atendimento';
    if (status === 'closed') return 'Fechado';
    return status || 'Desconhecido';
  }, []);

  const formatTicketMode = useCallback((mode) => getModeLabel(mode).label, [getModeLabel]);
  const shouldShowTicketModeBadge = useCallback((mode) => {
    const m = String(mode || '').toLowerCase();
    return m === 'human' || m === 'paused';
  }, []);

  const formatTime = useCallback((timestamp) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, []);

  const formatBadgeCount = useCallback((count) => {
    if (!count) return '0';
    if (count > 99) return '99+';
    return String(count);
  }, []);

  const getPhoneNode = useCallback((ticket) => ({
    phone: extractPhone(ticket),
    mask: phoneMaskingEnabled,
  }), [phoneMaskingEnabled]);

  const getContactName = useCallback((ticket) => {
    const composedName = [
      ticket?.firstName || ticket?.first_name,
      ticket?.lastName || ticket?.last_name,
    ].filter(Boolean).join(' ').trim();

    const contactField = typeof ticket?.contact === 'object'
      ? (
        ticket?.contact?.name
        || ticket?.contact?.displayName
        || ticket?.contact?.profileName
        || ticket?.contact?.pushName
        || ticket?.contact?.fullName
        || ticket?.contact?.nome
      )
      : ticket?.contact;

    return (
      ticket?.contactName
      || ticket?.contact_name
      || ticket?.displayName
      || ticket?.display_name
      || ticket?.profileName
      || ticket?.profile_name
      || ticket?.pushName
      || ticket?.push_name
      || ticket?.fullName
      || ticket?.full_name
      || ticket?.name
      || ticket?.nome
      || ticket?.customerName
      || ticket?.customer_name
      || contactField
      || composedName
      || ticket?.context?.contactName
      || ticket?.context?.contact_name
      || ticket?.context?.displayName
      || ticket?.context?.display_name
      || ticket?.context?.profileName
      || ticket?.context?.profile_name
      || ticket?.context?.pushName
      || ticket?.context?.push_name
      || ticket?.context?.metadata?.contactName
      || ticket?.context?.metadata?.contact_name
      || ticket?.context?.metadata?.customerName
      || ticket?.context?.metadata?.customer_name
      || ticket?.context?.metadata?.name
      || ticket?.context?.metadata?.displayName
      || ticket?.context?.metadata?.display_name
      || ticket?.context?.metadata?.profileName
      || ticket?.context?.metadata?.profile_name
      || ticket?.context?.metadata?.pushName
      || ticket?.context?.metadata?.push_name
      || ticket?.context?.metadata?.fullName
      || ticket?.context?.metadata?.full_name
      || ticket?.context?.metadata?.nome
      || ticket?.context?.contact?.name
      || ticket?.context?.contact?.displayName
      || ticket?.context?.contact?.profileName
      || ticket?.context?.contact?.pushName
      || ticket?.context?.variables?.customerName
      || ticket?.context?.variables?.customer_name
      || ticket?.context?.variables?.name
      || ticket?.context?.variables?.displayName
      || ticket?.context?.variables?.display_name
      || ticket?.context?.variables?.profileName
      || ticket?.context?.variables?.profile_name
      || ticket?.context?.variables?.pushName
      || ticket?.context?.variables?.push_name
      || ticket?.context?.variables?.fullName
      || ticket?.context?.variables?.full_name
      || ticket?.context?.variables?.nome
      || (!phoneMaskingEnabled && !looksLikePhone(ticket?.phoneNumber) ? ticket?.phoneNumber : null)
      || (!phoneMaskingEnabled && !looksLikePhone(ticket?.phone_number) ? ticket?.phone_number : null)
      || (!phoneMaskingEnabled && !looksLikePhone(ticket?.phone) ? ticket?.phone : null)
      || buildAnonymousContactName(ticket, phoneMaskingEnabled)
    );
  }, [phoneMaskingEnabled]);

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
    const rawPreview = ticket?.lastUserMessage || ticket?.lastMessage || 'Sem mensagens recentes';
    const preview = phoneMaskingEnabled ? redactSensitiveText(rawPreview) : rawPreview;
    return highlightText(preview, searchTerm);
  }, [highlightText, phoneMaskingEnabled]);

  const getAssignedLabel = useCallback((ticket) => {
    const assignedName = ticket?.assignedToName
      || ticket?.assigned_to_name
      || ticket?.assignedAgentName
      || ticket?.assigned_agent_name
      || ticket?.assignedUserName
      || ticket?.assigned_user_name
      || ticket?.context?.assignedToName
      || ticket?.context?.assigned_to_name
      || ticket?.context?.assignedAgentName
      || ticket?.context?.metadata?.assignedToName
      || ticket?.context?.metadata?.assigned_to_name;
    const assignedRaw = ticket?.assignedTo || ticket?.assigned_to || ticket?.assignee;
    const assigned = assignedName || assignedRaw;
    if (!assigned) return 'Sem responsável';
    if (/^[0-9a-f-]{20,}$/i.test(String(assigned))) return `Atendente: ${truncateId(assigned)}`;
    return `Atendente: ${assigned}`;
  }, []);
  const getQueueLabel = useCallback((ticket) => (ticket?.queue ? `Fila: ${ticket.queue}` : 'Sem fila'), []);
  const getTicketDisplayId = useCallback((ticket) => truncateId(ticket?.id), []);

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
        ticket?.phone_number,
        ticket?.phone,
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
          {shouldShowTicketModeBadge(ticket.mode) ? (
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{formatTicketMode(ticket.mode)}</div>
          ) : null}
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
    shouldShowTicketModeBadge,
    uiSearchDebounced,
  ]);

  return {
    getStatusClass,
    getModeLabel,
    formatTicketStatus,
    formatTicketMode,
    shouldShowTicketModeBadge,
    formatTime,
    formatBadgeCount,
    getPhoneNode,
    getContactName,
    highlightText,
    getTicketPreview,
    getAssignedLabel,
    getQueueLabel,
    getTicketDisplayId,
    uiSearchDebounced,
    ticketQueueOptions,
    ticketsView,
    supportGridColumns,
  };
}
