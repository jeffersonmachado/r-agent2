import { useCallback, useState } from 'react';
import {
  assignTicket,
  takeOverTicket,
  returnToBotTicket,
  pauseTicket,
  resumeTicket,
  getTicketDeliveryFailures,
} from '../api/tickets';
import logger from '../utils/logger';

export function useSupportTicketActions({
  agent,
  selectedTicket,
  assignedTo,
  setAssignedTo,
  setSelectedTicket,
  setTickets,
  loadTicketsRef,
  loadTicketMessagesRef,
  showToast,
}) {
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [showDeliveryFailuresModal, setShowDeliveryFailuresModal] = useState(false);
  const [deliveryFailuresLoading, setDeliveryFailuresLoading] = useState(false);
  const [deliveryFailures, setDeliveryFailures] = useState({ outboundQueue: [], channelMessages: [] });

  const refreshTicketCollections = useCallback((nextTicket) => {
    setSelectedTicket(nextTicket);
    setTickets((prev) => prev.map((ticket) => (ticket.id === nextTicket.id ? nextTicket : ticket)));
    if (loadTicketsRef.current) {
      loadTicketsRef.current();
    }
    if (loadTicketMessagesRef.current) {
      loadTicketMessagesRef.current(nextTicket.id);
    }
  }, [loadTicketMessagesRef, loadTicketsRef, setSelectedTicket, setTickets]);

  const handleAssign = useCallback(async () => {
    if (!selectedTicket) {
      showToast('Selecione um ticket primeiro', 'warning');
      return;
    }

    const assigneeName = assignedTo.trim() || agent?.username || agent?.id || '';
    if (!assigneeName) {
      showToast('Informe o nome do atendente', 'warning');
      return;
    }

    try {
      await assignTicket(selectedTicket.id, assigneeName);
      showToast('Ticket atribuído com sucesso', 'success');
      setSelectedTicket(null);
      setAssignedTo('');
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    } catch (error) {
      logger.error('Erro ao atribuir ticket', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao atribuir ticket. Verifique se o atendente existe.';
      showToast(errorMessage, 'error');
    }
  }, [agent?.id, agent?.username, assignedTo, loadTicketsRef, selectedTicket, setAssignedTo, setSelectedTicket, showToast]);

  const handleTakeOver = useCallback(async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await takeOverTicket(selectedTicket.id, 'agent_takeover');
      const nextTicket = updated?.id ? updated : { ...selectedTicket, mode: 'human' };
      showToast('Atendimento assumido (modo humano)', 'success');
      refreshTicketCollections(nextTicket);
    } catch (error) {
      logger.error('Erro ao assumir atendimento', error);
      showToast('Erro ao assumir atendimento', 'error');
    } finally {
      setHandoverLoading(false);
    }
  }, [refreshTicketCollections, selectedTicket, showToast]);

  const handleReturnToBot = useCallback(async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await returnToBotTicket(selectedTicket.id, 'user_request');
      const nextTicket = updated?.id ? updated : { ...selectedTicket, mode: 'bot', pauseReason: null };
      showToast('Atendimento devolvido ao bot (modo bot)', 'success');
      refreshTicketCollections(nextTicket);
    } catch (error) {
      logger.error('Erro ao devolver ao bot', error);
      showToast('Erro ao devolver ao bot', 'error');
    } finally {
      setHandoverLoading(false);
    }
  }, [refreshTicketCollections, selectedTicket, showToast]);

  const handlePause = useCallback(async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await pauseTicket(selectedTicket.id, 'outside_window');
      const nextTicket = updated?.id ? updated : { ...selectedTicket, mode: 'paused', pauseReason: 'outside_window' };
      showToast('Atendimento pausado', 'success');
      refreshTicketCollections(nextTicket);
    } catch (error) {
      logger.error('Erro ao pausar atendimento', error);
      showToast('Erro ao pausar atendimento', 'error');
    } finally {
      setHandoverLoading(false);
    }
  }, [refreshTicketCollections, selectedTicket, showToast]);

  const handleResume = useCallback(async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await resumeTicket(selectedTicket.id, 'resume');
      const nextTicket = updated?.id ? updated : { ...selectedTicket, mode: 'human', pauseReason: null };
      showToast('Atendimento retomado (modo humano)', 'success');
      refreshTicketCollections(nextTicket);
    } catch (error) {
      logger.error('Erro ao retomar atendimento', error);
      showToast('Erro ao retomar atendimento', 'error');
    } finally {
      setHandoverLoading(false);
    }
  }, [refreshTicketCollections, selectedTicket, showToast]);

  const openDeliveryFailures = useCallback(async () => {
    if (!selectedTicket) return;
    setShowDeliveryFailuresModal(true);
    setDeliveryFailuresLoading(true);
    try {
      const data = await getTicketDeliveryFailures(selectedTicket.id);
      setDeliveryFailures({
        outboundQueue: Array.isArray(data?.outboundQueue) ? data.outboundQueue : [],
        channelMessages: Array.isArray(data?.channelMessages) ? data.channelMessages : [],
      });
    } catch (error) {
      logger.error('Erro ao carregar falhas de entrega', error);
      showToast('Erro ao carregar falhas de entrega', 'error');
      setDeliveryFailures({ outboundQueue: [], channelMessages: [] });
    } finally {
      setDeliveryFailuresLoading(false);
    }
  }, [selectedTicket, showToast]);

  return {
    handoverLoading,
    showDeliveryFailuresModal,
    setShowDeliveryFailuresModal,
    deliveryFailuresLoading,
    deliveryFailures,
    handleAssign,
    handleTakeOver,
    handleReturnToBot,
    handlePause,
    handleResume,
    openDeliveryFailures,
  };
}
