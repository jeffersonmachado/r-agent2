export type SupportTicket = {
  id: string;
  conversationId?: string;
  status?: string;
  mode?: string;
  customerName?: string;
  context?: {
    metadata?: {
      contactName?: string | null;
    };
    variables?: {
      name?: string | null;
      customerName?: string | null;
      nome?: string | null;
    };
  };
  phoneNumber?: string;
  queue?: string;
  updatedAt?: string;
  assignedTo?: string | null;
  assignedToDisplay?: string;
  unreadCount?: number;
  unread_count?: number;
  lastUserMessage?: string;
  customerPhoto?: string | null;
};

export type SupportMessage = {
  id?: string;
  externalMessageId?: string;
  sender?: string;
  text?: string;
  timestamp?: string;
  uiKey?: string;
};

export type TicketTimelineItem = {
  source?: string | null;
  externalMessageId?: string | null;
  direction?: string | null;
  text?: string | null;
  body?: { text?: string | null } | null;
  timestamp?: string | null;
};
