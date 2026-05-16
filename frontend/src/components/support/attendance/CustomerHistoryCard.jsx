import React from 'react';

export function CustomerHistoryCard({ customer }) {
  const hasNoData = !customer?.name || customer.name === 'Não identificado';
  return (
    <section className="attendance-top-card">
      <h3>Histórico do cliente</h3>
      <div className="attendance-top-grid">
        <div>
          <span>Nome:</span>
          <strong style={hasNoData ? { color: 'var(--color-text-tertiary)', fontStyle: 'italic' } : undefined}>
            {customer?.name || 'Não identificado'}
          </strong>
        </div>
        {customer?.phone ? (
          <div><span>Telefone:</span><strong>{customer.phone}</strong></div>
        ) : null}
        {customer?.socialName && customer.socialName !== '-' ? (
          <div><span>Nome social:</span><strong>{customer.socialName}</strong></div>
        ) : null}
        {customer?.document && customer.document !== '-' ? (
          <div><span>CPF/CNPJ:</span><strong>{customer.document}</strong></div>
        ) : null}
      </div>
    </section>
  );
}
