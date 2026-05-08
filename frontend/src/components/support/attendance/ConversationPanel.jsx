import React from 'react';
import { SupportConversationPane } from '../../../modules/support-workspace/components';

export function ConversationPanel({ paginationLabel, ...props }) {
  return (
    <section className="attendance-conversation-panel" data-testid="ticket-detail">
      <div className="attendance-conversation-counter">{paginationLabel}</div>
      <SupportConversationPane {...props} />
    </section>
  );
}
