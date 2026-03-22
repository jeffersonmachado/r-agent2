import React from 'react';
import { SupportCard } from './SupportCard';

export function SupportConversationCard({ selectedTicket, children }) {
  if (!selectedTicket) return null;

  return (
    <SupportCard
      id="support-section-conversation"
      title="Atendimento atual"
      subtitle={`Workspace do ticket #${String(selectedTicket.id || '').slice(0, 12)}`}
      badge={(
        <span style={{
          padding: '2px 8px',
          borderRadius: '999px',
          fontSize: '11px',
          border: '1px solid var(--color-border-default)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-secondary)',
        }}>
          Conversa ativa
        </span>
      )}
    >
      {children}
    </SupportCard>
  );
}
