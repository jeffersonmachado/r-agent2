import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listAllTickets,
  assignTicket,
  closeTicket,
  sendTicketMessage,
  getTicketMessages,
  markTicketAsRead,
  createTicket,
  takeOverTicket,
  returnToBotTicket,
  getTicketAiSummary,
  generateTicketAiSummary,
} from '../api/tickets';
import { listQuickReplies, searchQuickReplies, useQuickReply } from '../api/quickReplies';
import { listCloseReasons } from '../api/closeReasons';
import { addTagToTicket, removeTagFromTicket, getAllTags } from '../api/segmentation';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useDebounce } from '../hooks/useDebounce';
import websocketMetrics from '../utils/websocketMetrics';
import logger from '../utils/logger';

/**
 * Página de atendimento para gerenciar tickets.
 * Mostra apenas tickets do usuário logado ou sem atribuição.
 * Estilo inspirado no WhatsApp.
 */
export function SupportPage() {
  const { agent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Estados - devem ser declarados antes de qualquer early return
  const [queues, setQueues] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  // Auto-refresh sempre ativo quando WebSocket não está disponível
  const autoRefresh = true;
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [newConversationPhone, setNewConversationPhone] = useState('');
  const [newConversationMessage, setNewConversationMessage] = useState('');
  const [newConversationQueue, setNewConversationQueue] = useState('');
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [quickReplySuggestions, setQuickReplySuggestions] = useState([]);
  const [quickReplySlashResults, setQuickReplySlashResults] = useState([]);
  const [quickReplySlashOpen, setQuickReplySlashOpen] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingTicketId, setClosingTicketId] = useState(null);
  const [closeReasons, setCloseReasons] = useState([]);
  const [selectedCloseReasonId, setSelectedCloseReasonId] = useState('');
  const [selectedCloseReasonName, setSelectedCloseReasonName] = useState('');
  const [closing, setClosing] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [knownTags, setKnownTags] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const applyTemplateVariables = useCallback((text, variables) => {
    if (!text) return '';
    const vars = (variables && typeof variables === 'object') ? variables : {};
    return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
      const v = vars[key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
      try { return JSON.stringify(v); } catch { return String(v); }
    });
  }, []);

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  // Usa useRef para manter referências estáveis
  const showToastRef = React.useRef(showToast);
  const loadTicketsRef = React.useRef();

  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Debounce para loadTickets - agrupa múltiplos eventos WebSocket
  // DEVE ser definido ANTES de handleWebSocketEvent para evitar erro de inicialização
  const { debouncedFn: debouncedLoadTickets } = useDebounce(() => {
    if (loadTicketsRef.current) {
      loadTicketsRef.current();
    }
  }, 500); // 500ms de debounce

  // Debounce para quick replies via "/atalho"
  const { debouncedFn: debouncedSearchSlashQuickReplies } = useDebounce(() => {
    const txt = (messageText || '').trim();
    if (!txt.startsWith('/') || txt.length < 2) {
      setQuickReplySlashOpen(false);
      setQuickReplySlashResults([]);
      return;
    }
    const q = txt.slice(1);
    listQuickReplies({ search: q, activeOnly: true })
      .then((resp) => {
        const list = resp?.quickReplies || [];
        setQuickReplySlashResults(list.slice(0, 8));
        setQuickReplySlashOpen(true);
      })
      .catch(() => {
        setQuickReplySlashOpen(false);
        setQuickReplySlashResults([]);
      });
  }, 250);

  // WebSocket para atualizações em tempo real
  const handleWebSocketEvent = useCallback((event, data) => {
    logger.debug('[SupportPage] Evento WebSocket recebido', event, data);
    
    // Registra métrica de evento WebSocket
    websocketMetrics.recordWebSocketEvent(event);
    
    // Função auxiliar para atualizar ticket na lista local sem requisição HTTP
    const updateTicketInList = (ticket) => {
      if (!ticket) return;
      
      setTickets(prevTickets => {
        const existingIndex = prevTickets.findIndex(t => t.id === ticket.id);
        const newTickets = [...prevTickets];
        
        // Filtra apenas tickets waiting ou in_progress que o agente pode ver
        const shouldShow = (ticket.status === 'waiting' || ticket.status === 'in_progress') &&
          (!ticket.assignedTo || ticket.assignedTo === agent?.id || ticket.assignedTo === agent?.username);
        
        if (existingIndex >= 0) {
          if (shouldShow) {
            // Atualiza ticket existente
            newTickets[existingIndex] = ticket;
          } else {
            // Remove se não deve mais ser exibido
            newTickets.splice(existingIndex, 1);
          }
        } else if (shouldShow) {
          // Adiciona novo ticket
          newTickets.push(ticket);
        }
        
        // Ordena por data de criação (mais recentes primeiro)
        newTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return newTickets;
      });
      
      // Atualiza ticket selecionado se for o mesmo
      setSelectedTicket(prevSelected => {
        if (prevSelected?.id === ticket.id) {
          return ticket;
        }
        return prevSelected;
      });
    };
    
    switch (event) {
      case 'ticket.created':
        // Novo ticket criado - atualiza lista local se tiver dados do ticket
        if (data.ticket) {
          updateTicketInList(data.ticket);
        } else {
          // Fallback: recarrega lista se não tiver dados do ticket
          debouncedLoadTickets();
        }
        // Se o ticket foi criado para este agente, mostra notificação
        if (data.agentId === agent?.id || !data.agentId) {
          showToastRef.current(`Novo ticket criado: ${data.ticketId?.slice(0, 8)}`, 'info', 3000);
        }
        break;
        
      case 'ticket.assigned':
        // Ticket atribuído - atualiza lista local se tiver dados do ticket
        if (data.ticket) {
          updateTicketInList(data.ticket);
        } else {
          // Fallback: recarrega lista se não tiver dados do ticket
          debouncedLoadTickets();
        }
        // Se foi atribuído para este agente, mostra notificação
        if (data.assignedTo === agent?.id || data.assignedTo === agent?.username) {
          showToastRef.current(`Ticket atribuído para você: ${data.ticketId?.slice(0, 8)}`, 'success', 3000);
        }
        break;
        
      case 'ticket.updated':
        // Ticket atualizado - atualiza lista local se tiver dados do ticket
        if (data.ticket) {
          updateTicketInList(data.ticket);
        } else {
          // Fallback: recarrega lista se não tiver dados do ticket
          debouncedLoadTickets();
        }
        // Atualiza mensagens se for o ticket selecionado
        if (selectedTicketIdRef.current === data.ticketId) {
          if (loadTicketMessagesRef.current) {
            loadTicketMessagesRef.current(data.ticketId);
          }
        }
        break;
        
      case 'ticket.closed':
        // Ticket fechado - remove da lista local
        setTickets(prevTickets => prevTickets.filter(t => t.id !== data.ticketId));
        if (selectedTicketIdRef.current === data.ticketId) {
          setSelectedTicket(null);
          setTicketMessages([]);
        }
        break;
        
      case 'ticket.message.received':
      case 'ticket.message.sent':
        // Nova mensagem - atualiza ticket na lista se tiver dados
        if (data.ticket) {
          updateTicketInList(data.ticket);
        }
        // Atualiza mensagens se for o ticket selecionado
        if (selectedTicketIdRef.current === data.ticketId) {
          if (loadTicketMessagesRef.current) {
            loadTicketMessagesRef.current(data.ticketId);
          }
          // Mostra notificação se não for o ticket atual em foco
          if (document.hidden || !document.hasFocus()) {
            showToastRef.current(`Nova mensagem no ticket ${data.ticketId?.slice(0, 8)}`, 'info', 3000);
          }
        } else if (!data.ticket) {
          // Fallback: atualiza contador de não lidas na lista apenas se não tiver dados do ticket
          debouncedLoadTickets();
        }
        break;
        
      default:
        logger.debug('[SupportPage] Evento WebSocket não tratado', event);
    }
  }, [agent, debouncedLoadTickets]);

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

  // Carrega filas disponíveis (apenas para o modal de nova conversa)
  const loadQueues = useCallback(async () => {
    try {
      const queuesList = await listQueues();
      setQueues(queuesList);
    } catch (error) {
      logger.error('Erro ao carregar filas', error);
      // Não mostra erro para o usuário, pois filas não são mais essenciais
    }
  }, []);

  // Sugestões automáticas de quick replies com base na última msg do usuário
  useEffect(() => {
    const context = selectedTicket?.lastUserMessage || '';
    if (!selectedTicket?.id || !context) {
      setQuickReplySuggestions([]);
      return;
    }
    searchQuickReplies(context, 5)
      .then((resp) => setQuickReplySuggestions(resp?.quickReplies || []))
      .catch(() => setQuickReplySuggestions([]));
  }, [selectedTicket?.id, selectedTicket?.lastUserMessage]);

  // Atualiza dropdown do "/atalho" conforme digita
  useEffect(() => {
    if (!selectedTicket || selectedTicket.status !== 'in_progress') return;
    debouncedSearchSlashQuickReplies();
  }, [messageText, selectedTicket?.id, selectedTicket?.status, debouncedSearchSlashQuickReplies]);

  const insertQuickReply = useCallback(async (reply) => {
    if (!reply) return;
    const variables = selectedTicket?.context?.variables || {};
    const rendered = applyTemplateVariables(reply.message || '', variables);

    setMessageText((prev) => {
      const p = (prev || '').trim();
      // Se estava usando "/atalho", substitui tudo pelo texto renderizado
      if (p.startsWith('/')) return rendered;
      return prev ? `${prev}\n${rendered}` : rendered;
    });

    setQuickReplySlashOpen(false);
    setQuickReplySlashResults([]);
    try { await useQuickReply(reply.id); } catch {}
  }, [applyTemplateVariables, selectedTicket]);

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

  useEffect(() => {
    // Best-effort: lista tags existentes para sugestão
    getAllTags()
      .then((resp) => setKnownTags((resp?.tags || []).map(t => t.tag || t).filter(Boolean)))
      .catch(() => setKnownTags([]));
  }, []);

  useEffect(() => {
    if (!selectedTicket?.id) {
      setAiSummary(null);
      return;
    }
    getTicketAiSummary(selectedTicket.id)
      .then((resp) => setAiSummary(resp?.summary || null))
      .catch(() => setAiSummary(null));
  }, [selectedTicket?.id]);

  const handleGenerateAiSummary = async () => {
    if (!selectedTicket?.id) return;
    setAiSummaryLoading(true);
    try {
      const resp = await generateTicketAiSummary(selectedTicket.id);
      setAiSummary(resp?.summary || null);
    } catch (err) {
      logger.error('Erro ao gerar resumo IA', err);
      showToast('Erro ao gerar resumo IA', 'error');
    } finally {
      setAiSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (!showCloseModal) return;
    listCloseReasons({ activeOnly: true })
      .then((resp) => setCloseReasons(resp?.closeReasons || []))
      .catch(() => setCloseReasons([]));
  }, [showCloseModal]);

  // Flag para evitar requisições duplicadas
  const isLoadingTicketsRef = React.useRef(false);
  // Timestamp do último erro mostrado para evitar spam de toasts
  const lastErrorToastTimeRef = React.useRef(0);
  const ERROR_TOAST_COOLDOWN = 30000; // 30 segundos entre erros

  // Carrega tickets do usuário ou sem atribuição
  const loadTickets = useCallback(async () => {
    // Evita requisições duplicadas
    if (isLoadingTicketsRef.current) {
      return;
    }
    
    isLoadingTicketsRef.current = true;
    setLoading(true);
    try {
      // Carrega tickets waiting e in_progress
      // A API já filtra automaticamente: agents só veem seus tickets ou sem atribuição
      const [waitingResult, inProgressResult] = await Promise.all([
        listAllTickets({ status: 'waiting', limit: 1000 }),
        listAllTickets({ status: 'in_progress', limit: 1000 }),
      ]);
      
      // Combina os tickets e remove duplicatas
      const allTickets = [...(waitingResult.tickets || []), ...(inProgressResult.tickets || [])];
      const uniqueTickets = Array.from(
        new Map(allTickets.map(ticket => [ticket.id, ticket])).values()
      );
      
      // Ordena por data de criação (mais recentes primeiro)
      uniqueTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      setTickets(uniqueTickets);
      
      // Verifica se o ticket selecionado ainda existe na nova lista
      // Se não existir mais, limpa a seleção e as mensagens
      setSelectedTicket(prevSelected => {
        if (!prevSelected) return null;
        const updatedTicket = uniqueTickets.find(t => t.id === prevSelected.id);
        // Se não encontrou na lista, o ticket foi removido ou mudou de status
        if (!updatedTicket) {
          setTicketMessages([]);
          return null;
        }
        // Atualiza com os dados mais recentes do ticket
        return updatedTicket;
      });
      
      // Reseta o contador de erro em caso de sucesso
      lastErrorToastTimeRef.current = 0;
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      
      // Só mostra toast se passou tempo suficiente desde o último erro
      const now = Date.now();
      if (now - lastErrorToastTimeRef.current > ERROR_TOAST_COOLDOWN) {
        lastErrorToastTimeRef.current = now;
        // Toast de erro com duração menor para não ficar muito tempo na tela
        showToastRef.current('Erro ao carregar tickets', 'error', 5000);
      }
    } finally {
      setLoading(false);
      isLoadingTicketsRef.current = false;
    }
  }, []); // Sem dependências - usa refs e state setters funcionais

  // Atualiza ref quando loadTickets muda
  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  // Flag para garantir que os dados iniciais sejam carregados apenas uma vez
  const hasLoadedInitialDataRef = React.useRef(false);

  // Carrega dados iniciais - apenas uma vez no mount
  useEffect(() => {
    // Evita carregar múltiplas vezes (especialmente com StrictMode)
    if (hasLoadedInitialDataRef.current) {
      return;
    }
    
    hasLoadedInitialDataRef.current = true;
    loadQueues();
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Apenas no mount inicial

  // Carrega mensagens do ticket selecionado
  const loadTicketMessages = useCallback(async (ticketId) => {
    if (!ticketId) {
      setTicketMessages([]);
      return;
    }

    try {
      const result = await getTicketMessages(ticketId);
      setTicketMessages(result.messages || []);
      
      // Marca como lidas se ticket está atribuído e em progresso
      setTickets(prevTickets => {
        const ticket = prevTickets.find(t => t.id === ticketId);
        if (ticket && ticket.status === 'in_progress' && ticket.unreadCount > 0) {
          markTicketAsRead(ticketId).catch(err => {
            logger.error('Erro ao marcar ticket como lido', err);
          });
          // Atualiza ticket na lista
          const updatedTickets = prevTickets.map(t => 
            t.id === ticketId ? { ...t, unreadCount: 0 } : t
          );
          // Atualiza ticket selecionado se for o mesmo
          setSelectedTicket(prevSelected => 
            prevSelected?.id === ticketId ? { ...prevSelected, unreadCount: 0 } : prevSelected
          );
          return updatedTickets;
        }
        return prevTickets;
      });
    } catch (error) {
      // Se for 404, o ticket não existe mais no backend - limpa seleção e remove da lista
      if (error.status === 404 || (error.body && error.body.error === 'ticket_not_found')) {
        // Remove o ticket da lista local também
        setTickets(prevTickets => prevTickets.filter(t => t.id !== ticketId));
        setSelectedTicket(null);
        setTicketMessages([]);
        return;
      }
      // Para outros erros, loga normalmente
      logger.error('Erro ao carregar mensagens', error);
    }
  }, []); // Sem dependências - usa state setters funcionais

  // Carrega mensagens quando ticket é selecionado
  useEffect(() => {
    if (selectedTicket) {
      loadTicketMessages(selectedTicket.id);
      
      // Preenche automaticamente o campo de atribuição se o ticket estiver waiting
      if (selectedTicket.status === 'waiting' && !assignedTo) {
        const defaultAssignee = agent?.username || agent?.id || '';
        if (defaultAssignee) {
          setAssignedTo(defaultAssignee);
        }
      }
    } else {
      setTicketMessages([]);
      setAssignedTo(''); // Limpa o campo quando nenhum ticket está selecionado
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicket?.id]); // Apenas quando o ID do ticket muda

  // Auto-refresh a cada 5 segundos - usa refs para evitar recriação do intervalo
  const selectedTicketIdRef = React.useRef(null);
  
  React.useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?.id || null;
  }, [selectedTicket?.id]);

  const loadTicketMessagesRef = React.useRef();
  React.useEffect(() => {
    loadTicketMessagesRef.current = loadTicketMessages;
  }, [loadTicketMessages]);

  // Ref para o container de mensagens para scroll automático
  const messagesContainerRef = React.useRef(null);

  // Scroll automático para o final quando novas mensagens são carregadas
  useEffect(() => {
    if (messagesContainerRef.current && ticketMessages.length > 0) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [ticketMessages]);

  // Atualiza métricas de status WebSocket
  useEffect(() => {
    websocketMetrics.setWebSocketStatus(wsConnected && wsAuthenticated);
  }, [wsConnected, wsAuthenticated]);

  // Polling removido - apenas WebSocket é usado para atualizações em tempo real
  // Se o WebSocket não estiver conectado, as atualizações só ocorrerão quando:
  // 1. O usuário recarregar a página manualmente
  // 2. O WebSocket se reconectar e enviar eventos
  // 3. O usuário clicar no botão "Atualizar"

  // Atribui ticket para atendente
  const handleAssign = async () => {
    if (!selectedTicket) {
      showToast('Selecione um ticket primeiro', 'warning');
      return;
    }

    // Usa o valor do campo ou o valor padrão do agente
    const assigneeName = assignedTo.trim() || agent?.username || agent?.id || '';
    
    if (!assigneeName) {
      showToast('Informe o nome do atendente', 'warning');
      return;
    }

    try {
      await assignTicket(selectedTicket.id, assigneeName);
      showToastRef.current('Ticket atribuído com sucesso', 'success');
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
  };

  // Fecha ticket
  const handleClose = async (ticketId) => {
    setClosingTicketId(ticketId);
    setSelectedCloseReasonId('');
    setSelectedCloseReasonName('');
    setShowCloseModal(true);
  };

  const handleConfirmClose = async () => {
    if (!closingTicketId) return;
    const confirmed = await confirm({
      title: 'Fechar Ticket',
      message: 'Deseja realmente fechar este ticket? Esta ação não pode ser desfeita.',
      confirmLabel: 'Fechar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });
    if (!confirmed) return;

    setClosing(true);
    try {
      await closeTicket(closingTicketId, {
        closeReasonId: selectedCloseReasonId || undefined,
        closeReasonName: selectedCloseReasonName || undefined,
      });
      showToastRef.current('Ticket fechado com sucesso', 'success');
      if (selectedTicket?.id === closingTicketId) {
        setSelectedTicket(null);
        setTicketMessages([]);
      }
      setShowCloseModal(false);
      setClosingTicketId(null);
      if (loadTicketsRef.current) loadTicketsRef.current();
    } catch (error) {
      logger.error('Erro ao fechar ticket', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao fechar ticket. Tente novamente.';
      showToast(errorMessage, 'error');
    } finally {
      setClosing(false);
    }
  };

  const handleAddTag = async () => {
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
  };

  const handleRemoveTag = async (tag) => {
    if (!selectedTicket) return;
    try {
      const updated = await removeTagFromTicket(selectedTicket.id, tag);
      updateTicketLocal(updated);
    } catch (error) {
      logger.error('Erro ao remover tag', error);
      showToast('Erro ao remover tag', 'error');
    }
  };

  // Envia mensagem do atendente
  const handleSendMessage = async () => {
    if (!selectedTicket || !messageText.trim()) {
      showToast('Digite uma mensagem', 'warning');
      return;
    }

    const messageToSend = messageText.trim();
    
    // Limpa o campo imediatamente para melhor UX
    setMessageText('');

    try {
      await sendTicketMessage(selectedTicket.id, messageToSend);
      showToastRef.current('Mensagem enviada com sucesso', 'success');
      
      // Recarrega mensagens para mostrar a nova mensagem
      await loadTicketMessages(selectedTicket.id);
      
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    } catch (error) {
      logger.error('Erro ao enviar mensagem', error);
      // Restaura a mensagem em caso de erro
      setMessageText(messageToSend);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao enviar mensagem. Verifique sua conexão e tente novamente.';
      showToast(errorMessage, 'error');
    }
  };

  // Handover: bot <-> humano
  const handleTakeOver = async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await takeOverTicket(selectedTicket.id, 'agent_takeover');
      showToastRef.current('Atendimento assumido (modo humano)', 'success', 2500);
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      if (loadTicketMessagesRef.current) {
        loadTicketMessagesRef.current(updated.id);
      }
    } catch (error) {
      logger.error('Erro ao assumir atendimento', error);
      showToast('Erro ao assumir atendimento', 'error');
    } finally {
      setHandoverLoading(false);
    }
  };

  const handleReturnToBot = async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await returnToBotTicket(selectedTicket.id, 'user_request');
      showToastRef.current('Atendimento devolvido ao bot (modo bot)', 'success', 2500);
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      if (loadTicketMessagesRef.current) {
        loadTicketMessagesRef.current(updated.id);
      }
    } catch (error) {
      logger.error('Erro ao devolver ao bot', error);
      showToast('Erro ao devolver ao bot', 'error');
    } finally {
      setHandoverLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  };

  const formatPhoneNumber = (phone) => {
    if (!phone) return '-';
    // Formata número brasileiro: 5511999999999 -> (11) 99999-9999
    if (phone.length === 13 && phone.startsWith('55')) {
      const ddd = phone.slice(2, 4);
      const part1 = phone.slice(4, 9);
      const part2 = phone.slice(9);
      return `+55 (${ddd}) ${part1}-${part2}`;
    }
    return phone;
  };

  const getStatusClass = (status) => {
    if (status === 'waiting') return 'waiting';
    if (status === 'in_progress') return 'in_progress';
    return 'closed';
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>💬 Atendimento</h1>
        </div>
        <div className="support-controls">
          {wsConnected && wsAuthenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span 
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#25D366',
                  animation: 'pulse 2s infinite'
                }}
                title="WebSocket conectado e autenticado - Atualizações em tempo real ativas"
              />
              <span style={{ fontSize: '14px', color: '#666' }}>
                Atualização em tempo real
              </span>
            </div>
          ) : wsConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span 
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#3b82f6',
                  animation: 'pulse 2s infinite'
                }}
                title="WebSocket conectado, autenticando..."
              />
              <span style={{ fontSize: '14px', color: '#666' }}>
                Autenticando...
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span 
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#f59e0b',
                }}
                title="WebSocket desconectado - Usando atualização automática a cada 5 segundos"
              />
              <span style={{ fontSize: '14px', color: '#666' }}>
                Atualização automática (5s)
              </span>
            </div>
          )}
          <Button 
            onClick={() => {
              if (loadTicketsRef.current) {
                loadTicketsRef.current();
              }
            }} 
            disabled={loading}
          >
            {loading ? 'Carregando...' : 'Atualizar'}
          </Button>
          <Button 
            onClick={() => {
              setNewConversationQueue(queues.length > 0 ? queues[0] : '');
              setShowNewConversationModal(true);
            }}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Iniciar Conversa
          </Button>
        </div>
      </div>

      <div className="support-grid">
        {/* Lista de Tickets */}
        <div className="support-tickets-panel">
          <h2>Meus Tickets</h2>
          {loading ? (
            <p>Carregando...</p>
          ) : tickets.length === 0 ? (
            <p className="support-tickets-empty">Nenhum ticket disponível</p>
          ) : (
            <div className="support-tickets-list" role="list">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  role="listitem"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedTicket(ticket);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedTicket(ticket);
                    }
                  }}
                  className={`support-ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                  aria-label={`Ticket ${ticket.id.slice(0, 12)}, ${ticket.status === 'waiting' ? 'Aguardando' : ticket.status === 'in_progress' ? 'Em atendimento' : 'Fechado'}, ${ticket.unreadCount > 0 ? `${ticket.unreadCount} mensagens não lidas` : ''}`}
                  aria-selected={selectedTicket?.id === ticket.id}
                >
                  <div className="support-ticket-header">
                    <span className="support-ticket-id">#{ticket.id.slice(0, 12)}</span>
                    <span className={`support-ticket-status ${getStatusClass(ticket.status)}`} aria-label={`Status: ${ticket.status}`}>
                      {ticket.status === 'waiting'
                        ? 'Aguardando'
                        : ticket.status === 'in_progress'
                          ? 'Em atendimento'
                          : 'Fechado'}
                    </span>
                  </div>
                  <div className="support-ticket-phone" aria-label={`Telefone: ${formatPhoneNumber(ticket.phoneNumber)}`}>
                    📞 {formatPhoneNumber(ticket.phoneNumber)}
                  </div>
                  {ticket.lastUserMessage && (
                    <div className="support-ticket-message">
                      <strong>Última mensagem:</strong> {ticket.lastUserMessage}
                    </div>
                  )}
                  <div className="support-ticket-meta">
                    Criado: {formatDate(ticket.createdAt)}
                  </div>
                  {ticket.assignedTo && (
                    <div className="support-ticket-assigned">
                      Atendente: {ticket.assignedTo}
                    </div>
                  )}
                  {ticket.unreadCount > 0 && (
                    <div
                      className="support-ticket-unread-badge"
                      role="status"
                      aria-label={`${ticket.unreadCount} mensagens não lidas`}
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        background: '#e74c3c',
                        color: 'white',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}
                    >
                      {ticket.unreadCount}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel de Detalhes e Ações */}
        <div className="support-details-panel">
          {selectedTicket ? (
            <>
              <div style={{ flexShrink: 0 }}>
                <h3 className="support-details-title">
                  Ticket #{selectedTicket.id.slice(0, 12)}
                  {selectedTicket.unreadCount > 0 && (
                    <span style={{
                      marginLeft: '10px',
                      background: '#e74c3c',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'normal'
                    }}>
                      {selectedTicket.unreadCount} nova(s)
                    </span>
                  )}
                </h3>
                <div className="support-details-info">
                  <div>Fila: <strong>{selectedTicket.queue}</strong></div>
                  <div>Telefone: <strong>{formatPhoneNumber(selectedTicket.phoneNumber)}</strong></div>
                  <div>Status: <strong>{selectedTicket.status}</strong></div>
                  <div>
                    Modo: <strong>{(selectedTicket.mode || 'human') === 'human' ? 'Humano' : 'Bot'}</strong>
                    {selectedTicket.pauseReason ? (
                      <span style={{ color: '#666' }}> • Motivo: {selectedTicket.pauseReason}</span>
                    ) : null}
                  </div>
                  {selectedTicket?.context?.closeReasonName ? (
                    <div>Último encerramento: <strong>{selectedTicket.context.closeReasonName}</strong></div>
                  ) : null}
                  {selectedTicket.conversationId ? (
                    <div>ConversationId: <strong>{selectedTicket.conversationId}</strong></div>
                  ) : null}
                  {selectedTicket.channelType ? (
                    <div>Canal: <strong>{selectedTicket.channelType}</strong></div>
                  ) : null}
                  <div>Criado: {formatDate(selectedTicket.createdAt)}</div>
                </div>

                {/* Tags */}
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px' }}>Tags</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    {(selectedTicket.tags || []).length === 0 ? (
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>Sem tags</span>
                    ) : (
                      (selectedTicket.tags || []).map((t) => (
                        <span
                          key={t}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 10px',
                            borderRadius: '999px',
                            border: '1px solid var(--color-border-default)',
                            background: 'var(--color-bg-secondary)',
                            fontSize: '12px',
                          }}
                        >
                          {t}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(t)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              color: 'var(--color-text-tertiary)',
                            }}
                            aria-label={`Remover tag ${t}`}
                            title="Remover"
                          >
                            ✕
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="Adicionar tag (ex: cobrança)"
                      className="support-form-input"
                      list="support-known-tags"
                    />
                    <datalist id="support-known-tags">
                      {knownTags.slice(0, 50).map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <Button onClick={handleAddTag} style={{ width: 'auto' }}>
                      Adicionar
                    </Button>
                  </div>
                </div>

                {/* Entidades/variáveis extraídas */}
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px' }}>Entidades extraídas</div>
                  {selectedTicket?.context?.variables && typeof selectedTicket.context.variables === 'object' && Object.keys(selectedTicket.context.variables).length > 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {Object.entries(selectedTicket.context.variables).slice(0, 12).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: '4px' }}>
                          <strong>{k}</strong>: {typeof v === 'string' ? v : JSON.stringify(v)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Nenhuma variável disponível</div>
                  )}
                </div>

                {/* Resumo IA */}
                <div style={{ marginTop: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <div style={{ fontWeight: 600 }}>Resumo IA</div>
                    <Button onClick={handleGenerateAiSummary} disabled={aiSummaryLoading} style={{ width: 'auto' }}>
                      {aiSummaryLoading ? 'Gerando...' : (aiSummary?.text ? 'Atualizar' : 'Gerar')}
                    </Button>
                  </div>
                  {aiSummary?.text ? (
                    <pre style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '12px',
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: '10px',
                      padding: '10px',
                      color: 'var(--color-text-primary)',
                    }}>
                      {aiSummary.text}
                    </pre>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                      Nenhum resumo ainda. Clique em “Gerar”.
                    </div>
                  )}
                  {aiSummary?.generatedAt ? (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                      Gerado em {formatDate(aiSummary.generatedAt)}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Handover Bot <-> Humano */}
              <div style={{ flexShrink: 0, display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                {(selectedTicket.mode || 'human') === 'bot' ? (
                  <Button onClick={handleTakeOver} disabled={handoverLoading} className="support-button-full">
                    Assumir atendimento
                  </Button>
                ) : (
                  <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-button-full">
                    Devolver ao bot
                  </Button>
                )}
              </div>

              {/* Histórico de handover (últimos 5) */}
              {Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 && (
                <div style={{ marginBottom: '10px', fontSize: '12px', color: '#555' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Histórico de handover</div>
                  {selectedTicket.context.handoverHistory.slice(-5).map((h, idx) => (
                    <div key={`${h.timestamp}-${idx}`}>
                      {formatDate(h.timestamp)} • {h.mode === 'human' ? 'Humano' : 'Bot'}
                      {h.actorUsername ? ` • ${h.actorUsername}` : ''}
                      {h.reason ? ` • ${h.reason}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {/* Histórico de Mensagens */}
              {selectedTicket.status === 'in_progress' && (
                <div style={{
                  marginTop: '20px',
                  marginBottom: '20px',
                  borderTop: '1px solid #ddd',
                  paddingTop: '20px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0
                }}>
                  <h4 style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>
                    Histórico de Mensagens
                  </h4>
                  <div
                    ref={messagesContainerRef}
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      padding: '10px',
                      backgroundColor: '#f9f9f9',
                      minHeight: 0
                    }}
                    role="log"
                    aria-label="Histórico de mensagens do ticket"
                  >
                    {ticketMessages.length === 0 ? (
                      <p style={{ color: '#999', fontSize: '12px', textAlign: 'center' }}>
                        Nenhuma mensagem ainda
                      </p>
                    ) : (
                      ticketMessages.map((msg) => (
                        <div
                          key={msg.id}
                          style={{
                            marginBottom: '12px',
                            padding: '8px',
                            borderRadius: '8px',
                            backgroundColor: msg.sender === 'user' ? '#dcf8c6' : '#ffffff',
                            border: msg.sender === 'user' ? 'none' : '1px solid #ddd',
                            textAlign: msg.sender === 'user' ? 'right' : 'left',
                          }}
                        >
                          <div style={{
                            fontSize: '12px',
                            color: '#666',
                            marginBottom: '4px'
                          }}>
                            {msg.sender === 'user' ? '👤 Usuário' : msg.sender === 'agent' ? '👨‍💼 Atendente' : '🤖 Sistema'}
                            {' • '}
                            {formatDate(msg.timestamp)}
                          </div>
                          <div style={{ fontSize: '14px', wordBreak: 'break-word' }}>
                            {msg.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {selectedTicket.status === 'waiting' && (
                  <div className="support-form-group">
                    <label htmlFor="assign-ticket-input" className="support-form-label">
                      Atribuir para:
                    </label>
                    <input
                      id="assign-ticket-input"
                      type="text"
                      value={assignedTo || (agent?.username || agent?.id || '')}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      placeholder="Nome do atendente"
                      className="support-form-input"
                      aria-label="Nome do atendente para atribuir o ticket"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAssign();
                        }
                      }}
                    />
                    <Button onClick={handleAssign} className="support-button-full">
                      Atribuir Ticket
                    </Button>
                  </div>
                )}

                {selectedTicket.status === 'in_progress' && (
                  <div className="support-form-group">
                    <label htmlFor="send-message-textarea" className="support-form-label">
                      Enviar mensagem:
                    </label>
                    {(quickReplySuggestions.length > 0) && (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
                          Sugestões (Respostas Rápidas)
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {quickReplySuggestions.map((qr) => (
                            <button
                              key={qr.id}
                              type="button"
                              onClick={() => insertQuickReply(qr)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '999px',
                                border: '1px solid var(--color-border-default)',
                                background: 'var(--color-bg-secondary)',
                                color: 'var(--color-text-primary)',
                                cursor: 'pointer',
                                fontSize: '12px',
                              }}
                              title={qr.message}
                            >
                              {qr.title}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                          Dica: digite <code>/</code> + palavra (ex: <code>/saudação</code>)
                        </div>
                      </div>
                    )}

                    <textarea
                      id="send-message-textarea"
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      placeholder="Digite sua mensagem..."
                      rows={4}
                      className="support-form-textarea"
                      aria-label="Campo para digitar mensagem"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    {quickReplySlashOpen && quickReplySlashResults.length > 0 && (
                      <div
                        style={{
                          marginTop: '8px',
                          border: '1px solid var(--color-border-default)',
                          borderRadius: '10px',
                          background: 'var(--color-bg-elevated)',
                          padding: '8px',
                          maxHeight: '220px',
                          overflow: 'auto',
                        }}
                      >
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
                          Resultados para <code>{(messageText || '').trim()}</code>
                        </div>
                        {quickReplySlashResults.map((qr) => (
                          <div
                            key={qr.id}
                            style={{
                              padding: '8px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                            }}
                            onClick={() => insertQuickReply(qr)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') insertQuickReply(qr);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>
                              {qr.title}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                              {String(qr.message || '').slice(0, 120)}{String(qr.message || '').length > 120 ? '…' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button onClick={handleSendMessage} className="support-button-full">
                      Enviar Mensagem
                    </Button>
                    <small style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
                      Pressione Ctrl+Enter (ou Cmd+Enter no Mac) para enviar
                    </small>
                  </div>
                )}

                <Button
                  onClick={() => handleClose(selectedTicket.id)}
                  className="support-button-danger"
                  aria-label="Fechar ticket"
                >
                  Fechar Ticket
                </Button>
              </div>
            </>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um ticket para ver detalhes e ações</p>
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
      <ConfirmDialog />

      {/* Modal de Encerramento com Motivo */}
      {showCloseModal && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-ticket-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !closing) {
              setShowCloseModal(false);
              setClosingTicketId(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !closing) {
              setShowCloseModal(false);
              setClosingTicketId(null);
            }
          }}
        >
          <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="close-ticket-title" style={{ marginTop: 0 }}>
              Encerrar Ticket
            </h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Motivo de encerramento (opcional)
              </label>
              <select
                value={selectedCloseReasonId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCloseReasonId(id);
                  const found = closeReasons.find((r) => r.id === id);
                  setSelectedCloseReasonName(found?.name || '');
                }}
                className="support-form-select"
              >
                <option value="">Selecione...</option>
                {closeReasons.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                  Ou digite um motivo
                </label>
                <input
                  type="text"
                  value={selectedCloseReasonName}
                  onChange={(e) => {
                    setSelectedCloseReasonName(e.target.value);
                    setSelectedCloseReasonId('');
                  }}
                  placeholder="Ex: resolvido, sem resposta do cliente..."
                  className="support-form-input"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => {
                  if (closing) return;
                  setShowCloseModal(false);
                  setClosingTicketId(null);
                }}
                style={{ background: 'var(--color-bg-secondary)' }}
                disabled={closing}
              >
                Cancelar
              </Button>
              <Button onClick={handleConfirmClose} className="support-button-danger" disabled={closing}>
                {closing ? 'Fechando...' : 'Fechar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Iniciar Nova Conversa */}
      {showNewConversationModal && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-conversation-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowNewConversationModal(false);
              setNewConversationPhone('');
              setNewConversationMessage('');
              setNewConversationQueue('');
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowNewConversationModal(false);
              setNewConversationPhone('');
              setNewConversationMessage('');
              setNewConversationQueue('');
            }
          }}
        >
          <div
            className="support-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-conversation-title" style={{ marginTop: 0 }}>
              Iniciar Nova Conversa
            </h2>
            
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="new-conversation-phone"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
              >
                Número de Telefone *
              </label>
              <input
                id="new-conversation-phone"
                type="tel"
                value={newConversationPhone}
                onChange={(e) => setNewConversationPhone(e.target.value)}
                placeholder="+5511999999999 ou 5511999999999"
                className="support-form-input"
                aria-required="true"
                aria-describedby="phone-format-hint"
                autoFocus
              />
              <small id="phone-format-hint" style={{ color: '#666', fontSize: '12px' }}>
                Formato: +5511999999999 ou 5511999999999
              </small>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="new-conversation-queue"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
              >
                Fila *
              </label>
              <select
                id="new-conversation-queue"
                value={newConversationQueue}
                onChange={(e) => setNewConversationQueue(e.target.value)}
                className="support-form-select"
                aria-required="true"
              >
                <option value="">Selecione uma fila</option>
                {queues.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="new-conversation-message"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
              >
                Mensagem Inicial (opcional)
              </label>
              <textarea
                id="new-conversation-message"
                value={newConversationMessage}
                onChange={(e) => setNewConversationMessage(e.target.value)}
                placeholder="Olá! Como posso ajudá-lo hoje?"
                rows={4}
                className="support-form-textarea"
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => {
                  setShowNewConversationModal(false);
                  setNewConversationPhone('');
                  setNewConversationMessage('');
                  setNewConversationQueue('');
                }}
                style={{ backgroundColor: '#6c757d' }}
                aria-label="Cancelar criação de nova conversa"
              >
                Cancelar
              </Button>
              <Button
                onClick={async () => {
                  if (!newConversationPhone.trim()) {
                    showToast('Número de telefone é obrigatório', 'warning');
                    return;
                  }
                  if (!newConversationQueue.trim()) {
                    showToast('Fila é obrigatória', 'warning');
                    return;
                  }

                  try {
                    const ticket = await createTicket({
                      phoneNumber: newConversationPhone.trim(),
                      queue: newConversationQueue.trim(),
                      initialMessage: newConversationMessage.trim() || undefined,
                    });

                    showToast('Conversa iniciada com sucesso!', 'success');
                    setShowNewConversationModal(false);
                    setNewConversationPhone('');
                    setNewConversationMessage('');
                    setNewConversationQueue('');

                    // Recarrega tickets
                    if (loadTicketsRef.current) {
                      loadTicketsRef.current();
                    }

                    // Seleciona o ticket criado
                    setSelectedTicket(ticket);
                  } catch (error) {
                    logger.error('Erro ao iniciar conversa', error);
                    const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao iniciar conversa';
                    showToast(errorMessage, 'error');
                  }
                }}
                style={{ backgroundColor: '#25D366', color: 'white' }}
                aria-label="Iniciar nova conversa"
              >
                Iniciar Conversa
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
