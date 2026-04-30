import React from 'react';
import { SupportTicketList } from '../../../modules/support-workspace/components';

export function TicketList(props) {
  return (
    <div className="attendance-ticket-list-wrap">
      <SupportTicketList {...props} />
    </div>
  );
}
