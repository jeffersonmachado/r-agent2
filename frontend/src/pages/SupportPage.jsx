import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listAllTickets,
  assignTicket,
  closeTicket,
  sendTicketMessage,
  takeOverTicket,
  returnToBotTicket,
  pauseTicket,
  resumeTicket,
  getTicketDeliveryFailures,
} from '../api/tickets';
import { listQuickReplies, useQuickReply, getCategories as getQuickReplyCategories } from '../api/quickReplies';
import { listCloseReasons } from '../api/closeReasons';
import { addTagToTicket, removeTagFromTicket } from '../api/segmentation';
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
import { ScheduleModal } from '../components/ScheduleModal';
import { useSupportEvidence } from '../hooks/useSupportEvidence';
import { SupportResolvedEntityCard } from '../components/support/SupportResolvedEntityCard';
import { SupportEvidenceCard } from '../components/support/SupportEvidenceCard';
import { SupportSuggestedReplyCard } from '../components/support/SupportSuggestedReplyCard';
import { SupportHistoryCard } from '../components/support/SupportHistoryCard';
import { SupportCard } from '../components/support/SupportCard';
import { useSupportTicketContext } from '../hooks/useSupportTicketContext';
import { isWebPushSupported, subscribeCurrentUserWebPush } from '../api/webPush';
import { buildApiUrl } from '../api/client';
import { getBasePath } from '../utils';

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
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [uiSearch, setUiSearch] = useState('');
  const [uiQueue, setUiQueue] = useState('');
  const [ticketViewFilter, setTicketViewFilter] = useState('all');
  const [showOtherAgents, setShowOtherAgents] = useState(false);
  const [showClosedTickets, setShowClosedTickets] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
  // Auto-refresh sempre ativo quando WebSocket não está disponível
  const autoRefresh = true;
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [newConversationPhone, setNewConversationPhone] = useState('');
  const [newConversationMessage, setNewConversationMessage] = useState('');
  const [newConversationQueue, setNewConversationQueue] = useState('');
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [scheduleContextTicket, setScheduleContextTicket] = useState(null);
  const [quickReplySlashResults, setQuickReplySlashResults] = useState([]);
  const [quickReplySlashOpen, setQuickReplySlashOpen] = useState(false);
  const [slashCommandResults, setSlashCommandResults] = useState([]);
  const [slashMenuMode, setSlashMenuMode] = useState('commands');
  const [slashMenuCursorIndex, setSlashMenuCursorIndex] = useState(-1);
  const [quickReplyCategories, setQuickReplyCategories] = useState([]);
  const [quickReplySelectedCategory, setQuickReplySelectedCategory] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingTicketId, setClosingTicketId] = useState(null);
  const [closeReasons, setCloseReasons] = useState([]);
  const [selectedCloseReasonId, setSelectedCloseReasonId] = useState('');
  const [selectedCloseReasonName, setSelectedCloseReasonName] = useState('');
  const [closeTagsInput, setCloseTagsInput] = useState('');
  const [closing, setClosing] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showDeliveryFailuresModal, setShowDeliveryFailuresModal] = useState(false);
  const [deliveryFailuresLoading, setDeliveryFailuresLoading] = useState(false);
  const [deliveryFailures, setDeliveryFailures] = useState({ outboundQueue: [], channelMessages: [] });
  const [mediaModal, setMediaModal] = useState({
    isOpen: false,
    type: 'document',
    title: 'Mídia',
    mimeType: '',
    urls: [],
    index: 0,
    failed: false,
  });
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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const basePath = getBasePath() || '';
    const faviconHref = `${basePath}/favicon.ico`.replace(/\/\/{2,}/g, '/');
    const icon = document.querySelector("link[rel='icon']");
    if (icon && icon.getAttribute('href') !== faviconHref) {
      icon.setAttribute('href', faviconHref);
    }
  }, []);

  // Debounce para loadTickets - agrupa múltiplos eventos WebSocket
  // DEVE ser definido ANTES de handleWebSocketEvent para evitar erro de inicialização
  const { debouncedFn: debouncedLoadTickets } = useDebounce(() => {
    if (loadTicketsRef.current) {
      loadTicketsRef.current();
    }
  }, 500); // 500ms de debounce

  // Debounce para quick replies via menu "/"
  const { debouncedFn: debouncedSearchSlashQuickReplies } = useDebounce((query) => {
    if (!query || String(query).trim().length < 2) {
      setQuickReplySlashOpen(false);
      setQuickReplySlashResults([]);
      return;
    }
    listQuickReplies({ search: String(query).trim(), activeOnly: true, category: quickReplySelectedCategory || undefined })
      .then((resp) => {
        const list = resp?.quickReplies || [];
        setQuickReplySlashResults(list.slice(0, 8));
        setSlashMenuMode('quick_replies');
        setQuickReplySlashOpen(list.length > 0);
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
    handleGenerateAiSummary,
    safeGetBodyText,
  } = useSupportTicketContext({
    selectedTicket,
    setSelectedTicket,
    setTickets,
    showToast,
  });

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
    setSlashCommandResults([]);
    setSlashMenuMode('commands');
    setSlashMenuCursorIndex(-1);
    try { await useQuickReply(reply.id); } catch {}
  }, [applyTemplateVariables, selectedTicket]);

  const closeSlashMenu = useCallback(() => {
    setQuickReplySlashOpen((prev) => (prev ? false : prev));
    setQuickReplySlashResults((prev) => (prev.length > 0 ? [] : prev));
    setSlashCommandResults((prev) => (prev.length > 0 ? [] : prev));
    setSlashMenuMode((prev) => (prev !== 'commands' ? 'commands' : prev));
    setSlashMenuCursorIndex((prev) => (prev !== -1 ? -1 : prev));
  }, []);

  const openQuickReplyBrowser = useCallback(async () => {
    const resp = await listQuickReplies({
      activeOnly: true,
      category: quickReplySelectedCategory || undefined,
    });
    const list = (resp?.quickReplies || []).slice(0, 8);
    setQuickReplySlashResults(list);
    setSlashCommandResults([]);
    setSlashMenuMode('quick_replies');
    setQuickReplySlashOpen(list.length > 0);
    return list;
  }, [quickReplySelectedCategory]);

  useEffect(() => {
    // Carrega categorias (best-effort) para quick replies
    // (para o operador filtrar por categoria no console)
    getQuickReplyCategories()
      .then((resp) => setQuickReplyCategories(resp?.categories || []))
      .catch(() => setQuickReplyCategories([]));
  }, []);

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
      const [waitingResult, inProgressResult, closedResult] = await Promise.all([
        listAllTickets({ status: 'waiting', limit: 1000 }),
        listAllTickets({ status: 'in_progress', limit: 1000 }),
        showClosedTickets ? listAllTickets({ status: 'closed', limit: 1000 }) : Promise.resolve({ tickets: [] }),
      ]);
      
      // Combina os tickets e remove duplicatas
      const allTickets = [...(waitingResult.tickets || []), ...(inProgressResult.tickets || []), ...(closedResult.tickets || [])];
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
        if (!updatedTicket) return null;
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
  }, [showClosedTickets]); // Refaz a carga ao incluir/excluir fechados

  // Atualiza ref quando loadTickets muda
  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  useEffect(() => {
    if (!hasLoadedInitialDataRef.current) return;
    loadTickets();
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

  function safeStringify(obj, maxLen = 2000) {
    try {
      const s = JSON.stringify(obj, null, 2);
      if (typeof s !== 'string') return '';
      return s.length > maxLen ? `${s.slice(0, maxLen)}\n…` : s;
    } catch {
      return '';
    }
  }

  function firstNonEmptyString(values = []) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return null;
  }

  function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function isPhoneLikeValue(value, phoneNumber) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const compact = raw.replace(/[^\d+]/g, '');
    if (/^\+?\d{10,15}$/.test(compact)) return true;
    const valueDigits = normalizeDigits(raw);
    const phoneDigits = normalizeDigits(phoneNumber);
    return !!(valueDigits && phoneDigits && valueDigits === phoneDigits);
  }

  function pickFirstMediaUrl(...values) {
    return getMediaCandidates(...values)[0] || null;
  }

  function getMediaCandidates(...values) {
    const basePath = getBasePath() || '';
    const candidates = [];
    const seen = new Set();

    const addCandidate = (url) => {
      if (typeof url !== 'string') return;
      const normalized = url.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(normalized);
    };

    const withBasePath = (path) => {
      if (typeof path !== 'string' || !path.startsWith('/')) return path;
      if (!basePath || path.startsWith(`${basePath}/`)) return path;
      return `${basePath}${path}`;
    };

    const isApiRoute = (path) => {
      if (typeof path !== 'string') return false;
      return path.startsWith('/api/')
        || path.startsWith('/tickets/')
        || path.startsWith('/queues/')
        || path.startsWith('/flows/')
        || path.startsWith('/auth/')
        || path.startsWith('/conversations/');
    };

    const looksLikeFileName = (value) => /^[\w.-]+\.[a-z0-9]{2,5}$/i.test(value);

    const normalizeRawMediaUrl = (raw) => {
      if (typeof raw !== 'string') return [];
      const value = raw.trim();
      if (!value) return [];

      if (/^data:/i.test(value) || /^blob:/i.test(value) || /^https?:\/\//i.test(value)) {
        return [value];
      }

      if (value.startsWith('//')) {
        const protocol = (typeof window !== 'undefined' && window.location?.protocol) || 'https:';
        return [`${protocol}${value}`];
      }

      if (value.startsWith('/')) {
        if (isApiRoute(value)) {
          return [buildApiUrl(value)];
        }
        return [withBasePath(value)];
      }

      if (value.startsWith('public/')) {
        return [withBasePath(`/${value}`)];
      }

      if (value.startsWith('r-agent2/')) {
        return [`/${value}`];
      }

      if (looksLikeFileName(value)) {
        return [
          withBasePath(`/public/whatsapp-media/${value}`),
          withBasePath(`/public/support-media/system/${value}`),
        ];
      }

      if (value.includes('/')) {
        return [withBasePath(`/${value.replace(/^\/+/, '')}`)];
      }

      return [withBasePath(`/public/whatsapp-media/${value}`)];
    };

    const attachmentCandidates = [];
    for (const value of values) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!item || typeof item !== 'object') continue;
          attachmentCandidates.push(
            item?.payload?.url,
            item?.url,
            item?.href,
            item?.link,
            item?.src,
            item?.mediaUrl,
          );
        }
      }
    }

    const rawCandidates = [...values, ...attachmentCandidates].filter((value) => typeof value === 'string');
    for (const raw of rawCandidates) {
      const normalized = normalizeRawMediaUrl(raw);
      normalized.forEach(addCandidate);
    }

    return candidates;
  }

  function openMediaModal({ urls, type = 'document', title = 'Mídia', mimeType = '' }) {
    const validUrls = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u.trim()) : [];
    if (validUrls.length === 0) return;
    setMediaModal({
      isOpen: true,
      type,
      title: title || 'Mídia',
      mimeType: mimeType || '',
      urls: validUrls,
      index: 0,
      failed: false,
    });
  }

  function closeMediaModal() {
    setMediaModal((prev) => ({ ...prev, isOpen: false }));
  }

  function handleMediaRenderError() {
    setMediaModal((prev) => {
      if (!prev.isOpen) return prev;
      if (prev.index < prev.urls.length - 1) {
        return { ...prev, index: prev.index + 1, failed: false };
      }
      return { ...prev, failed: true };
    });
  }

  const activeMediaUrl = mediaModal.urls[mediaModal.index] || '';

  useEffect(() => {
    if (!mediaModal.isOpen || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMediaModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mediaModal.isOpen]);

  function renderOpenMediaAction({ label = 'Abrir mídia', type = 'document', urls = [], title = 'Mídia', mimeType = '' }) {
    if (!Array.isArray(urls) || urls.length === 0) {
      return null;
    }
    return (
      <button
        type="button"
        onClick={() => openMediaModal({ urls, type, title, mimeType })}
        style={{
          border: '1px solid var(--color-border-default)',
          borderRadius: '8px',
          padding: '6px 10px',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    );
  }

  function renderTimelineMessageContent(msg) {
    if (!msg) {
      return null;
    }

    if (msg.source !== 'channel' || !msg.channel) {
      const rawMessage = msg?.raw || {};
      const rawMedia = rawMessage?.media || {};
      const mediaType = String(rawMessage?.type || rawMedia?.type || rawMessage?.mediaKind || '').toLowerCase();
      const mediaUrls = getMediaCandidates(
        rawMessage?.mediaUrl,
        rawMedia?.url,
        rawMessage?.url,
      );
      const mediaUrl = mediaUrls[0] || null;
      const fileName = firstNonEmptyString([rawMessage?.fileName, rawMedia?.fileName]);
      const mimeType = firstNonEmptyString([rawMessage?.mimeType, rawMedia?.mimeType]);
      const documentId = firstNonEmptyString([rawMessage?.documentId, rawMedia?.documentId]);

      if (mediaUrl) {
        const typeLabel = mediaType || 'arquivo';
        return (
          <div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
              {typeLabel === 'image' ? 'Imagem' : typeLabel === 'audio' || typeLabel === 'voice' ? 'Áudio' : typeLabel === 'video' ? 'Vídeo' : 'Arquivo'}
            </div>
            {fileName ? <div style={{ marginBottom: '4px' }}><strong>{fileName}</strong></div> : null}
            {msg?.text ? <div style={{ marginBottom: '6px' }}>{msg.text}</div> : null}
            {renderOpenMediaAction({
              label: 'Abrir mídia',
              type: mediaType || 'document',
              urls: mediaUrls,
              title: fileName || msg?.text || 'Mídia do ticket',
              mimeType,
            })}
            {(mimeType || documentId) ? (
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#666' }}>
                {mimeType ? <span>{mimeType}</span> : null}
                {mimeType && documentId ? <span> • </span> : null}
                {documentId ? <span>document_id: <code>{documentId}</code></span> : null}
              </div>
            ) : null}
          </div>
        );
      }

      return <>{msg?.text}</>;
    }

    const cm = msg.channel;
    const type = String(cm?.type || '').toLowerCase();
    const body = cm?.body || {};
    const text = safeGetBodyText(body);

    const commonMeta = (() => {
      const urls = getMediaCandidates(
        body.url,
        body.mediaUrl,
        body?.media?.url,
        body?.raw?.url,
        body?.raw?.mediaUrl,
        body.attachments,
        body?.raw?.attachments,
        body.files,
        body?.raw?.files,
      );
      return urls.length > 0 ? { urls, url: urls[0] } : {};
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
      const urls = getMediaCandidates(commonMeta.url, image?.url, image?.link, image?.href, image?.src);
      const url = urls[0] || null;
      const mime = image?.mime_type || null;
      const id = image?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Imagem</div>
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {url ? (
            <div style={{ marginTop: '6px' }}>
              {renderOpenMediaAction({ label: 'Abrir imagem', type: 'image', urls, title: caption || 'Imagem', mimeType: mime || '' })}
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
      const urls = getMediaCandidates(commonMeta.url, doc?.url, doc?.link, doc?.href, doc?.src);
      const url = urls[0] || null;
      const filename = doc?.filename || null;
      const mime = doc?.mime_type || null;
      const id = doc?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Documento</div>
          {filename ? <div style={{ marginBottom: '4px' }}><strong>{String(filename)}</strong></div> : null}
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {url ? (
            renderOpenMediaAction({ label: 'Abrir documento', type: 'document', urls, title: filename || 'Documento', mimeType: mime || '' })
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
      const urls = getMediaCandidates(commonMeta.url, audio?.url, audio?.link, audio?.href, audio?.src);
      const url = urls[0] || null;
      const mime = audio?.mime_type || null;
      const id = audio?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Áudio</div>
          {url ? (
            renderOpenMediaAction({ label: 'Abrir áudio', type: 'audio', urls, title: 'Áudio', mimeType: mime || '' })
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
      const urls = getMediaCandidates(commonMeta.url, video?.url, video?.link, video?.href, video?.src);
      const url = urls[0] || null;
      const mime = video?.mime_type || null;
      const id = video?.id || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Vídeo</div>
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {url ? (
            renderOpenMediaAction({ label: 'Abrir vídeo', type: 'video', urls, title: caption || 'Vídeo', mimeType: mime || '' })
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

  useEffect(() => {
    if (selectedTicket?.status === 'waiting' && !assignedTo) {
      const defaultAssignee = agent?.username || agent?.id || '';
      if (defaultAssignee) setAssignedTo(defaultAssignee);
      return;
    }
    if (!selectedTicket) {
      setAssignedTo('');
    }
  }, [agent?.id, agent?.username, assignedTo, selectedTicket?.id, selectedTicket?.status]);

  // Auto-refresh a cada 5 segundos - usa refs para evitar recriação do intervalo
  const selectedTicketIdRef = React.useRef(null);
  
  React.useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?.id || null;
  }, [selectedTicket?.id]);

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

  const slashCommands = React.useMemo(() => {
    const commands = [
      {
        id: 'resposta-rapida',
        label: '/resposta-rapida',
        description: 'Abrir lista de respostas rápidas',
        run: async () => {
          await openQuickReplyBrowser();
          setMessageText('/resposta-rapida');
        },
      },
      {
        id: 'agendar',
        label: '/agendar',
        description: 'Abrir agendamento para este ticket',
        run: async () => {
          if (!selectedTicket) return;
          setScheduleContextTicket(selectedTicket);
          setMessageText('');
          closeSlashMenu();
        },
      },
      {
        id: 'falhas-entrega',
        label: '/falhas-entrega',
        description: 'Abrir falhas de entrega do ticket',
        run: async () => {
          await openDeliveryFailures();
          setMessageText('');
          closeSlashMenu();
        },
      },
      {
        id: 'fechar-ticket',
        label: '/fechar-ticket',
        description: 'Fechar o ticket atual',
        run: async () => {
          if (!selectedTicket) return;
          handleClose(selectedTicket.id);
          setMessageText('');
          closeSlashMenu();
        },
      },
    ];

    if ((selectedTicket?.mode || 'bot') === 'bot') {
      commands.unshift({
        id: 'assumir',
        label: '/assumir',
        description: 'Assumir atendimento humano',
        run: async () => {
          await handleTakeOver();
          setMessageText('');
          closeSlashMenu();
        },
      });
    }

    if ((selectedTicket?.mode || 'bot') === 'human') {
      commands.unshift(
        {
          id: 'devolver-bot',
          label: '/devolver-bot',
          description: 'Devolver atendimento ao bot',
          run: async () => {
            await handleReturnToBot();
            setMessageText('');
            closeSlashMenu();
          },
        },
        {
          id: 'pausar',
          label: '/pausar',
          description: 'Pausar atendimento humano',
          run: async () => {
            await handlePause();
            setMessageText('');
            closeSlashMenu();
          },
        },
      );
    }

    if ((selectedTicket?.mode || 'bot') === 'paused') {
      commands.unshift({
        id: 'retomar',
        label: '/retomar',
        description: 'Retomar atendimento humano',
        run: async () => {
          await handleResume();
          setMessageText('');
          closeSlashMenu();
        },
      });
    }

    return commands;
  }, [
    selectedTicket,
    openQuickReplyBrowser,
    openDeliveryFailures,
    handleClose,
    handleTakeOver,
    handleReturnToBot,
    handlePause,
    handleResume,
    closeSlashMenu,
  ]);

  const setSlashCommandsIfChanged = useCallback((nextCommands) => {
    setSlashCommandResults((prev) => {
      if (
        prev.length === nextCommands.length
        && prev.every((item, index) => item.id === nextCommands[index]?.id)
      ) {
        return prev;
      }
      return nextCommands;
    });
  }, []);

  useEffect(() => {
    if (!selectedTicket || selectedTicket.status !== 'in_progress') {
      closeSlashMenu();
      return;
    }

    const txt = String(messageText || '').trim();
    if (!txt.startsWith('/')) {
      closeSlashMenu();
      return;
    }

    if (slashMenuMode === 'quick_replies' && /^\/resposta-rapida\b/i.test(txt)) {
      setQuickReplySlashOpen(true);
      return;
    }

    const query = txt.slice(1).toLowerCase();
    const matchingCommands = slashCommands.filter((command) => {
      const haystack = `${command.label} ${command.description}`.toLowerCase();
      return haystack.includes(query);
    });

    if (matchingCommands.length > 0) {
      setSlashCommandsIfChanged(matchingCommands);
      setQuickReplySlashResults((prev) => (prev.length > 0 ? [] : prev));
      setSlashMenuMode('commands');
      setQuickReplySlashOpen(true);
      return;
    }

    if (query.length >= 2) {
      setSlashCommandResults([]);
      debouncedSearchSlashQuickReplies(query);
      return;
    }

    setSlashCommandsIfChanged(slashCommands);
    setQuickReplySlashResults((prev) => (prev.length > 0 ? [] : prev));
    setSlashMenuMode('commands');
    setQuickReplySlashOpen(true);
  }, [
    selectedTicket,
    messageText,
    slashMenuMode,
    slashCommands,
    setSlashCommandsIfChanged,
    debouncedSearchSlashQuickReplies,
    closeSlashMenu,
  ]);

  const handleSelectSlashItem = useCallback(async (item) => {
    if (!item) return;
    if (item.kind === 'quick_reply') {
      await insertQuickReply(item.reply);
      return;
    }
    if (typeof item.run === 'function') {
      await item.run();
    }
  }, [insertQuickReply]);

  useEffect(() => {
    if (!quickReplySlashOpen) {
      setSlashMenuCursorIndex(-1);
      return;
    }

    const totalItems = slashMenuMode === 'commands'
      ? slashCommandResults.length
      : quickReplySlashResults.length;

    if (totalItems <= 0) {
      setSlashMenuCursorIndex(-1);
      return;
    }

    setSlashMenuCursorIndex((prev) => {
      if (prev < 0 || prev >= totalItems) return 0;
      return prev;
    });
  }, [quickReplySlashOpen, slashMenuMode, slashCommandResults, quickReplySlashResults]);

  const handleComposerKeyDown = useCallback(async (event) => {
    const txt = String(messageText || '').trim();
    const isSlashInputOpen = txt.startsWith('/') && quickReplySlashOpen;
    const slashItems = slashMenuMode === 'commands'
      ? slashCommandResults
      : quickReplySlashResults.map((reply) => ({ kind: 'quick_reply', reply }));

    if (isSlashInputOpen && slashItems.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSlashMenuCursorIndex((prev) => {
        if (prev < 0 || prev >= slashItems.length) return delta > 0 ? 0 : slashItems.length - 1;
        return (prev + delta + slashItems.length) % slashItems.length;
      });
      return;
    }

    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey && txt.startsWith('/')) {
      event.preventDefault();
      if (slashItems.length > 0) {
        const selectedIndex = slashMenuCursorIndex >= 0 && slashMenuCursorIndex < slashItems.length
          ? slashMenuCursorIndex
          : 0;
        await handleSelectSlashItem(slashItems[selectedIndex]);
      }
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleSendMessage();
    }
  }, [
    messageText,
    slashMenuMode,
    quickReplySlashOpen,
    slashCommandResults,
    quickReplySlashResults,
    slashMenuCursorIndex,
    handleSelectSlashItem,
    handleSendMessage,
  ]);

  const handleHoverSlashItem = useCallback((index) => {
    setSlashMenuCursorIndex(index);
  }, []);

  function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  }

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
    const variables = ticket?.context?.variables || {};
    const candidates = [
      ticket?.contactName,
      ticket?.customerName,
      ticket?.displayName,
      ticket?.name,
      ticket?.contact?.name,
      ticket?.contact?.displayName,
      ticket?.contact?.profile?.name,
      ticket?.context?.contactName,
      ticket?.context?.customerName,
      ticket?.context?.displayName,
      ticket?.context?.name,
      ticket?.context?.contact?.name,
      ticket?.context?.metadata?.contactName,
      ticket?.context?.metadata?.customerName,
      ticket?.context?.metadata?.profileName,
      ticket?.context?.metadata?.senderName,
      variables?.contactName,
      variables?.customerName,
      variables?.displayName,
      variables?.name,
      variables?.nome,
      variables?.fullName,
      variables?.nomeCompleto,
      variables?.customer?.name,
      variables?.contact?.name,
      variables?.profile?.name,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const name = candidate.trim();
      if (!name) continue;
      if (isPhoneLikeValue(name, ticket?.phoneNumber)) continue;
      return name;
    }

    return ticket?.phoneNumber || 'Sem contato';
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
      if (!showClosedTickets && ticket?.status === 'closed') return false;
      if (!showOtherAgents) {
        const assigned = ticket?.assignedTo;
        const selfAgentId = agent?.id;
        const selfAgentUsername = agent?.username;
        if (assigned && assigned !== selfAgentId && assigned !== selfAgentUsername) return false;
      }
      if (uiQueue && ticket?.queue !== uiQueue) return false;
      if (ticketViewFilter === 'unread' && !(Number(ticket?.unreadCount || 0) > 0)) return false;
      if (ticketViewFilter === 'waiting' && ticket?.status !== 'waiting') return false;
      if (ticketViewFilter === 'in_progress' && ticket?.status !== 'in_progress') return false;
      if (ticketViewFilter === 'closed' && ticket?.status !== 'closed') return false;
      if (ticketViewFilter === 'unassigned' && ticket?.assignedTo) return false;
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
  }, [tickets, showClosedTickets, showOtherAgents, agent?.id, agent?.username, uiQueue, ticketViewFilter, uiSearchDebounced]);

  function clearTicketFilters() {
    setUiSearch('');
    setUiQueue('');
    setTicketViewFilter('all');
  }

  function handleSelectTicket(ticket) {
    setSelectedTicket(ticket);
    if (isMobile) {
      setIsRightPanelCollapsed(true);
    }
  }

  async function handleEnableNotifications() {
    if (!isWebPushSupported()) {
      showToast('Notificações web não são suportadas neste navegador', 'warning');
      return;
    }
    try {
      await subscribeCurrentUserWebPush({ deviceName: 'support-workspace' });
      showToast('Notificações web ativadas', 'success');
    } catch (error) {
      logger.error('Erro ao ativar notificações web', error);
      const message = error?.message || 'Não foi possível ativar notificações web.';
      showToast(message, 'error');
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
        onEnableNotifications={handleEnableNotifications}
      />
      <SupportFiltersBar
        uiSearch={uiSearch}
        setUiSearch={setUiSearch}
        ticketQueueOptions={ticketQueueOptions}
        uiQueue={uiQueue}
        setUiQueue={setUiQueue}
        ticketViewFilter={ticketViewFilter}
        setTicketViewFilter={setTicketViewFilter}
        showClosedTickets={showClosedTickets}
        onClear={clearTicketFilters}
      />

      <div
        className={[
          'support-grid',
          isMobile ? 'is-mobile' : '',
          isMobile && !isRightPanelCollapsed ? 'right-open' : '',
          isMobile && selectedTicket ? 'has-selected' : '',
        ].filter(Boolean).join(' ')}
      >
        <SupportTicketList
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
          showOtherAgents={showOtherAgents}
          setShowOtherAgents={setShowOtherAgents}
          showClosedTickets={showClosedTickets}
          setShowClosedTickets={setShowClosedTickets}
        />

        <div className="support-details-panel">
          {selectedTicket ? (
            <div className="support-details-split">
              <div className="support-main-column">
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
                  insertQuickReply={insertQuickReply}
                  messageText={messageText}
                  setMessageText={setMessageText}
                  quickReplySlashOpen={quickReplySlashOpen}
                  quickReplySlashResults={quickReplySlashResults}
                  slashMenuMode={slashMenuMode}
                  slashCommandResults={slashCommandResults}
                  slashMenuCursorIndex={slashMenuCursorIndex}
                  onSelectSlashItem={handleSelectSlashItem}
                  onHoverSlashItem={handleHoverSlashItem}
                  onComposerKeyDown={handleComposerKeyDown}
                  formatTicketStatus={formatTicketStatus}
                  handleSendMessage={handleSendMessage}
                  handleClose={handleClose}
                />
              </div>

              <SupportDetailsSidebar
                isMobile={isMobile}
                isRightPanelCollapsed={isRightPanelCollapsed}
                setIsRightPanelCollapsed={setIsRightPanelCollapsed}
              >
                <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ fontWeight: 700 }}>Contato</div>
                    <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', border: '1px solid rgb(221, 221, 221)', background: getModeLabel(selectedTicket.mode).bg, color: getModeLabel(selectedTicket.mode).fg }}>
                      {getModeLabel(selectedTicket.mode).label}
                    </span>
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    <div>👤 <strong>{getContactName(selectedTicket)}</strong></div>
                    <div>📞 <strong>{getPhoneNode(selectedTicket)}</strong></div>
                    <div>Fila: <strong>{selectedTicket.queue || 'default'}</strong></div>
                    <div>Status: <strong>{formatTicketStatus(selectedTicket.status)}</strong></div>
                    <div>Canal: <strong>{selectedTicket.channel || 'whatsapp'}</strong></div>
                    <div>ID da conversa: <code>{selectedTicket.conversationId || '—'}</code></div>
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
                      (() => {
                        const summaryText = typeof aiSummary?.text === 'string' ? aiSummary.text : '';
                        const generatedAt = aiSummary?.generatedAt ? formatDate(aiSummary.generatedAt) : null;
                        const generatedBy = aiSummary?.generatedBy?.username || aiSummary?.generatedBy?.id || 'IA';

                        if (!summaryText) {
                          return (
                            <pre style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                              {safeStringify(aiSummary, 3000)}
                            </pre>
                          );
                        }

                        return (
                          <>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                              {summaryText}
                            </div>
                            {(generatedAt || generatedBy) ? (
                              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                                {generatedAt ? `Gerado em ${generatedAt}` : ''}
                                {generatedAt && generatedBy ? ' • ' : ''}
                                {generatedBy ? `por ${generatedBy}` : ''}
                              </div>
                            ) : null}
                          </>
                        );
                      })()
                    )
                  ) : (
                    <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
                      Sem resumo gerado para este ticket.
                    </div>
                  )}
                </div>

                <SupportResolvedEntityCard identity={evidenceHistory.identity} loading={evidenceLoading} />

                <SupportEvidenceCard
                  evidenceResult={evidenceHistory.evidence}
                  loading={evidenceLoading}
                  formatDate={formatDate}
                  onOpenSource={handleOpenEvidenceSource}
                  onCopyEvidence={handleCopyEvidence}
                  onUseAsReply={handleUseEvidenceAsReply}
                />

                <SupportSuggestedReplyCard suggestedReply={suggestedReply} />

                <SupportHistoryCard
                  timeline={evidenceHistory.timeline || []}
                  loading={evidenceLoading}
                  formatDate={formatDate}
                  onOpenItem={handleOpenTimelineItem}
                />

                <SupportCard id="support-section-entities" title="Entidades" subtitle="Itens extraídos automaticamente da conversa">
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
                          <div>
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
                </SupportCard>

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
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
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
                    <Button onClick={handleAddTag} style={{ width: 'auto' }}>Adicionar</Button>
                  </div>
                </div>

                {Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 ? (
                  <SupportCard id="support-section-handover" title="Handover & atribuições" subtitle="Transições recentes do atendimento">
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
                  </SupportCard>
                ) : (
                  null
                )}

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
                          {ev?.payload ? <div style={{ marginTop: '4px', color: 'var(--color-text-tertiary)' }}>{typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)}</div> : null}
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--color-text-tertiary)' }}>Sem eventos registrados para este ticket.</div>
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
                            {l.details ? (
                              <span style={{ color: 'var(--color-text-tertiary)' }}>
                                {' • '}
                                {typeof l.details === 'string'
                                  ? l.details
                                  : Object.entries(l.details)
                                      .filter(([, v]) => v != null)
                                      .map(([k, v]) => `${k}: ${v}`)
                                      .join(' • ')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ))}
                  </div>
                </div>
              </SupportDetailsSidebar>
            </div>
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

      {scheduleContextTicket?.id ? (
        <ScheduleModal
          isOpen={!!scheduleContextTicket}
          onClose={() => setScheduleContextTicket(null)}
          contextType="ticket"
          contextId={String(scheduleContextTicket.id)}
          contactId={String(scheduleContextTicket.contactId || '')}
          conversationId={String(scheduleContextTicket.conversationId || '')}
          defaultPurpose="retorno"
          defaultChannel="internal"
          title={`Agendar para ticket: ${scheduleContextTicket.id}`}
          lockReferences
          onCreated={() => showToast('Agendamento criado', 'success')}
        />
      ) : null}

      {mediaModal.isOpen ? (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-media-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeMediaModal();
            }
          }}
        >
          <div className="support-modal-content" onClick={(event) => event.stopPropagation()}>
            <h2 id="support-media-modal-title" style={{ marginTop: 0 }}>Abrir mídia</h2>
            <div style={{ marginBottom: '10px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              <strong>{mediaModal.title || 'Mídia'}</strong>
              {mediaModal.mimeType ? <span>{` • ${mediaModal.mimeType}`}</span> : null}
            </div>

            {mediaModal.failed ? (
              <div style={{ padding: '12px', border: '1px solid var(--color-border-default)', borderRadius: '10px', marginBottom: '12px' }}>
                Não foi possível carregar a mídia com os caminhos disponíveis.
              </div>
            ) : null}

            {!mediaModal.failed && activeMediaUrl ? (
              <div style={{ marginBottom: '12px' }}>
                {mediaModal.type === 'image' ? (
                  <img
                    src={activeMediaUrl}
                    alt={mediaModal.title || 'Imagem'}
                    onError={handleMediaRenderError}
                    style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: '10px', border: '1px solid var(--color-border-default)' }}
                  />
                ) : null}
                {mediaModal.type === 'audio' || mediaModal.type === 'voice' ? (
                  <audio controls src={activeMediaUrl} onError={handleMediaRenderError} style={{ width: '100%' }} />
                ) : null}
                {mediaModal.type === 'video' ? (
                  <video controls src={activeMediaUrl} onError={handleMediaRenderError} style={{ width: '100%', maxHeight: '65vh', borderRadius: '10px' }} />
                ) : null}
                {mediaModal.type !== 'image' && mediaModal.type !== 'audio' && mediaModal.type !== 'voice' && mediaModal.type !== 'video' ? (
                  <iframe
                    title="Visualização do documento"
                    src={activeMediaUrl}
                    onError={handleMediaRenderError}
                    style={{ width: '100%', minHeight: '65vh', border: '1px solid var(--color-border-default)', borderRadius: '10px' }}
                  />
                ) : null}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              {activeMediaUrl ? (
                <a
                  href={activeMediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    border: '1px solid var(--color-border-default)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    textDecoration: 'none',
                    color: 'var(--color-text-primary)',
                    background: 'var(--color-bg-secondary)',
                  }}
                >
                  Abrir em nova aba
                </a>
              ) : null}
              <Button type="button" onClick={closeMediaModal} style={{ width: 'auto' }}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </CrudPageBase>
  );
}
