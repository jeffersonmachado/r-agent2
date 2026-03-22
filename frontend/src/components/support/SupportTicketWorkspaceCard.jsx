import React from 'react';
import { MaskedPhone } from '../MaskedPhone';
import { SupportCard } from './SupportCard';

export function SupportTicketWorkspaceCard({
  ticket,
  phoneMaskingEnabled,
  formatDate,
  modeLabel,
}) {
  if (!ticket) return null;

  return (
    <SupportCard
      id="support-section-ticket"
      title="Atendimento atual"
      subtitle="Resumo operacional do ticket selecionado"
      badge={(
        <span style={{
          padding: '2px 8px',
          borderRadius: '999px',
          fontSize: '11px',
          border: '1px solid #ddd',
          background: modeLabel.bg,
          color: modeLabel.fg,
        }}>
          {modeLabel.label}
        </span>
      )}
    >
      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'grid', gap: '6px' }}>
        <div>📞 <strong><MaskedPhone phone={ticket.phoneNumber} mask={phoneMaskingEnabled} /></strong></div>
        <div>Fila: <strong>{ticket.queue || 'Sem fila'}</strong></div>
        <div>Status: <strong>{ticket.status || 'desconhecido'}</strong></div>
        {ticket.pauseReason ? <div>Motivo: <strong>{ticket.pauseReason}</strong></div> : null}
        {ticket?.context?.closeReasonName ? <div>Close reason: <strong>{ticket.context.closeReasonName}</strong></div> : null}
        {ticket.channelType ? <div>Canal: <strong>{ticket.channelType}</strong></div> : null}
        {ticket.conversationId ? <div>ConversationId: <code>{ticket.conversationId}</code></div> : null}
        <div>Criado: {formatDate(ticket.createdAt)}</div>
      </div>
    </SupportCard>
  );
}
