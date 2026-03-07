export type SupportTicket = {
  id: string;
  conversationId?: string;
  status?: string;
  mode?: string;
  pauseReason?: string | null;
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

export type TicketDeliveryFailureItem = {
  id?: string | number;
  message?: string;
  status?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TicketDeliveryFailures = {
  ticketId?: string;
  conversationId?: string | null;
  outboundQueue?: TicketDeliveryFailureItem[];
  channelMessages?: TicketDeliveryFailureItem[];
};

export type SupportMessage = {
  id?: string;
  externalMessageId?: string;
  sender?: string;
  senderDisplay?: string;
  agentId?: string;
  text?: string;
  timestamp?: string;
  uiKey?: string;
  messageType?: 'text' | 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
};

export type TicketTimelineItem = {
  source?: string | null;
  externalMessageId?: string | null;
  direction?: string | null;
  type?: string | null;
  text?: string | null;
  body?: { text?: string | null } | null;
  timestamp?: string | null;
};
