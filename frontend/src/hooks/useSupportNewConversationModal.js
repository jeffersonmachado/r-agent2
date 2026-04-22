import { useCallback, useState } from 'react';

export function useSupportNewConversationModal({ loadTicketsRef, setSelectedTicket }) {
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [newConversationPhone, setNewConversationPhone] = useState('');
  const [newConversationMessage, setNewConversationMessage] = useState('');
  const [newConversationQueue, setNewConversationQueue] = useState('');

  const closeNewConversationModal = useCallback(() => {
    setShowNewConversationModal(false);
    setNewConversationPhone('');
    setNewConversationMessage('');
    setNewConversationQueue('');
  }, []);

  const handleTicketCreated = useCallback((ticket) => {
    if (loadTicketsRef.current) loadTicketsRef.current();
    setSelectedTicket(ticket);
  }, [loadTicketsRef, setSelectedTicket]);

  return {
    showNewConversationModal,
    setShowNewConversationModal,
    newConversationPhone,
    setNewConversationPhone,
    newConversationMessage,
    setNewConversationMessage,
    newConversationQueue,
    setNewConversationQueue,
    closeNewConversationModal,
    handleTicketCreated,
  };
}
