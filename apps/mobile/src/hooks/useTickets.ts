import { useState } from 'react';
import type { SupportMessage, SupportTicket } from '../support-types';

export function useTickets(initialVisibleMessagesCount: number) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isChatScreen, setIsChatScreen] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [visibleMessagesCount, setVisibleMessagesCount] = useState(initialVisibleMessagesCount);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  return {
    tickets,
    setTickets,
    ticketsLoading,
    setTicketsLoading,
    selectedTicketId,
    setSelectedTicketId,
    isChatScreen,
    setIsChatScreen,
    showOptionsMenu,
    setShowOptionsMenu,
    messages,
    setMessages,
    visibleMessagesCount,
    setVisibleMessagesCount,
    messagesLoading,
    setMessagesLoading,
    messagesLoadingMore,
    setMessagesLoadingMore,
    messageDraft,
    setMessageDraft,
    sendingMessage,
    setSendingMessage,
  };
}
