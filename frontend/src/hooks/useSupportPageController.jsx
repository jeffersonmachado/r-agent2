import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listAllTickets,
  sendTicketMessage,
} from '../api/tickets';
import { addTagToTicket, removeTagFromTicket } from '../api/segmentation';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useDebounce } from './useDebounce';
import { useSupportEvidence } from './useSupportEvidence';
import { useSupportSlashMenu } from './useSupportSlashMenu';
import { useSupportTicketContext } from './useSupportTicketContext';
import { useSupportQuickReplies } from './useSupportQuickReplies';
import { useSupportTicketActions } from './useSupportTicketActions';
import { useSupportCloseTicket } from './useSupportCloseTicket';
import { useSupportNewConversationModal } from './useSupportNewConversationModal';
import { useSupportTicketListViewModel } from './useSupportTicketListViewModel';
import { useSupportTimelinePresentation } from './useSupportTimelinePresentation';
import websocketMetrics from '../utils/websocketMetrics';
import logger from '../utils/logger';
import { normalizeContactName } from '../utils/contactName';

function resolveTicketPhone(ticket) {
  return (
    ticket?.phoneNumber
    || ticket?.phone_number
    || ticket?.phone
    || ticket?.contactPhone
    || ticket?.contact_phone
    || ticket?.contact?.phone
    || ticket?.contact?.waId
    || ticket?.contact?.wa_id
    || ticket?.contact?.whatsapp
    || ticket?.contact?.whatsappNumber
    || ticket?.context?.metadata?.phoneNumber
    || ticket?.context?.metadata?.phone_number
    || ticket?.context?.metadata?.phone
    || ticket?.context?.metadata?.waId
    || ticket?.context?.metadata?.wa_id
    || ticket?.context?.variables?.phoneNumber
    || ticket?.context?.variables?.phone_number
    || ticket?.context?.variables?.phone
    || ticket?.context?.variables?.waId
    || ticket?.context?.variables?.wa_id
    || ticket?.from
    || ticket?.remoteJid
    || null
  );
}

function resolveTicketName(ticket) {
  const contactFromObject = typeof ticket?.contact === 'object'
    ? (
      ticket?.contact?.name
      || ticket?.contact?.displayName
      || ticket?.contact?.profileName
      || ticket?.contact?.pushName
      || ticket?.contact?.fullName
      || ticket?.contact?.nome
    )
    : ticket?.contact;

  const composedName = [
    ticket?.firstName || ticket?.first_name,
    ticket?.lastName || ticket?.last_name,
  ].filter(Boolean).join(' ').trim();

  return normalizeContactName(
    ticket?.contactName
    || ticket?.contact_name
    || ticket?.displayName
    || ticket?.display_name
    || ticket?.profileName
    || ticket?.profile_name
    || ticket?.pushName
    || ticket?.push_name
    || ticket?.fullName
    || ticket?.full_name
    || ticket?.name
    || ticket?.nome
    || ticket?.customerName
    || ticket?.customer_name
    || contactFromObject
    || composedName
    || ticket?.context?.metadata?.contactName
    || ticket?.context?.metadata?.contact_name
    || ticket?.context?.metadata?.customerName
    || ticket?.context?.metadata?.customer_name
    || ticket?.context?.metadata?.name
    || ticket?.context?.metadata?.displayName
    || ticket?.context?.metadata?.display_name
    || ticket?.context?.metadata?.profileName
    || ticket?.context?.metadata?.profile_name
    || ticket?.context?.metadata?.pushName
    || ticket?.context?.metadata?.push_name
    || ticket?.context?.metadata?.fullName
    || ticket?.context?.metadata?.full_name
    || ticket?.context?.metadata?.nome
    || ticket?.context?.variables?.customerName
    || ticket?.context?.variables?.customer_name
    || ticket?.context?.variables?.name
    || ticket?.context?.variables?.nome
    || ticket?.context?.variables?.displayName
    || ticket?.context?.variables?.display_name
    || ticket?.context?.variables?.profileName
    || ticket?.context?.variables?.profile_name
    || ticket?.context?.variables?.pushName
    || ticket?.context?.variables?.push_name
    || ticket?.context?.variables?.fullName
    || ticket?.context?.variables?.full_name
    || null
  );
}

