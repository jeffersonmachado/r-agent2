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
  pauseTicket,
  resumeTicket,
  getTicketDeliveryFailures,
  getTicketAiSummary,
  generateTicketAiSummary,
} from '../api/tickets';
import { getConversationMessages } from '../api/conversations';
import { listQuickReplies, searchQuickReplies, useQuickReply, getCategories as getQuickReplyCategories } from '../api/quickReplies';
import { listCloseReasons } from '../api/closeReasons';
import { addTagToTicket, removeTagFromTicket, getAllTags } from '../api/segmentation';
import { queryAuditLogs } from '../api/audit';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useDebounce } from '../hooks/useDebounce';
import { usePhoneMasking } from '../hooks/usePhoneMasking';
import { MaskedPhone } from '../components/MaskedPhone';
import { CrudPageBase } from '../modules/crud-base';
import {
  SupportWorkspaceHeader,
  SupportFiltersBar,
  SupportTicketList,
  SupportConversationPane,
  SupportDetailsSidebar,
} from '../modules/support-workspace/components';
import websocketMetrics from '../utils/websocketMetrics';
import logger from '../utils/logger';
import { SupportDeliveryFailuresModal } from './support/SupportDeliveryFailuresModal';
import { SupportCloseTicketModal } from './support/SupportCloseTicketModal';
import { SupportNewConversationModal } from './support/SupportNewConversationModal';

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
  const [uiSearch, setUiSearch] = useState('');
  const [uiQueue, setUiQueue] = useState('');
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
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
  const [quickReplyCategories, setQuickReplyCategories] = useState([]);
  const [quickReplySelectedCategory, setQuickReplySelectedCategory] = useState('');
  const [quickReplyCategoryItems, setQuickReplyCategoryItems] = useState([]);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingTicketId, setClosingTicketId] = useState(null);
  const [closeReasons, setCloseReasons] = useState([]);
  const [selectedCloseReasonId, setSelectedCloseReasonId] = useState('');
  const [selectedCloseReasonName, setSelectedCloseReasonName] = useState('');
  const [closeTagsInput, setCloseTagsInput] = useState('');
  const [closing, setClosing] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [knownTags, setKnownTags] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [timelineMessages, setTimelineMessages] = useState([]);
  const [ticketEvents, setTicketEvents] = useState([]);
  const [ticketAuditLogs, setTicketAuditLogs] = useState([]);
  const [ticketAuditLoading, setTicketAuditLoading] = useState(false);
  const [showDeliveryFailuresModal, setShowDeliveryFailuresModal] = useState(false);
  const [deliveryFailuresLoading, setDeliveryFailuresLoading] = useState(false);
  const [deliveryFailures, setDeliveryFailures] = useState({ outboundQueue: [], channelMessages: [] });
  const { enabled: phoneMaskingEnabled } = usePhoneMasking();

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
      <CrudPageBase title="💬 Atendimento" hideHeader>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
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
    listQuickReplies({ search: q, activeOnly: true, category: quickReplySelectedCategory || undefined })
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

  // UI: status do WebSocket (mostra imediatamente ao carregar a página)
  const [wsUiStatus, setWsUiStatus] = useState({ phase: 'connecting' }); // connecting | auth | ready | disconnected
  useEffect(() => {
    let timeoutId = null;

    if (wsConnected && wsAuthenticated) {
      setWsUiStatus({ phase: 'ready' });
      return () => {};
    }

    if (wsConnected && !wsAuthenticated) {
      setWsUiStatus({ phase: 'auth' });
      return () => {};
    }

    // Não conectado: mostra "Conectando..." por um curto período e depois "Desconectado"
    setWsUiStatus({ phase: 'connecting' });
    timeoutId = setTimeout(() => {
      setWsUiStatus({ phase: 'disconnected' });
    }, 1500);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [wsConnected, wsAuthenticated]);

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
    const baseVars = selectedTicket?.context?.variables || {};
    const variables = {
      ...baseVars,
      ticketId: selectedTicket?.id || '',
      telefone: selectedTicket?.phoneNumber || '',
      fila: selectedTicket?.queue || '',
    };
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

  useEffect(() => {
    // Carrega categorias (best-effort) para quick replies
    // (para o operador filtrar por categoria no console)
    getQuickReplyCategories()
      .then((resp) => setQuickReplyCategories(resp?.categories || []))
      .catch(() => setQuickReplyCategories([]));
  }, []);

  useEffect(() => {
    if (!selectedTicket || selectedTicket.status !== 'in_progress') {
      setQuickReplyCategoryItems([]);
      return;
    }
    // Carrega quick replies da categoria escolhida (best-effort)
    listQuickReplies({
      category: quickReplySelectedCategory || undefined,
      activeOnly: true,
    })
      .then((resp) => setQuickReplyCategoryItems((resp?.quickReplies || []).slice(0, 12)))
      .catch(() => setQuickReplyCategoryItems([]));
  }, [selectedTicket?.id, selectedTicket?.status, quickReplySelectedCategory]);

  useEffect(() => {
    // Auditoria do ticket (visível no console)
    if (!selectedTicket?.id) {
      setTicketAuditLogs([]);
      return;
    }
    setTicketAuditLoading(true);
    queryAuditLogs({ resource: 'ticket', resourceId: selectedTicket.id, limit: 50, offset: 0 })
      .then((resp) => setTicketAuditLogs(resp?.items || resp?.logs || []))
      .catch(() => setTicketAuditLogs([]))
      .finally(() => setTicketAuditLoading(false));
  }, [selectedTicket?.id]);

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

  function safeGetBodyText(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (typeof body.text === 'string') return body.text;
    if (typeof body.caption === 'string') return body.caption;
    if (body.text && typeof body.text === 'object' && typeof body.text.body === 'string') return body.text.body;
    // WhatsApp: caption pode vir em body.image.caption / body.document.caption / etc.
    if (body.image && typeof body.image === 'object' && typeof body.image.caption === 'string') return body.image.caption;
    if (body.document && typeof body.document === 'object' && typeof body.document.caption === 'string') return body.document.caption;
    if (body.video && typeof body.video === 'object' && typeof body.video.caption === 'string') return body.video.caption;
    return '';
  }

  function safeStringify(obj, maxLen = 2000) {
    try {
      const s = JSON.stringify(obj, null, 2);
      if (typeof s !== 'string') return '';
      return s.length > maxLen ? `${s.slice(0, maxLen)}\n…` : s;
    } catch {
      return '';
    }
  }

  function summarizeChannelMessage(channelMsg) {
    const type = String(channelMsg?.type || '').toLowerCase();
    const body = channelMsg?.body || {};
    const text = safeGetBodyText(body);
    if (text) return text;

    if (type === 'image') return '[imagem]';
    if (type === 'audio' || type === 'voice') return '[áudio]';
    if (type === 'video') return '[vídeo]';
    if (type === 'document') return '[documento]';
    if (type === 'sticker') return '[sticker]';
    if (type === 'location') return '[localização]';
    if (type === 'contacts') return '[contatos]';
    if (type === 'interactive') return '[interativo]';
    if (type) return `[${type}]`;

    try {
      const s = JSON.stringify(body);
      return s.length > 280 ? `${s.slice(0, 280)}…` : s;
    } catch {
      return '[mensagem]';
    }
  }

  function renderTimelineMessageContent(msg) {
    if (!msg || msg.source !== 'channel' || !msg.channel) {
      return <>{msg?.text}</>;
    }

    const cm = msg.channel;
    const type = String(cm?.type || '').toLowerCase();
    const body = cm?.body || {};
    const text = safeGetBodyText(body);

    const commonMeta = (() => {
      // Instagram: attachments normalmente têm payload.url
      if (Array.isArray(body.attachments) && body.attachments[0]?.payload?.url) {
        return { url: String(body.attachments[0].payload.url) };
      }
      // Outbound Instagram que persistimos: body.url
      if (typeof body.url === 'string') return { url: body.url };
      return {};
    })();

    if (type === 'text') {
      return <>{text}</>;
    }

    if (type === 'interactive') {
      const interactive = body.interactive || body.raw?.interactive || {};
      const buttonTitle = interactive?.button_reply?.title || null;
      const listTitle = interactive?.list_reply?.title || null;
      const chosen = buttonTitle || listTitle;

      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
            Interativo
          </div>
          {chosen ? (
            <div style={{ marginBottom: '6px' }}>
              Resposta: <strong>{String(chosen)}</strong>
            </div>
          ) : null}
          <details style={{ marginTop: '6px' }}>
            <summary style={{ cursor: 'pointer', color: '#555' }}>Ver payload</summary>
            <pre style={{ marginTop: '8px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
              {safeStringify(interactive || body, 3000) || '[sem payload]'}
            </pre>
          </details>
        </div>
      );
    }

    if (type === 'image') {
      const image = body.image || body.raw?.image || {};
      const caption = safeGetBodyText(body) || '';
      const url = commonMeta.url || image?.link || null;
      const mime = image?.mime_type || null;
      const id = image?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Imagem</div>
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {url ? (
            <div style={{ marginTop: '6px' }}>
              <a href={url} target="_blank" rel="noreferrer">Abrir imagem</a>
              <div style={{ marginTop: '8px' }}>
                <img src={url} alt={caption || 'imagem'} style={{ maxWidth: '260px', borderRadius: '8px', border: '1px solid #eee' }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#666' }}>
              {mime ? <span>{String(mime)}</span> : null}
              {mime && id ? <span> • </span> : null}
              {id ? <span>media_id: <code>{String(id)}</code></span> : null}
            </div>
          )}
        </div>
      );
    }

    if (type === 'document') {
      const doc = body.document || body.raw?.document || {};
      const caption = safeGetBodyText(body) || '';
      const url = commonMeta.url || doc?.link || null;
      const filename = doc?.filename || null;
      const mime = doc?.mime_type || null;
      const id = doc?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Documento</div>
          {filename ? <div style={{ marginBottom: '4px' }}><strong>{String(filename)}</strong></div> : null}
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">Abrir documento</a>
          ) : (
            <div style={{ fontSize: '12px', color: '#666' }}>
              {mime ? <span>{String(mime)}</span> : null}
              {mime && id ? <span> • </span> : null}
              {id ? <span>media_id: <code>{String(id)}</code></span> : null}
            </div>
          )}
        </div>
      );
    }

    if (type === 'audio' || type === 'voice') {
      const audio = body.audio || body.raw?.audio || {};
      const url = commonMeta.url || audio?.link || null;
      const mime = audio?.mime_type || null;
      const id = audio?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Áudio</div>
          {url ? (
            <div>
              <a href={url} target="_blank" rel="noreferrer">Abrir áudio</a>
              <div style={{ marginTop: '8px' }}>
                <audio controls src={url} style={{ width: '260px' }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#666' }}>
              {mime ? <span>{String(mime)}</span> : null}
              {mime && id ? <span> • </span> : null}
              {id ? <span>media_id: <code>{String(id)}</code></span> : null}
            </div>
          )}
        </div>
      );
    }

    if (type === 'video') {
      const video = body.video || body.raw?.video || {};
      const caption = safeGetBodyText(body) || '';
      const url = commonMeta.url || video?.link || null;
      const mime = video?.mime_type || null;
      const id = video?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Vídeo</div>
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {url ? (
            <div>
              <a href={url} target="_blank" rel="noreferrer">Abrir vídeo</a>
              <div style={{ marginTop: '8px' }}>
                <video controls src={url} style={{ maxWidth: '260px', borderRadius: '8px' }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#666' }}>
              {mime ? <span>{String(mime)}</span> : null}
              {mime && id ? <span> • </span> : null}
              {id ? <span>media_id: <code>{String(id)}</code></span> : null}
            </div>
          )}
        </div>
      );
    }

    // Fallback: mostra texto resumido e payload em detalhes
    return (
      <div>
        <div style={{ marginBottom: '6px' }}>{msg.text}</div>
        <details>
          <summary style={{ cursor: 'pointer', color: '#555' }}>Ver payload</summary>
          <pre style={{ marginTop: '8px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
            {safeStringify(body, 3000) || '[sem payload]'}
          </pre>
        </details>
      </div>
    );
  }

  function buildTimelineMessages(ticketMsgs = [], channelMsgs = []) {
    const byExternal = new Map();
    const items = [];

    const pushItem = (it) => {
      items.push(it);
      if (it.externalMessageId) byExternal.set(it.externalMessageId, it);
    };

    for (const m of (Array.isArray(ticketMsgs) ? ticketMsgs : [])) {
      pushItem({
        key: `t:${m?.id || Math.random().toString(36).slice(2)}`,
        source: 'ticket',
        sender: m?.sender || 'system',
        text: m?.text || '',
        timestamp: m?.timestamp || null,
        externalMessageId: m?.externalMessageId || null,
        deliveryStatus: m?.deliveryStatus || null,
        raw: m,
      });
    }

    for (const cm of (Array.isArray(channelMsgs) ? channelMsgs : [])) {
      const ext = cm?.externalMessageId || null;
      const existing = ext ? byExternal.get(ext) : null;
      const normalizedSender = (cm?.direction === 'in')
        ? 'user'
        : (cm?.direction === 'out' ? 'agent' : 'system');

      if (existing) {
        existing.channel = cm;
        if (!existing.deliveryStatus && cm?.status) existing.deliveryStatus = cm.status;
        if ((!existing.text || existing.text === '') && (cm?.type || cm?.body)) {
          existing.text = summarizeChannelMessage(cm);
        }
        continue;
      }

      pushItem({
        key: `c:${cm?.id || ext || Math.random().toString(36).slice(2)}`,
        source: 'channel',
        sender: normalizedSender,
        text: summarizeChannelMessage(cm),
        timestamp: cm?.createdAt || null,
        externalMessageId: ext,
        deliveryStatus: cm?.status || null,
        channel: cm,
        raw: cm,
      });
    }

    items.sort((a, b) => {
      const ta = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return String(a.key).localeCompare(String(b.key));
    });

    return items;
  }

  // Carrega mensagens do ticket selecionado
  const loadTicketMessages = useCallback(async (ticketId, conversationId) => {
    if (!ticketId) {
      setTicketMessages([]);
      setConversationMessages([]);
      setTimelineMessages([]);
      setTicketEvents([]);
      return;
    }

    try {
      const result = await getTicketMessages(ticketId);
      setTicketMessages(result.messages || []);
      setTicketEvents(Array.isArray(result?.events) ? result.events : []);

      let convMsgs = [];
      if (conversationId) {
        try {
          const convResult = await getConversationMessages(conversationId, { limit: 300, offset: 0 });
          convMsgs = convResult?.messages || [];
          setConversationMessages(convMsgs);
        } catch (err) {
          logger.error('Erro ao carregar mensagens omnichannel (channels)', err);
          setConversationMessages([]);
          convMsgs = [];
        }
      } else {
        setConversationMessages([]);
      }

      setTimelineMessages(buildTimelineMessages(result.messages || [], convMsgs));
      
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

  const extractedEntities = React.useMemo(() => {
    const texts = [];
    for (const m of (Array.isArray(timelineMessages) ? timelineMessages : [])) {
      if (!m) continue;
      if (typeof m.text === 'string' && m.text.trim()) texts.push(m.text);
      const bodyText = m?.channel?.body?.text;
      if (typeof bodyText === 'string' && bodyText.trim()) texts.push(bodyText);
    }
    const blob = texts.join('\n');
    if (!blob) return { emails: [], cpfs: [], cnpjs: [], phones: [], urls: [] };

    const emails = Array.from(new Set((blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(s => s.toLowerCase()))).slice(0, 10);
    const urls = Array.from(new Set((blob.match(/https?:\/\/[^\s)]+/gi) || []))).slice(0, 10);
    const cpfs = Array.from(new Set((blob.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || []).map(s => s.replace(/\D/g, '')))).slice(0, 10);
    const cnpjs = Array.from(new Set((blob.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || []).map(s => s.replace(/\D/g, '')))).slice(0, 10);
    const phones = Array.from(new Set((blob.match(/\b\+?55\s*\(?\d{2}\)?\s*\d{4,5}-?\d{4}\b/g) || []).map(s => s.replace(/\s+/g, ' ').trim()))).slice(0, 10);

    return { emails, cpfs, cnpjs, phones, urls };
  }, [timelineMessages]);

  // Carrega mensagens quando ticket é selecionado
  useEffect(() => {
    if (selectedTicket) {
      loadTicketMessages(selectedTicket.id, selectedTicket.conversationId);
      
      // Preenche automaticamente o campo de atribuição se o ticket estiver waiting
      if (selectedTicket.status === 'waiting' && !assignedTo) {
        const defaultAssignee = agent?.username || agent?.id || '';
        if (defaultAssignee) {
          setAssignedTo(defaultAssignee);
        }
      }
    } else {
      setTicketMessages([]);
      setConversationMessages([]);
      setTimelineMessages([]);
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
    if (messagesContainerRef.current && timelineMessages.length > 0) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [timelineMessages]);

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
    setCloseTagsInput('');
    setShowCloseModal(true);
  };

  const handleConfirmClose = async () => {
    if (!closingTicketId) return;

    // Motivo obrigatório (Blip-like): usuário precisa selecionar ou digitar
    const hasReason = !!(String(selectedCloseReasonId || '').trim() || String(selectedCloseReasonName || '').trim());
    if (!hasReason) {
      showToast('Informe o motivo de encerramento', 'warning');
      return;
    }

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
      const tags = (closeTagsInput || '')
        .split(',')
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 20);

      await closeTicket(closingTicketId, {
        closeReasonId: selectedCloseReasonId || undefined,
        closeReasonName: selectedCloseReasonName || undefined,
        tags: tags.length > 0 ? tags : undefined,
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
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
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
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
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

  const handlePause = async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await pauseTicket(selectedTicket.id, 'outside_window');
      showToastRef.current('Atendimento pausado', 'success', 2500);
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
      if (loadTicketMessagesRef.current) {
        loadTicketMessagesRef.current(updated.id);
      }
    } catch (error) {
      logger.error('Erro ao pausar atendimento', error);
      showToast('Erro ao pausar atendimento', 'error');
    } finally {
      setHandoverLoading(false);
    }
  };

  const handleResume = async () => {
    if (!selectedTicket) return;
    setHandoverLoading(true);
    try {
      const updated = await resumeTicket(selectedTicket.id, 'resume');
      showToastRef.current('Atendimento retomado (modo humano)', 'success', 2500);
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
      if (loadTicketMessagesRef.current) {
        loadTicketMessagesRef.current(updated.id);
      }
    } catch (error) {
      logger.error('Erro ao retomar atendimento', error);
      showToast('Erro ao retomar atendimento', 'error');
    } finally {
      setHandoverLoading(false);
    }
  };

  const openDeliveryFailures = async () => {
    if (!selectedTicket) return;
    setShowDeliveryFailuresModal(true);
    setDeliveryFailuresLoading(true);
    try {
      const data = await getTicketDeliveryFailures(selectedTicket.id);
      setDeliveryFailures({
        outboundQueue: Array.isArray(data?.outboundQueue) ? data.outboundQueue : [],
        channelMessages: Array.isArray(data?.channelMessages) ? data.channelMessages : [],
      });
    } catch (err) {
      logger.error('Erro ao carregar falhas de entrega', err);
      showToast('Erro ao carregar falhas de entrega', 'error');
      setDeliveryFailures({ outboundQueue: [], channelMessages: [] });
    } finally {
      setDeliveryFailuresLoading(false);
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

  const getModeLabel = (mode) => {
    const m = (mode || 'bot');
    if (m === 'human') return { label: 'HUMANO', bg: '#fff7ed', fg: '#9a3412' };
    if (m === 'paused') return { label: 'PAUSADO', bg: '#f3f4f6', fg: '#374151' };
    return { label: 'BOT', bg: '#ecfdf5', fg: '#065f46' };
  };

  const getDeliveryStatusBadge = (deliveryStatusRaw) => {
    const s = deliveryStatusRaw ? String(deliveryStatusRaw).toLowerCase() : '';
    if (!s) return null;
    if (s === 'pending') return { text: '…', title: 'Pendente', color: '#6b7280' };
    if (s === 'sent') return { text: '✓', title: 'Enviado', color: '#6b7280' };
    if (s === 'delivered') return { text: '✓✓', title: 'Entregue', color: '#6b7280' };
    if (s === 'read') return { text: '✓✓', title: 'Lido', color: '#2563eb' };
    if (s === 'failed') return { text: '!', title: 'Falhou', color: '#b91c1c' };
    // fallback
    return { text: s, title: s, color: '#6b7280' };
  };

  const wsStatus = React.useMemo(() => {
    if (wsUiStatus.phase === 'ready') {
      return {
        label: 'Conectado',
        title: 'WebSocket conectado e autenticado - Atualizacoes em tempo real ativas',
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

  function getContactName(ticket) {
    return ticket?.contactName
      || ticket?.contact?.name
      || ticket?.context?.contactName
      || ticket?.context?.contact?.name
      || ticket?.phoneNumber
      || 'Sem contato';
  }

  function formatTicketStatus(status) {
    if (status === 'waiting') return 'Aguardando';
    if (status === 'in_progress') return 'Em atendimento';
    if (status === 'closed') return 'Fechado';
    return status || 'Desconhecido';
  }

  function formatTicketMode(mode) {
    return getModeLabel(mode).label;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatBadgeCount(count) {
    if (!count) return '0';
    if (count > 99) return '99+';
    return String(count);
  }

  function getPhoneNode(ticket) {
    return <MaskedPhone phone={ticket?.phoneNumber} mask={phoneMaskingEnabled} />;
  }

  function highlightText(text, searchTerm) {
    const rawText = String(text || '');
    const needle = String(searchTerm || '').trim();
    if (!needle) return rawText;
    const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedNeedle})`, 'ig');
    return rawText.split(regex).map((part, index) => (
      part.toLowerCase() === needle.toLowerCase()
        ? <mark key={`${part}-${index}`}>{part}</mark>
        : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    ));
  }

  function getTicketPreview(ticket, searchTerm) {
    const preview = ticket?.lastUserMessage || ticket?.lastMessage || 'Sem mensagens recentes';
    return highlightText(preview, searchTerm);
  }

  function getAssignedLabel(ticket) {
    return ticket?.assignedTo ? `Atendente: ${ticket.assignedTo}` : 'Sem responsavel';
  }

  function getQueueLabel(ticket) {
    return ticket?.queue ? `Fila: ${ticket.queue}` : 'Sem fila';
  }

  const uiSearchDebounced = String(uiSearch || '').trim();
  const ticketQueueOptions = React.useMemo(() => (
    Array.from(new Set((tickets || []).map((ticket) => ticket?.queue).filter(Boolean))).sort()
  ), [tickets]);

  const ticketsView = React.useMemo(() => {
    return (tickets || []).filter((ticket) => {
      if (uiQueue && ticket?.queue !== uiQueue) return false;
      if (!uiSearchDebounced) return true;
      const haystack = [
        ticket?.id,
        getContactName(ticket),
        ticket?.phoneNumber,
        ticket?.lastUserMessage,
        ticket?.assignedTo,
        ticket?.queue,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(uiSearchDebounced.toLowerCase());
    });
  }, [tickets, uiQueue, uiSearchDebounced]);

  const supportGridColumns = React.useMemo(() => ([
    {
      id: 'contact',
      header: 'Contato',
      render: (ticket) => (
        <div>
          <div style={{ fontWeight: 600 }}>{highlightText(getContactName(ticket), uiSearchDebounced)}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{getPhoneNode(ticket)}</div>
        </div>
      ),
      sortValue: (ticket) => getContactName(ticket),
    },
    {
      id: 'status',
      header: 'Status',
      render: (ticket) => (
        <div>
          <span className={`support-ticket-status ${getStatusClass(ticket.status)}`}>{formatTicketStatus(ticket.status)}</span>
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{formatTicketMode(ticket.mode)}</div>
        </div>
      ),
      sortValue: (ticket) => ticket?.status,
      width: '160px',
    },
    {
      id: 'preview',
      header: 'Ultima mensagem',
      render: (ticket) => (
        <div>
          <div>{getTicketPreview(ticket, uiSearchDebounced)}</div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            {getAssignedLabel(ticket)} • {getQueueLabel(ticket)}
          </div>
        </div>
      ),
    },
    {
      id: 'updatedAt',
      header: 'Atualizacao',
      render: (ticket) => (
        <div>
          <div>{formatTime(ticket.updatedAt || ticket.createdAt)}</div>
          {ticket.unreadCount > 0 ? (
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#e74c3c', fontWeight: 700 }}>
              {formatBadgeCount(ticket.unreadCount)} nao lida(s)
            </div>
          ) : null}
        </div>
      ),
      sortValue: (ticket) => ticket?.updatedAt || ticket?.createdAt,
      width: '120px',
    },
  ]), [phoneMaskingEnabled, uiSearchDebounced]);

  function clearTicketFilters() {
    setUiSearch('');
    setUiQueue('');
  }

  function handleSelectTicket(ticket) {
    setSelectedTicket(ticket);
    if (isMobile) {
      setIsRightPanelCollapsed(true);
    }
  }

  return (
    <CrudPageBase title="💬 Atendimento" hideHeader>
      <SupportWorkspaceHeader
        wsStatus={wsStatus}
        loadTickets={() => loadTicketsRef.current?.()}
        loading={loading}
        queues={queues}
        setNewConversationQueue={setNewConversationQueue}
        setShowNewConversationModal={setShowNewConversationModal}
      />

      <div className={`support-grid${isMobile ? ' is-mobile' : ''}${isMobile && !isRightPanelCollapsed ? ' right-open' : ''}`}>
        <div className="support-left-column">
          <SupportFiltersBar
            uiSearch={uiSearch}
            setUiSearch={setUiSearch}
            ticketQueueOptions={ticketQueueOptions}
            uiQueue={uiQueue}
            setUiQueue={setUiQueue}
            onClear={clearTicketFilters}
          />
          <SupportTicketList
            isMobile={isMobile}
            loading={loading}
            ticketsView={ticketsView}
            handleSelectTicket={handleSelectTicket}
            selectedTicket={selectedTicket}
            uiSearchDebounced={uiSearchDebounced}
            highlightText={highlightText}
            getContactName={getContactName}
            getPhoneNode={getPhoneNode}
            formatTicketMode={formatTicketMode}
            getStatusClass={getStatusClass}
            formatTicketStatus={formatTicketStatus}
            formatTime={formatTime}
            formatBadgeCount={formatBadgeCount}
            getTicketPreview={getTicketPreview}
            getAssignedLabel={getAssignedLabel}
            getQueueLabel={getQueueLabel}
            supportGridColumns={supportGridColumns}
          />
        </div>

        <div className="support-details-panel">
          {selectedTicket ? (
            <>
              <div style={{ display: 'flex', gap: '14px', minHeight: 0 }}>
                <SupportConversationPane
                  isMobile={isMobile}
                  selectedTicket={selectedTicket}
                  setSelectedTicket={setSelectedTicket}
                  setIsRightPanelCollapsed={setIsRightPanelCollapsed}
                  handoverLoading={handoverLoading}
                  handleTakeOver={handleTakeOver}
                  handleReturnToBot={handleReturnToBot}
                  handlePause={handlePause}
                  handleResume={handleResume}
                  deliveryFailuresLoading={deliveryFailuresLoading}
                  openDeliveryFailures={openDeliveryFailures}
                  formatDate={formatDate}
                  messagesContainerRef={messagesContainerRef}
                  timelineMessages={timelineMessages}
                  renderTimelineMessageContent={renderTimelineMessageContent}
                  getDeliveryStatusBadge={getDeliveryStatusBadge}
                  assignedTo={assignedTo}
                  setAssignedTo={setAssignedTo}
                  agent={agent}
                  handleAssign={handleAssign}
                  quickReplySelectedCategory={quickReplySelectedCategory}
                  setQuickReplySelectedCategory={setQuickReplySelectedCategory}
                  quickReplyCategories={quickReplyCategories}
                  quickReplyCategoryItems={quickReplyCategoryItems}
                  quickReplySuggestions={quickReplySuggestions}
                  insertQuickReply={insertQuickReply}
                  messageText={messageText}
                  setMessageText={setMessageText}
                  quickReplySlashOpen={quickReplySlashOpen}
                  quickReplySlashResults={quickReplySlashResults}
                  handleSendMessage={handleSendMessage}
                  handleClose={handleClose}
                />

                <SupportDetailsSidebar
                  isMobile={isMobile}
                  isRightPanelCollapsed={isRightPanelCollapsed}
                  setIsRightPanelCollapsed={setIsRightPanelCollapsed}
                >
                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ fontWeight: 700 }}>Contato</div>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        border: '1px solid #ddd',
                        background: getModeLabel(selectedTicket.mode).bg,
                        color: getModeLabel(selectedTicket.mode).fg,
                      }}>
                        {getModeLabel(selectedTicket.mode).label}
                      </span>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      <div>📞 <strong><MaskedPhone phone={selectedTicket.phoneNumber} mask={phoneMaskingEnabled} /></strong></div>
                      <div>Fila: <strong>{selectedTicket.queue}</strong></div>
                      <div>Status: <strong>{selectedTicket.status}</strong></div>
                      {selectedTicket.pauseReason ? (
                        <div>Motivo: <strong>{selectedTicket.pauseReason}</strong></div>
                      ) : null}
                      {selectedTicket?.context?.closeReasonName ? (
                        <div>Close reason: <strong>{selectedTicket.context.closeReasonName}</strong></div>
                      ) : null}
                      {selectedTicket.channelType ? <div>Canal: <strong>{selectedTicket.channelType}</strong></div> : null}
                      {selectedTicket.conversationId ? <div>ConversationId: <code>{selectedTicket.conversationId}</code></div> : null}
                      <div>Criado: {formatDate(selectedTicket.createdAt)}</div>
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700 }}>Resumo IA</div>
                      <Button
                        onClick={handleGenerateAiSummary}
                        disabled={aiSummaryLoading}
                        style={{ width: 'auto' }}
                        title="Gerar ou atualizar resumo do ticket"
                      >
                        {aiSummaryLoading ? 'Gerando...' : (aiSummary ? 'Atualizar' : 'Gerar')}
                      </Button>
                    </div>
                    {aiSummary ? (
                      typeof aiSummary === 'string' ? (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                          {aiSummary}
                        </div>
                      ) : (
                        <pre style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                          {safeStringify(aiSummary, 3000)}
                        </pre>
                      )
                    ) : (
                      <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
                        Sem resumo gerado para este ticket.
                      </div>
                    )}
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Entidades</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {(extractedEntities.emails.length === 0
                        && extractedEntities.cpfs.length === 0
                        && extractedEntities.cnpjs.length === 0
                        && extractedEntities.phones.length === 0
                        && extractedEntities.urls.length === 0) ? (
                          <div style={{ color: 'var(--color-text-tertiary)' }}>Nada detectado automaticamente.</div>
                        ) : (
                          <>
                            {extractedEntities.emails.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>E-mails</div>
                                {extractedEntities.emails.map((e) => <div key={e}><code>{e}</code></div>)}
                              </div>
                            ) : null}
                            {extractedEntities.phones.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>Telefones</div>
                                {extractedEntities.phones.map((p) => <div key={p}><code>{p}</code></div>)}
                              </div>
                            ) : null}
                            {extractedEntities.cpfs.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>CPF</div>
                                {extractedEntities.cpfs.map((c) => <div key={c}><code>{c}</code></div>)}
                              </div>
                            ) : null}
                            {extractedEntities.cnpjs.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>CNPJ</div>
                                {extractedEntities.cnpjs.map((c) => <div key={c}><code>{c}</code></div>)}
                              </div>
                            ) : null}
                            {extractedEntities.urls.length > 0 ? (
                              <div style={{ marginBottom: '0px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>URLs</div>
                                {extractedEntities.urls.map((u) => (
                                  <div key={u}>
                                    <a href={u} target="_blank" rel="noreferrer">{u}</a>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Tags</div>
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
                      <Button onClick={handleAddTag} style={{ width: 'auto' }}>
                        Adicionar
                      </Button>
                    </div>
                  </div>

                  {Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 ? (
                    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                      <div style={{ fontWeight: 700, marginBottom: '8px' }}>Handover & atribuições</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {selectedTicket.context.handoverHistory.slice(-8).reverse().map((h, idx) => (
                          <div key={`${h.timestamp}-${idx}`} style={{ marginBottom: '6px' }}>
                            <div style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(h.timestamp)}</div>
                            <div>
                              <strong>{h.type}</strong> • {h.mode}
                              {h.actorUsername ? ` • ${h.actorUsername}` : ''}
                              {h.reason ? ` • ${h.reason}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ minHeight: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700 }}>Eventos do ticket</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {Array.isArray(ticketEvents) ? `${ticketEvents.length} item(ns)` : '0 item(ns)'}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'auto', maxHeight: '220px' }}>
                      {Array.isArray(ticketEvents) && ticketEvents.length > 0 ? (
                        ticketEvents.slice(0, 20).map((ev) => (
                          <div key={ev.id} style={{ padding: '8px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                              <div style={{ fontWeight: 600 }}>{ev.type}</div>
                              <div style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(ev.createdAt)}</div>
                            </div>
                            {ev?.payload ? (
                              <div style={{ marginTop: '4px', color: 'var(--color-text-tertiary)' }}>
                                {typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)}
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div style={{ color: 'var(--color-text-tertiary)' }}>
                          Sem eventos registrados para este ticket.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ minHeight: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ fontWeight: 700 }}>Auditoria</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {ticketAuditLoading ? 'Carregando…' : `${ticketAuditLogs.length} item(ns)`}
                      </div>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'auto', maxHeight: '220px' }}>
                      {ticketAuditLoading ? (
                        <div>Carregando…</div>
                      ) : (ticketAuditLogs.length === 0 ? (
                        <div style={{ color: 'var(--color-text-tertiary)' }}>Sem logs de auditoria para este ticket.</div>
                      ) : (
                        ticketAuditLogs.map((l, idx) => (
                          <div key={`${l.timestamp || l.createdAt || idx}`} style={{ padding: '8px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                              <div style={{ fontWeight: 600 }}>{l.action || 'action'}</div>
                              <div style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(l.timestamp || l.createdAt)}</div>
                            </div>
                            <div style={{ marginTop: '4px' }}>
                              {l.username ? <span><strong>{l.username}</strong></span> : <span><strong>sistema</strong></span>}
                              {l.details ? <span style={{ color: 'var(--color-text-tertiary)' }}> • {typeof l.details === 'string' ? l.details : JSON.stringify(l.details)}</span> : null}
                            </div>
                          </div>
                        ))
                      ))}
                    </div>
                  </div>
                </SupportDetailsSidebar>
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

      {/* Modal: Falhas de entrega */}
      <SupportDeliveryFailuresModal
        isOpen={showDeliveryFailuresModal}
        loading={deliveryFailuresLoading}
        deliveryFailures={deliveryFailures}
        selectedTicket={selectedTicket}
        showToast={showToast}
        showToastRef={showToastRef}
        onClose={() => setShowDeliveryFailuresModal(false)}
      />

      {/* Modal de Encerramento com Motivo */}
      <SupportCloseTicketModal
        isOpen={showCloseModal}
        closing={closing}
        closeReasons={closeReasons}
        selectedCloseReasonId={selectedCloseReasonId}
        setSelectedCloseReasonId={setSelectedCloseReasonId}
        selectedCloseReasonName={selectedCloseReasonName}
        setSelectedCloseReasonName={setSelectedCloseReasonName}
        closeTagsInput={closeTagsInput}
        setCloseTagsInput={setCloseTagsInput}
        onConfirmClose={handleConfirmClose}
        onClose={() => {
          setShowCloseModal(false);
          setClosingTicketId(null);
        }}
      />

      {/* Modal para Iniciar Nova Conversa */}
      <SupportNewConversationModal
        isOpen={showNewConversationModal}
        newConversationPhone={newConversationPhone}
        setNewConversationPhone={setNewConversationPhone}
        newConversationMessage={newConversationMessage}
        setNewConversationMessage={setNewConversationMessage}
        newConversationQueue={newConversationQueue}
        setNewConversationQueue={setNewConversationQueue}
        queues={queues}
        showToast={showToast}
        onClose={() => {
          setShowNewConversationModal(false);
          setNewConversationPhone('');
          setNewConversationMessage('');
          setNewConversationQueue('');
        }}
        onTicketCreated={(ticket) => {
          if (loadTicketsRef.current) loadTicketsRef.current();
          setSelectedTicket(ticket);
        }}
      />
    </CrudPageBase>
  );
}
