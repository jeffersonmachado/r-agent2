import React from 'react';
import { SupportConversationPane } from '../../../modules/support-workspace/components';

export function ConversationPanel({ paginationLabel, ...props }) {
  return (
    <section className="attendance-conversation-panel">
      <div className="attendance-conversation-counter">{paginationLabel}</div>
      <SupportConversationPane {...props} />
    </section>
  );
}