export function useSupportPageController({
  agent,
  isAuthenticated,
  showToast,
  confirm,
  phoneMaskingEnabled,
}) {
  const [queues, setQueues] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [uiSearch, setUiSearch] = useState('');
  const [uiQueue, setUiQueue] = useState('');
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
  const [isConversationListVisibleDesktop, setIsConversationListVisibleDesktop] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
  const [tagInput, setTagInput] = useState('');
  const [wsUiStatus, setWsUiStatus] = useState({ phase: 'connecting' });

  const autoRefresh = true;
  const showToastRef = React.useRef(showToast);
  const loadTicketsRef = React.useRef();
  const selectedTicketIdRef = React.useRef(null);
  const isLoadingTicketsRef = React.useRef(false);
  const lastErrorToastTimeRef = React.useRef(0);
  const hasLoadedInitialDataRef = React.useRef(false);

  const ERROR_TOAST_COOLDOWN = 30000;

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      const mobile = window.innerWidth <= 900;
      setIsMobile(mobile);
      setIsRightPanelCollapsed((current) => (mobile ? current : false));
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const {
    timelineMessages,
    ticketEvents,
    ticketAuditLogs,
    ticketAuditLoading,
    aiSummary,
    aiSummaryLoading,
    knownTags,
    extractedEntities,
    messagesContainerRef,
    loadTicketMessages,
    loadTicketMessagesRef,
    safeGetBodyText,
  } = useSupportTicketContext({
    selectedTicket,
    setSelectedTicket,
    setTickets,
    showToast,
  });

  const loadQueues = useCallback(async () => {
    try {
      const queuesList = await listQueues();
      setQueues(queuesList);
    } catch (error) {
      logger.error('Erro ao carregar filas', error);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    if (isLoadingTicketsRef.current) return;

    isLoadingTicketsRef.current = true;
    setLoading(true);
    try {
      const [waitingResult, inProgressResult] = await Promise.all([
        listAllTickets({ status: 'waiting', limit: 1000 }),
        listAllTickets({ status: 'in_progress', limit: 1000 }),
      ]);

      const allTickets = [...(waitingResult.tickets || []), ...(inProgressResult.tickets || [])];
      const uniqueTickets = Array.from(
        new Map(allTickets.map((ticket) => [ticket.id, ticket])).values()
      );

      const normalizedTickets = uniqueTickets.map((ticket) => {
        const resolvedPhone = resolveTicketPhone(ticket);
        const resolvedName = resolveTicketName(ticket);

        return {
          ...ticket,
          phoneNumber: resolvedPhone,
          contactName: resolvedName,
        };
      });

      normalizedTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setTickets(normalizedTickets);
      setSelectedTicket((prevSelected) => {
        if (!prevSelected) return null;
        const updatedTicket = normalizedTickets.find((t) => t.id === prevSelected.id);
        if (!updatedTicket) return null;
        return updatedTicket;
      });

      lastErrorToastTimeRef.current = 0;
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      const now = Date.now();
      if (now - lastErrorToastTimeRef.current > ERROR_TOAST_COOLDOWN) {
        lastErrorToastTimeRef.current = now;
        showToastRef.current('Erro ao carregar tickets', 'error', 5000);
      }
    } finally {
      setLoading(false);
      isLoadingTicketsRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  useEffect(() => {
    if (hasLoadedInitialDataRef.current) return;
    hasLoadedInitialDataRef.current = true;
    loadQueues();
    loadTickets();
  }, [loadQueues, loadTickets]);

  const { debouncedFn: debouncedLoadTickets } = useDebounce(() => {
    if (loadTicketsRef.current) loadTicketsRef.current();
  }, 500);

  const mergeTicketWithPrevious = useCallback((previousTicket, incomingTicket) => {
    if (!previousTicket) return incomingTicket;
    if (!incomingTicket) return previousTicket;

    const merged = {
      ...previousTicket,
      ...incomingTicket,
      context: {
        ...(previousTicket.context || {}),
        ...(incomingTicket.context || {}),
        metadata: {
          ...(previousTicket.context?.metadata || {}),
          ...(incomingTicket.context?.metadata || {}),
        },
        variables: {
          ...(previousTicket.context?.variables || {}),
          ...(incomingTicket.context?.variables || {}),
        },
      },
      contact: {
        ...(previousTicket.contact || {}),
        ...(incomingTicket.contact || {}),
      },
    };

    const resolvedPhone = resolveTicketPhone(incomingTicket) || resolveTicketPhone(previousTicket);
    const resolvedName = resolveTicketName(incomingTicket) || resolveTicketName(previousTicket);

    return {
      ...merged,
      phoneNumber: resolvedPhone,
      contactName: resolvedName,
    };
  }, []);

  const updateTicketInList = useCallback((ticket) => {
    if (!ticket) return;

    setTickets((prevTickets) => {
      const existingIndex = prevTickets.findIndex((t) => t.id === ticket.id);
      const newTickets = [...prevTickets];

      const shouldShow = (ticket.status === 'waiting' || ticket.status === 'in_progress')
        && (!ticket.assignedTo || ticket.assignedTo === agent?.id || ticket.assignedTo === agent?.username);

      if (existingIndex >= 0) {
        if (shouldShow) {
          newTickets[existingIndex] = mergeTicketWithPrevious(newTickets[existingIndex], ticket);
        } else {
          newTickets.splice(existingIndex, 1);
        }
      } else if (shouldShow) {
        newTickets.push(ticket);
      }

      newTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return newTickets;
    });

    setSelectedTicket((prevSelected) => {
      if (prevSelected?.id === ticket.id) return mergeTicketWithPrevious(prevSelected, ticket);
      return prevSelected;
    });
  }, [agent?.id, agent?.username, mergeTicketWithPrevious]);

  const handleWebSocketEvent = useCallback((event, data) => {
    logger.debug('[SupportPage] Evento WebSocket recebido', event, data);
    websocketMetrics.recordWebSocketEvent(event);

    switch (event) {
      case 'ticket.created':
        if (data.ticket) {
          updateTicketInList(data.ticket);
        } else {
          debouncedLoadTickets();
        }
        if (data.agentId === agent?.id || !data.agentId) {
          showToastRef.current(`Novo ticket criado: ${data.ticketId?.slice(0, 8)}`, 'info', 3000);
        }
        break;
      case 'ticket.assigned':
        if (data.ticket) {
          updateTicketInList(data.ticket);
        } else {
          debouncedLoadTickets();
        }
        if (data.assignedTo === agent?.id || data.assignedTo === agent?.username) {
          showToastRef.current(`Ticket atribuído para você: ${data.ticketId?.slice(0, 8)}`, 'success', 3000);
        }
        break;
      case 'ticket.updated':
        if (data.ticket) {
          updateTicketInList(data.ticket);
        } else {
          debouncedLoadTickets();
        }
        if (selectedTicketIdRef.current === data.ticketId && loadTicketMessagesRef.current) {
          loadTicketMessagesRef.current(data.ticketId);
        }
        break;
      case 'ticket.closed':
        setTickets((prevTickets) => prevTickets.filter((t) => t.id !== data.ticketId));
        if (selectedTicketIdRef.current === data.ticketId) setSelectedTicket(null);
        break;
      case 'ticket.message.received':
      case 'ticket.message.sent':
        if (data.ticket) updateTicketInList(data.ticket);
        if (selectedTicketIdRef.current === data.ticketId) {
          if (loadTicketMessagesRef.current) loadTicketMessagesRef.current(data.ticketId);
          if (document.hidden || !document.hasFocus()) {
            showToastRef.current(`Nova mensagem no ticket ${data.ticketId?.slice(0, 8)}`, 'info', 3000);
          }
        } else if (!data.ticket) {
          debouncedLoadTickets();
        }
        break;
      default:
        logger.debug('[SupportPage] Evento WebSocket não tratado', event);
    }
  }, [agent?.id, agent?.username, debouncedLoadTickets, loadTicketMessagesRef, updateTicketInList]);

  const { connected: wsConnected, authenticated: wsAuthenticated } = useWebSocketContext({
    enabled: isAuthenticated && autoRefresh,
    onEvent: handleWebSocketEvent,
    subscribeEvents: [
      'ticket.created',
      'ticket.assigned',
      'ticket.updated',
      'ticket.closed',
      'ticket.message.received',
      'ticket.message.sent',
    ],
  });

  useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?.id || null;
  }, [selectedTicket?.id]);

  useEffect(() => {
    websocketMetrics.setWebSocketStatus(wsConnected && wsAuthenticated);
  }, [wsConnected, wsAuthenticated]);

  useEffect(() => {
    let timeoutId = null;

    if (wsConnected && wsAuthenticated) {
      setWsUiStatus({ phase: 'ready' });
      return () => {};
    }
    if (wsConnected && !wsAuthenticated) {
      setWsUiStatus({ phase: 'auth' });
      const authTimeoutId = setTimeout(() => {
        setWsUiStatus({ phase: 'auth_error' });
      }, 5000);
      return () => clearTimeout(authTimeoutId);
    }

    setWsUiStatus({ phase: 'connecting' });
    timeoutId = setTimeout(() => {
      setWsUiStatus({ phase: 'disconnected' });
    }, 1500);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [wsConnected, wsAuthenticated]);

  useEffect(() => {
    if (selectedTicket?.status === 'waiting' && !assignedTo) {
      const defaultAssignee = agent?.username || agent?.id || '';
      if (defaultAssignee) setAssignedTo(defaultAssignee);
      return;
    }
    if (!selectedTicket?.id) setAssignedTo('');
  }, [selectedTicket?.id, selectedTicket?.status, assignedTo, agent?.username, agent?.id]);

  const {
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
  } = useSupportNewConversationModal({
    loadTicketsRef,
    setSelectedTicket,
  });

  const {
    showCloseModal,
    closing,
    closeReasons,
    selectedCloseReasonId,
    setSelectedCloseReasonId,
    selectedCloseReasonName,
    setSelectedCloseReasonName,
    closeTagsInput,
    setCloseTagsInput,
    handleClose,
    handleConfirmClose,
    closeCloseModal,
  } = useSupportCloseTicket({
    confirm,
    selectedTicket,
    setSelectedTicket,
    loadTicketsRef,
    showToast,
  });

  const {
    quickReplySuggestions,
    quickReplyCategories,
    quickReplySelectedCategory,
    setQuickReplySelectedCategory,
    quickReplyCategoryItems,
    insertQuickReply,
  } = useSupportQuickReplies({
    selectedTicket,
    setMessageText,
  });

  const {
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
  } = useSupportTicketActions({
    agent,
    selectedTicket,
    assignedTo,
    setAssignedTo,
    setSelectedTicket,
    setTickets,
    loadTicketsRef,
    loadTicketMessagesRef,
    showToast,
  });

  const updateTicketLocal = useCallback((ticket) => {
    if (!ticket?.id) return;
    setTickets((prev) => {
      const idx = prev.findIndex((t) => t.id === ticket.id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = ticket;
      return next;
    });
    setSelectedTicket((prev) => (prev?.id === ticket.id ? ticket : prev));
  }, []);

  const handleAddTag = useCallback(async () => {
    if (!selectedTicket) return;
    const t = (tagInput || '').trim();
    if (!t) return;
    try {
      const updated = await addTagToTicket(selectedTicket.id, t);
      updateTicketLocal(updated);
      setTagInput('');
    } catch (error) {
      logger.error('Erro ao adicionar tag', error);
      showToast('Erro ao adicionar tag', 'error');
    }
  }, [selectedTicket, tagInput, showToast, updateTicketLocal]);

  const handleRemoveTag = useCallback(async (tag) => {
    if (!selectedTicket) return;
    try {
      const updated = await removeTagFromTicket(selectedTicket.id, tag);
      updateTicketLocal(updated);
    } catch (error) {
      logger.error('Erro ao remover tag', error);
      showToast('Erro ao remover tag', 'error');
    }
  }, [selectedTicket, showToast, updateTicketLocal]);

  const handleSendMessage = useCallback(async () => {
    if (!selectedTicket || !messageText.trim()) {
      showToast('Digite uma mensagem', 'warning');
      return;
    }

    const messageToSend = messageText.trim();
    setMessageText('');

    try {
      await sendTicketMessage(selectedTicket.id, messageToSend);
      showToastRef.current('Mensagem enviada com sucesso', 'success');
      await loadTicketMessages(selectedTicket.id);
      if (loadTicketsRef.current) loadTicketsRef.current();
    } catch (error) {
      logger.error('Erro ao enviar mensagem', error);
      setMessageText(messageToSend);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao enviar mensagem. Verifique sua conexão e tente novamente.';
      showToast(errorMessage, 'error');
    }
  }, [selectedTicket, messageText, showToast, loadTicketMessages]);

  const executeSlashCommand = useCallback(async (commandId) => {
    switch (commandId) {
      case 'take-over':
        await handleTakeOver();
        return;
      case 'return-to-bot':
        await handleReturnToBot();
        return;
      case 'pause':
        await handlePause();
        return;
      case 'resume':
        await handleResume();
        return;
      case 'schedule':
        showToast('Fluxo de agendamento disponível para este ticket', 'info');
        return;
      case 'delivery-failures':
        await openDeliveryFailures();
        return;
      case 'close-ticket':
        handleClose(selectedTicket?.id);
        return;
      default:
        return;
    }
  }, [handleClose, handlePause, handleResume, handleReturnToBot, handleTakeOver, openDeliveryFailures, selectedTicket?.id, showToast]);

  const {
    quickReplySlashResults,
    quickReplySlashOpen,
    slashMenuMode,
    slashCommandResults,
    slashMenuCursorIndex,
    onHoverSlashItem,
    onSelectSlashItem,
    onComposerKeyDown,
  } = useSupportSlashMenu({
    selectedTicket,
    messageText,
    quickReplySelectedCategory,
    onExecuteSlashCommand: executeSlashCommand,
    onInsertQuickReply: insertQuickReply,
    onSendMessage: handleSendMessage,
  });

  const formatDate = useCallback((dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  }, []);

  const {
    evidenceHistory,
    evidenceLoading,
    suggestedReply,
    handleCopyEvidence,
    handleUseEvidenceAsReply,
    handleOpenEvidenceSource,
    handleOpenTimelineItem,
  } = useSupportEvidence({
    selectedTicket,
    tickets,
    setSelectedTicket,
    setMessageText,
    showToast,
    formatDate,
  });

  const ticketListViewModel = useSupportTicketListViewModel({
    tickets,
    uiQueue,
    uiSearch,
    phoneMaskingEnabled,
  });

  const timelinePresentation = useSupportTimelinePresentation({
    safeGetBodyText,
  });

  const wsStatus = React.useMemo(() => {
    if (wsUiStatus.phase === 'ready') {
      return {
        label: 'Conectado',
        title: 'WebSocket conectado e autenticado - Atualizações em tempo real ativas',
        color: 'rgb(37, 211, 102)',
        animated: true,
      };
    }
    if (wsUiStatus.phase === 'auth') {
      return {
        label: 'Autenticando...',
        title: 'WebSocket conectado, autenticando...',
        color: 'rgb(59, 130, 246)',
        animated: true,
      };
    }
    if (wsUiStatus.phase === 'auth_error') {
      return {
        label: 'Falha de auth',
        title: 'WebSocket conectado, mas falha na autenticação',
        color: 'rgb(239, 68, 68)',
        animated: false,
      };
    }
    if (wsUiStatus.phase === 'connecting') {
      return {
        label: 'Conectando...',
        title: 'WebSocket conectando...',
        color: 'rgb(59, 130, 246)',
        animated: true,
      };
    }
    return {
      label: 'Desconectado',
      title: 'WebSocket desconectado',
      color: 'rgb(245, 158, 11)',
      animated: false,
    };
  }, [wsUiStatus.phase]);

  const {
    getStatusClass,
    getModeLabel,
    formatTicketStatus,
    formatTicketMode,
    shouldShowTicketModeBadge,
    formatTime,
    formatBadgeCount,
    getPhoneNode,
    getContactName,
    highlightText,
    getTicketPreview,
    getAssignedLabel,
    getQueueLabel,
    getTicketDisplayId,
    uiSearchDebounced,
    ticketQueueOptions,
    ticketsView,
    supportGridColumns,
  } = ticketListViewModel;

  const {
    getDeliveryStatusBadge,
    renderTimelineMessageContent,
  } = timelinePresentation;

  const clearTicketFilters = useCallback(() => {
    setUiSearch('');
    setUiQueue('');
  }, []);

  const handleSelectTicket = useCallback((ticket) => {
    setSelectedTicket(ticket);
    if (isMobile) {
      setIsRightPanelCollapsed(true);
    } else {
      setIsConversationListVisibleDesktop(false);
    }
  }, [isMobile]);

  return {
    state: {
      agent,
      queues,
      loading,
      selectedTicket,
      isMobile,
      isConversationListVisibleDesktop,
      isRightPanelCollapsed,
      uiSearch,
      uiQueue,
      ticketsView,
      uiSearchDebounced,
      ticketQueueOptions,
      wsStatus,
      messageText,
      assignedTo,
      tagInput,
      phoneMaskingEnabled,
    },
    ticketContext: {
      timelineMessages,
      ticketEvents,
      ticketAuditLogs,
      ticketAuditLoading,
      aiSummary,
      aiSummaryLoading,
      knownTags,
      extractedEntities,
      messagesContainerRef,
    },
    evidence: {
      evidenceHistory,
      evidenceLoading,
      suggestedReply,
      handleCopyEvidence,
      handleUseEvidenceAsReply,
      handleOpenEvidenceSource,
      handleOpenTimelineItem,
    },
    actions: {
      setSelectedTicket,
      setIsConversationListVisibleDesktop,
      setIsRightPanelCollapsed,
      setUiSearch,
      setUiQueue,
      clearTicketFilters,
      handleSelectTicket,
      setMessageText,
      setAssignedTo,
      setTagInput,
      handleAddTag,
      handleRemoveTag,
      handleSendMessage,
      loadTickets: () => loadTicketsRef.current?.(),
      formatDate,
      getStatusClass,
      formatTicketStatus,
      formatTicketMode,
      shouldShowTicketModeBadge,
      formatTime,
      formatBadgeCount,
      highlightText,
      getContactName,
      getPhoneNode,
      getTicketPreview,
      getAssignedLabel,
      getQueueLabel,
      getTicketDisplayId,
      getModeLabel,
      getDeliveryStatusBadge,
      renderTimelineMessageContent,
      supportGridColumns,
    },
    ticketActions: {
      handoverLoading,
      deliveryFailuresLoading,
      showDeliveryFailuresModal,
      setShowDeliveryFailuresModal,
      deliveryFailures,
      handleAssign,
      handleTakeOver,
      handleReturnToBot,
      handlePause,
      handleResume,
      openDeliveryFailures,
    },
    responseComposer: {
      quickReplySelectedCategory,
      setQuickReplySelectedCategory,
      quickReplyCategories,
      quickReplyCategoryItems,
      quickReplySuggestions,
      quickReplySlashOpen,
      quickReplySlashResults,
      slashMenuMode,
      slashCommandResults,
      slashMenuCursorIndex,
      onSelectSlashItem,
      onHoverSlashItem,
      onComposerKeyDown,
      insertQuickReply,
      handleClose,
    },
    newConversation: {
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
    },
    closeFlow: {
      showCloseModal,
      closing,
      closeReasons,
      selectedCloseReasonId,
      setSelectedCloseReasonId,
      selectedCloseReasonName,
      setSelectedCloseReasonName,
      closeTagsInput,
      setCloseTagsInput,
      handleConfirmClose,
      closeCloseModal,
    },
    deliveryModal: {
      showToast,
      showToastRef,
    },
  };
}
