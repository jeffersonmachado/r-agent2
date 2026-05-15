import React from 'react';

export function CustomerHistoryCard({ customer }) {
  return (
    <section className="attendance-top-card">
      <h3>Histórico do cliente</h3>
      <div className="attendance-top-grid">
        <div><span>Nome:</span><strong>{customer?.name || '-'}</strong></div>
        <div><span>Nome social:</span><strong>{customer?.socialName || '-'}</strong></div>
        <div><span>CPF/CNPJ:</span><strong>{customer?.document || '-'}</strong></div>
      </div>
    </section>
  );
}
