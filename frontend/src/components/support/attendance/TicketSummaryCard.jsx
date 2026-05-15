import React from 'react';

function cleanTicketId(id) {
  const raw = String(id || '').trim().replace(/^default-/i, '');
  if (!raw) return '-';
  if (raw.length <= 16) return raw;
  return `${raw.slice(0, 8)}…${raw.slice(-5)}`;
}

export function TicketSummaryCard({ ticket, formatDate }) {
  return (
    <section className="attendance-top-card">
      <h3>TICKET #{cleanTicketId(ticket?.id)}</h3>
      <div className="attendance-top-grid">
        <div><span>Data:</span><strong>{ticket?.date ? formatDate(ticket.date) : '-'}</strong></div>
        <div><span>Contato:</span><strong>{ticket?.contact || '-'}</strong></div>
        <div><span>Canal:</span><strong>{ticket?.channel || '-'}</strong></div>
        <div><span>Fila:</span><strong>{ticket?.queue || '-'}</strong></div>
        <div><span>Status:</span><strong>{ticket?.status || '-'}</strong></div>
        <div><span>Motivo:</span><strong>{ticket?.reason || '-'}</strong></div>
      </div>
    </section>
  );
}
