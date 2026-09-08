import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { listQueues } from '../api/tickets';
import { usePhoneMasking } from '../hooks/usePhoneMasking';
import { MaskedPhone } from '../components/MaskedPhone';
import {
  listInboxConversations,
  getInboxConversation,
  getInboxConversationIntelligence,
  replyInboxConversation,
  assignInboxConversation,
  transferInboxConversation,
  addInboxNote,
  createCaseFromConversation,
  setInboxConversationStatus,
} from '../api/inbox';
import { applyTenantRecommendation } from '../api/intelligence';
import { createWorkspaceTask } from '../api/workspace';
import {
  describeExecutedAction,
  describeActionSignal,
  describeOutcomeReason,
  executedActionToneClass,
} from '../modules/intelligence/executionFeedback';
import { SuggestionMeta, SuggestionExpectedOutcome } from '../modules/workspace/WorkspaceActions';
import { listQuickReplies, useQuickReply } from '../api/quickReplies';
import { operatorCallback, fetchRecordingFile } from '../api/pbx';
import { getAgentNameById } from '../api/auth';
import logger from '../utils/logger';
import { useIncrementalList, useLoadMoreSentinel } from '../hooks/useIncrementalList';
import { useIsMobile } from '../hooks/useIsMobile';
import { useWebSocketContext } from '../context/WebSocketContext';
import { CrudPageBase } from '../modules/crud-base';
import { enqueueReply, flushOutbox, pendingCount, failedCount, generateClientMessageId } from '../pwa/inboxOutbox';
import { InstallPwaPrompt } from '../components/InstallPwaPrompt';

/**
 * Player da gravação de uma chamada: o áudio exige auth, então o download
 * (blob) só acontece quando o operador clica em "Ouvir gravação".
 */
function CallRecordingPlayer({ recordingId }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const handleLoad = async (event) => {
    event.stopPropagation();
    if (loading || audioUrl) return;
    setLoading(true);
    setFailed(false);
    try {
      const blob = await fetchRecordingFile(recordingId);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      logger.warn('[Inbox] Falha ao carregar gravação da chamada', err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (audioUrl) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio controls src={audioUrl} className="inbox-media-audio" data-testid="call-recording-player" style={{ marginTop: '8px' }} />
    );
  }
  return (
    <div style={{ marginTop: '8px' }}>
      <Button size="sm" variant="ghost" onClick={handleLoad} disabled={loading} aria-label="Ouvir gravação da chamada">
        {loading ? 'Carregando áudio…' : failed ? 'Gravação indisponível — tentar de novo' : '🎧 Ouvir gravação'}
      </Button>
    </div>
  );
}

export function InboxPage() {
  const { isAuthenticated, loading: authLoading, agent, capabilities } = useAuth();
  // Capability do tenant: atendimento com chamados (SLA, filas, prioridade).
  const caseManagementEnabled = capabilities?.caseManagement === true;
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { enabled: phoneMaskingEnabled } = usePhoneMasking();

  const storageKey = 'inboxFilters';

  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open');
  const [queueFilter, setQueueFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [assignedFilterDebounced, setAssignedFilterDebounced] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [slaMaxMinutes, setSlaMaxMinutes] = useState('');
  const [prioritizeSla, setPrioritizeSla] = useState(false);
  const [assignInput, setAssignInput] = useState('');
  const [transferQueue, setTransferQueue] = useState('');
  const [transferAssigned, setTransferAssigned] = useState('');
  const [noteText, setNoteText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [outboxPending, setOutboxPending] = useState(() => pendingCount());
  const [outboxFailed, setOutboxFailed] = useState(() => failedCount());
  const [creatingCase, setCreatingCase] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueryDebounced, setSearchQueryDebounced] = useState('');
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const [quickRepliesLoading, setQuickRepliesLoading] = useState(false);
  const [intelligence, setIntelligence] = useState(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);
  const isMobile = useIsMobile();

  // Cache id→nome de atendente e sequência para descartar respostas obsoletas
  const agentNameCacheRef = useRef(new Map());
  const loadTicketsSeqRef = useRef(0);
  const selectedTicketIdRef = useRef(null);
  const ticketsRef = useRef([]);
  const loadTicketsRef = useRef(null);
  const loadMessagesRef = useRef(null);
  const replyTextareaRef = useRef(null);

  // Debounce do filtro "Atendente": evita refetch de 500 conversas a cada tecla
  useEffect(() => {
    const timeout = setTimeout(() => setAssignedFilterDebounced(assignedFilter), 400);
    return () => clearTimeout(timeout);
  }, [assignedFilter]);

  // Debounce da busca livre: envia `q` server-side após ~300ms sem teclas
  useEffect(() => {
    const timeout = setTimeout(() => setSearchQueryDebounced(searchQuery.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const statusOptions = useMemo(() => [
    { value: 'open', label: 'Abertos (waiting + in_progress)' },
    { value: 'waiting', label: 'Aguardando' },
    { value: 'in_progress', label: 'Em atendimento' },
    { value: 'closed', label: 'Fechados' },
  ], []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.statusFilter === 'string') setStatusFilter(parsed.statusFilter);
        if (typeof parsed.queueFilter === 'string') setQueueFilter(parsed.queueFilter);
        if (typeof parsed.assignedFilter === 'string') setAssignedFilter(parsed.assignedFilter);
        if (typeof parsed.tagFilter === 'string') setTagFilter(parsed.tagFilter);
        if (typeof parsed.channelFilter === 'string') setChannelFilter(parsed.channelFilter);
        if (typeof parsed.slaMaxMinutes === 'string') setSlaMaxMinutes(parsed.slaMaxMinutes);
      }
    } catch (err) {
      logger.warn('[Inbox] Falha ao carregar filtros do localStorage', err);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        statusFilter,
        queueFilter,
        assignedFilter,
        tagFilter,
        channelFilter,
        slaMaxMinutes,
        prioritizeSla,
      }));
    } catch (err) {
      logger.warn('[Inbox] Falha ao salvar filtros no localStorage', err);
    }
  }, [assignedFilter, channelFilter, prioritizeSla, queueFilter, slaMaxMinutes, statusFilter, tagFilter]);

  const loadQueues = useCallback(async () => {
    try {
      const data = await listQueues();
      const list = Array.isArray(data) ? data : (data?.queues || []);
      setQueues(list);
    } catch (err) {
      logger.warn('[Inbox] Falha ao carregar filas', err);
    }
  }, []);

  const resolveAssignedToDisplay = useCallback(async (ticketList = []) => {
    const list = Array.isArray(ticketList) ? ticketList : [];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = Array.from(new Set(
      list
        .map((ticket) => String(ticket?.assignedTo || '').trim())
        .filter((value) => uuidRegex.test(value))
    ));

    const resolvedById = {};
    const idsToFetch = ids.filter((id) => !agentNameCacheRef.current.has(id));
    await Promise.all(idsToFetch.map(async (id) => {
      try {
        const resp = await getAgentNameById(id);
        const name = String(resp?.agent?.name || '').trim();
        agentNameCacheRef.current.set(id, name || id);
      } catch {
        agentNameCacheRef.current.set(id, id);
      }
    }));
    ids.forEach((id) => {
      resolvedById[id] = agentNameCacheRef.current.get(id);
    });

    return list.map((ticket) => {
      const raw = String(ticket?.assignedTo || '').trim();
      return {
        ...ticket,
        assignedToDisplay: resolvedById[raw] || raw,
      };
    });
  }, []);

  const loadTickets = useCallback(async () => {
    const seq = ++loadTicketsSeqRef.current;
    setLoading(true);
    try {
      const data = await listInboxConversations({
        status: statusFilter === 'open' ? undefined : statusFilter,
        channelType: channelFilter || undefined,
        q: searchQueryDebounced || undefined,
        limit: 500,
        offset: 0,
      });
      if (seq !== loadTicketsSeqRef.current) return; // resposta obsoleta (filtro mudou)
      // Contrato novo: { conversations, total }
      const list = Array.isArray(data?.conversations) ? data.conversations : (Array.isArray(data?.tickets) ? data.tickets : []);
      const listWithDisplay = await resolveAssignedToDisplay(list);
      if (seq !== loadTicketsSeqRef.current) return; // resposta obsoleta (filtro mudou)
      setTickets(listWithDisplay);
      if (selectedTicket) {
        const updated = listWithDisplay.find((t) => t.id === selectedTicket.id) || selectedTicket;
        setSelectedTicket(updated);
      }
    } catch (err) {
      if (seq !== loadTicketsSeqRef.current) return;
      logger.error('[Inbox] Erro ao carregar conversas', err);
      showToast('Erro ao carregar conversas do inbox', 'error');
    } finally {
      if (seq === loadTicketsSeqRef.current) {
        setLoading(false);
      }
    }
  }, [channelFilter, resolveAssignedToDisplay, searchQueryDebounced, selectedTicket, showToast, statusFilter]);

  const loadMessages = useCallback(async (ticketId) => {
    if (!ticketId) {
      setMessages([]);
      setNotes([]);
      return;
    }
    try {
      // Contrato novo: GET /inbox/conversations/:id → { conversation, messages, notes }
      const data = await getInboxConversation(ticketId);
      if (Array.isArray(data)) {
        setMessages(data);
        setNotes([]);
      } else {
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
        // Notas internas: primeira classe no payload; fallback para
        // metadata.notes da conversa (persistência de conversa sem ticket).
        const apiNotes = Array.isArray(data?.notes)
          ? data.notes
          : (Array.isArray(data?.conversation?.metadata?.notes) ? data.conversation.metadata.notes : []);
        setNotes(apiNotes);
      }
    } catch (err) {
      logger.error('[Inbox] Erro ao carregar mensagens', err);
      // Não adicionar showToast em dependency - usar diretamente
      try {
        showToast('Erro ao carregar mensagens da conversa', 'error');
      } catch (toastErr) {
        console.error('Erro ao exibir toast:', toastErr);
      }
      setMessages([]);
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      if (caseManagementEnabled) {
        loadQueues();
      }
      loadTickets();
    }
  }, [authLoading, isAuthenticated, caseManagementEnabled]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadTickets();
    }
  }, [authLoading, channelFilter, isAuthenticated, searchQueryDebounced, statusFilter]);

  useEffect(() => {
    if (selectedTicket?.id) {
      loadMessages(selectedTicket.id);
    } else {
      setMessages([]);
      setNotes([]);
    }
  }, [loadMessages, selectedTicket]);

  useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?.id || null;
  }, [selectedTicket?.id]);

  // Inteligência da conversa (NBA + resultados recentes): carregada ao abrir
  // a conversa, com guarda contra resposta obsoleta ao trocar de conversa.
  useEffect(() => {
    const conversationId = selectedTicket?.id;
    if (!conversationId) {
      setIntelligence(null);
      return;
    }
    let cancelled = false;
    getInboxConversationIntelligence(conversationId)
      .then((result) => {
        if (!cancelled && selectedTicketIdRef.current === conversationId) {
          setIntelligence(result || null);
        }
      })
      .catch((err) => {
        logger.warn('[Inbox] Falha ao carregar inteligência da conversa', err);
        if (!cancelled && selectedTicketIdRef.current === conversationId) {
          setIntelligence(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedTicket?.id]);

  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);

  // Realtime: eventos de conversa no canal do tenant (sem polling).
  const handleConversationEvent = useCallback((event, data) => {
    if (!data || !data.conversationId) return;
    const conversationId = data.conversationId;

    if (event === 'conversation.message.received') {
      const message = data.message;
      const isOutbound = message?.direction === 'out';
      const isOpen = selectedTicketIdRef.current === conversationId;

      if (isOpen && message) {
        setMessages((prev) => (message.id && prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }

      const known = ticketsRef.current.some((t) => t.id === conversationId);
      if (known) {
        setTickets((prev) => {
          const current = prev.find((t) => t.id === conversationId);
          if (!current) return prev;
          const updated = {
            ...current,
            lastMessage: message ? {
              text: message.text ?? message.body?.text ?? null,
              type: message.type || message.body?.type || current.lastMessage?.type || 'text',
              direction: message.direction || current.lastMessage?.direction,
              createdAt: message.createdAt || current.lastMessage?.createdAt,
            } : current.lastMessage,
            lastMessageAt: message?.createdAt || current.lastMessageAt,
            unreadCount: isOpen || isOutbound ? 0 : Number(current.unreadCount || 0) + 1,
          };
          return [updated, ...prev.filter((t) => t.id !== conversationId)];
        });
      } else {
        // Conversa fora da lista atual (filtros/busca): recarga silenciosa
        loadTicketsRef.current?.();
      }
      return;
    }

    if (event === 'conversation.updated') {
      setTickets((prev) => prev.map((t) => (t.id === conversationId
        ? { ...t, status: data.status ?? t.status, assignedTo: data.assignedTo ?? t.assignedTo }
        : t)));
      setSelectedTicket((prev) => (prev?.id === conversationId
        ? { ...prev, status: data.status ?? prev.status, assignedTo: data.assignedTo ?? prev.assignedTo }
        : prev));
      // Insight de transcrição de ligação: recarrega a thread aberta para
      // exibir o insight na mensagem de chamada (Voice → timeline).
      if (data.transcriptInsight && selectedTicketIdRef.current === conversationId) {
        loadMessagesRef.current?.(conversationId);
      }
    }
  }, []);

  useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: handleConversationEvent,
    subscribeEvents: ['conversation.message.received', 'conversation.updated'],
  });

  // Deep-link: /inbox?conversationId=<id> abre a conversa diretamente.
  // O useRouter expõe apenas o pathname; o query string é lido de
  // window.location e reativo ao evento 'router:change' disparado pelo navigate().
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  useEffect(() => {
    const updateSearch = () => setLocationSearch(window.location.search);
    window.addEventListener('popstate', updateSearch);
    window.addEventListener('router:change', updateSearch);
    return () => {
      window.removeEventListener('popstate', updateSearch);
      window.removeEventListener('router:change', updateSearch);
    };
  }, []);

  const deepLinkConversationId = useMemo(() => {
    const id = new URLSearchParams(locationSearch).get('conversationId');
    return id ? String(id) : null;
  }, [locationSearch]);

  useEffect(() => {
    if (!deepLinkConversationId || authLoading || !isAuthenticated) return undefined;
    if (selectedTicketIdRef.current === deepLinkConversationId) return undefined;
    let cancelled = false;
    // O GET de detalhe também zera o unread da conversa no backend
    getInboxConversation(deepLinkConversationId)
      .then((data) => {
        if (cancelled) return;
        const conversation = data?.conversation && typeof data.conversation === 'object' ? data.conversation : null;
        if (!conversation?.id) {
          showToast('Conversa não encontrada', 'error');
          return;
        }
        setSelectedTicket(conversation);
        setAssignInput('');
        setTransferQueue('');
        setTransferAssigned('');
        setNoteText('');
        setReplyText('');
        setQuickRepliesOpen(false);
        setTickets((prev) => prev.map((t) => (t.id === conversation.id ? { ...t, unreadCount: 0 } : t)));
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('[Inbox] Falha ao abrir conversa via deep-link', err);
        const notFound = err?.status === 404 || err?.response?.status === 404;
        showToast(notFound ? 'Conversa não encontrada' : 'Erro ao abrir conversa', 'error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, deepLinkConversationId, isAuthenticated]);

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const handleSelectTicket = (ticket) => {
    setSelectedTicket(ticket);
    setAssignInput('');
    setTransferQueue('');
    setTransferAssigned('');
    setNoteText('');
    setReplyText('');
    setQuickRepliesOpen(false);
  };

  const getSlaMinutes = useCallback((ticket) => {
    if (!ticket) return null;
    if (Number.isFinite(ticket.waitingTimeSeconds)) {
      return ticket.waitingTimeSeconds / 60;
    }
    const createdAt = ticket.createdAt ? new Date(ticket.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAt)) return null;
    if (ticket.firstResponseAt) {
      const first = new Date(ticket.firstResponseAt).getTime();
      if (Number.isFinite(first)) {
        return Math.max(0, (first - createdAt) / 60000);
      }
    }
    const now = Date.now();
    return Math.max(0, (now - createdAt) / 60000);
  }, []);

  const filteredTickets = useMemo(() => {
    let list = Array.isArray(tickets) ? [...tickets] : [];

    if (tagFilter.trim()) {
      const tag = tagFilter.trim().toLowerCase();
      list = list.filter((t) => Array.isArray(t.tags) && t.tags.some((x) => String(x).toLowerCase().includes(tag)));
    }

    // Filtros de chamado (atendente, fila, SLA) só fazem sentido com caseManagement
    if (caseManagementEnabled && assignedFilterDebounced.trim()) {
      const term = assignedFilterDebounced.trim().toLowerCase();
      list = list.filter((t) => String(t.assignedToDisplay || t.assignedTo || '').toLowerCase().includes(term));
    }

    if (caseManagementEnabled && queueFilter) {
      list = list.filter((t) => String(t.queue || '') === queueFilter);
    }

    if (caseManagementEnabled && slaMaxMinutes.trim()) {
      const maxMin = Number(slaMaxMinutes);
      if (Number.isFinite(maxMin) && maxMin >= 0) {
        list = list.filter((t) => {
          const slaMin = getSlaMinutes(t);
          if (!Number.isFinite(slaMin)) return true;
          return slaMin <= maxMin;
        });
      }
    }

    return list;
  }, [assignedFilterDebounced, caseManagementEnabled, getSlaMinutes, queueFilter, slaMaxMinutes, tagFilter, tickets]);

  const displayedTickets = useMemo(() => {
    if (!caseManagementEnabled || !prioritizeSla) return filteredTickets;
    return [...filteredTickets].sort((a, b) => {
      const aExceeded = isSlaExceeded(a) ? 1 : 0;
      const bExceeded = isSlaExceeded(b) ? 1 : 0;
      if (aExceeded !== bExceeded) return bExceeded - aExceeded;
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [caseManagementEnabled, filteredTickets, prioritizeSla]);

  // Lista pode chegar a 500 conversas: renderiza em blocos de 200
  // (IntersectionObserver + botão manual como fallback).
  const {
    visibleItems: visibleTickets,
    hasMore: hasMoreTickets,
    loadMore: loadMoreTickets,
    visibleCount: visibleTicketCount,
    totalCount: totalTicketCount,
  } = useIncrementalList(displayedTickets, { batchSize: 200 });
  const ticketListSentinelRef = useLoadMoreSentinel({ enabled: hasMoreTickets, onLoadMore: loadMoreTickets });

  // Timeline de mensagens: mostra as últimas 200 e revela blocos anteriores
  // no topo (a API não pagina, então o recorte é client-side).
  const {
    visibleItems: visibleMessages,
    hasMore: hasMoreMessages,
    loadMore: loadMoreMessages,
  } = useIncrementalList(messages, { batchSize: 200, fromEnd: true });

  const handleAssign = async () => {
    if (!selectedTicket) return;
    try {
      const updated = await assignInboxConversation(selectedTicket.id, assignInput || undefined);
      setSelectedTicket(updated);
      await loadTickets();
      showToast('Ticket atribuído com sucesso', 'success');
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao atribuir ticket';
      showToast(message, 'error');
    }
  };

  const handleReply = async () => {
    if (!selectedTicket) return;
    if (!replyText.trim()) {
      showToast('Digite uma resposta antes de enviar', 'warning');
      return;
    }
    // Um clientMessageId por mensagem composta: se a rede cair (inclusive após
    // o servidor processar), o retry — manual ou via outbox — usa a mesma
    // chave e o servidor deduplica.
    const clientMessageId = generateClientMessageId();
    try {
      await replyInboxConversation(selectedTicket.id, replyText, clientMessageId);
      setReplyText('');
      await loadMessages(selectedTicket.id);
      showToast('Resposta enviada', 'success');
    } catch (err) {
      // Erro sem status HTTP = falha de rede/timeout (fetchJson nunca seta
      // `.response`; erros HTTP carregam `status`/`httpStatus`). Timeout ou
      // resposta perdida após o servidor processar também cai aqui — o retry
      // com o mesmo clientMessageId é deduplificado pelo servidor.
      const isNetworkFailure = err?.status == null && err?.httpStatus == null;
      if (isNetworkFailure) {
        enqueueReply({ conversationId: selectedTicket.id, body: replyText, clientMessageId });
        setReplyText('');
        setOutboxPending(pendingCount());
        showToast('Sem conexão — a resposta será enviada automaticamente quando a rede voltar', 'warning');
        return;
      }
      const message = err?.body?.error?.message || err?.message || 'Erro ao enviar resposta';
      showToast(message, 'error');
    }
  };

  // Outbox offline: ao recuperar a conexão (ou ao abrir a página já online
  // com pendências), reenvia as respostas enfileiradas e recarrega a thread.
  useEffect(() => {
    let cancelled = false;
    const flush = async () => {
      if (pendingCount() === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        if (!cancelled) {
          setOutboxPending(pendingCount());
          setOutboxFailed(failedCount());
        }
        return;
      }
      const { sent, remaining, failed } = await flushOutbox(replyInboxConversation);
      if (cancelled) return;
      setOutboxPending(remaining);
      setOutboxFailed(failed);
      if (sent > 0) {
        showToast(`${sent} resposta(s) pendente(s) enviada(s)`, 'success');
        if (selectedTicketIdRef.current) {
          await loadMessages(selectedTicketIdRef.current);
        }
      }
    };
    window.addEventListener('online', flush);
    flush();
    return () => {
      cancelled = true;
      window.removeEventListener('online', flush);
    };
  }, [loadMessages, showToast]);

  const reloadIntelligence = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      const result = await getInboxConversationIntelligence(conversationId);
      if (selectedTicketIdRef.current === conversationId) {
        setIntelligence(result || null);
      }
    } catch (err) {
      logger.warn('[Inbox] Falha ao recarregar inteligência da conversa', err);
    }
  }, []);

  // Executa a Next Best Action sem sair da conversa: send_message foca o
  // composer (a conversa já está aberta); create_task/schedule criam a ação
  // operacional no Workspace da entidade vinculada.
  const handleExecuteIntelligenceSuggestion = async () => {
    const suggestion = intelligence?.suggestion;
    const action = suggestion?.action;
    if (!suggestion || !action?.kind || intelligenceBusy) return;

    if (action.kind === 'send_message') {
      replyTextareaRef.current?.focus();
      replyTextareaRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    if (!intelligence.entityId) {
      showToast('Ação indisponível — conversa sem cliente vinculado', 'warning');
      return;
    }

    setIntelligenceBusy(true);
    try {
      if (action.kind === 'schedule') {
        await createWorkspaceTask({
          entityId: intelligence.entityId,
          title: action.label || suggestion.label,
          description: suggestion.reason || undefined,
          dueDate: action.dueDate || undefined,
          type: 'followup',
        });
        showToast('Follow-up agendado no Workspace.', 'success');
      } else {
        await createWorkspaceTask({
          entityId: intelligence.entityId,
          title: action.label || suggestion.label,
          description: suggestion.reason || undefined,
          type: 'manual',
        });
        showToast('Tarefa criada no Workspace.', 'success');
      }
      await reloadIntelligence(selectedTicket?.id);
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Não foi possível executar a ação';
      showToast(message, 'error');
    } finally {
      setIntelligenceBusy(false);
    }
  };

  const handleApplyIntelligenceRecommendation = async () => {
    const recommendation = intelligence?.tenantRecommendation;
    if (!recommendation?.id || intelligenceBusy) return;
    setIntelligenceBusy(true);
    try {
      const result = await applyTenantRecommendation(recommendation.id);
      const execution = result?.execution
        || result?.recommendation?.metadata?.application?.executedAction
        || null;
      const feedback = describeExecutedAction(execution);
      if (feedback) {
        showToast(
          feedback.tone === 'success' ? `Recomendação aplicada — ${feedback.message}` : feedback.message,
          feedback.tone === 'success' ? 'success' : 'warning',
        );
      } else {
        showToast('Recomendação aplicada.', 'success');
      }
      await reloadIntelligence(selectedTicket?.id);
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Não foi possível aplicar a recomendação';
      showToast(message, 'error');
    } finally {
      setIntelligenceBusy(false);
    }
  };

  const handleCreateCase = async () => {
    if (!selectedTicket || !caseManagementEnabled) return;
    setCreatingCase(true);
    try {
      const result = await createCaseFromConversation(selectedTicket.id, {});
      showToast(`Chamado criado: ${result?.case?.id || 'ok'}`, 'success');
    } catch (err) {
      if (err?.status === 403 && err?.body?.error === 'capability_disabled') {
        showToast('Case Management não está ativo para este tenant', 'warning');
      } else {
        const message = err?.response?.data?.message || err?.message || 'Erro ao criar chamado';
        showToast(message, 'error');
      }
    } finally {
      setCreatingCase(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedTicket) return;
    if (caseManagementEnabled && !transferQueue) {
      showToast('Informe a fila para transferir', 'warning');
      return;
    }
    try {
      const updated = await transferInboxConversation(selectedTicket.id, {
        queue: caseManagementEnabled ? transferQueue : undefined,
        assigneeId: transferAssigned ? transferAssigned : undefined,
      });
      setSelectedTicket(updated);
      await loadTickets();
      showToast('Ticket transferido com sucesso', 'success');
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao transferir ticket';
      showToast(message, 'error');
    }
  };

  const handleAddNote = async () => {
    if (!selectedTicket) return;
    if (!noteText.trim()) {
      showToast('Digite uma nota antes de salvar', 'warning');
      return;
    }
    try {
      // POST /notes retorna apenas { ok: true } (contrato do módulo); a nota
      // é relida via GET da conversa (notes first-class no payload).
      await addInboxNote(selectedTicket.id, noteText);
      setNoteText('');
      await loadMessages(selectedTicket.id);
      showToast('Nota adicionada', 'success');
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao adicionar nota';
      showToast(message, 'error');
    }
  };

  const handleStatusChange = async (nextStatus) => {
    if (!selectedTicket) return;
    try {
      const result = await setInboxConversationStatus(selectedTicket.id, nextStatus);
      const updatedConversation = result?.conversation || { status: nextStatus };
      setSelectedTicket((prev) => (prev ? { ...prev, ...updatedConversation } : prev));
      setTickets((prev) => prev.map((t) => (t.id === selectedTicket.id ? { ...t, ...updatedConversation } : t)));
      showToast(nextStatus === 'resolved' ? 'Conversa resolvida' : 'Conversa reaberta', 'success');
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao atualizar status da conversa';
      showToast(message, 'error');
    }
  };

  const loadQuickReplies = useCallback(async () => {
    setQuickRepliesLoading(true);
    try {
      const resp = await listQuickReplies({ activeOnly: true });
      const list = Array.isArray(resp) ? resp : (resp?.quickReplies || []);
      setQuickReplies(list.slice(0, 12));
    } catch (err) {
      logger.warn('[Inbox] Falha ao carregar respostas rápidas', err);
      setQuickReplies([]);
    } finally {
      setQuickRepliesLoading(false);
    }
  }, []);

  const handleToggleQuickReplies = () => {
    setQuickRepliesOpen((prev) => {
      const next = !prev;
      if (next && quickReplies.length === 0) {
        loadQuickReplies();
      }
      return next;
    });
  };

  const handleSelectQuickReply = (reply) => {
    const text = String(reply?.message || reply?.content || '').trim();
    if (text) {
      // Insere no composer sem enviar; preserva o que o atendente já digitou
      setReplyText((prev) => (prev ? `${prev}\n${text}` : text));
    }
    setQuickRepliesOpen(false);
    if (reply?.id) {
      // Analytics de uso (best-effort)
      useQuickReply(reply.id).catch(() => {});
    }
  };

  const formatDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  };

  const formatTime = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
  };

  const formatTicketStatus = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'in_progress') return 'Em atendimento';
    if (normalized === 'waiting') return 'Aguardando';
    if (normalized === 'pending') return 'Pendente';
    if (normalized === 'resolved') return 'Resolvido';
    if (normalized === 'closed') return 'Fechado';
    if (normalized === 'open') return 'Aberto';
    if (!normalized) return 'Aberto';
    return normalized;
  };

  const formatTicketMode = (mode) => {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'bot' || normalized === 'assistant' || normalized === 'ai') return 'Bot';
    if (!normalized || normalized === 'human' || normalized === 'agent') return 'Humano';
    return normalized;
  };

  const formatChannelLabel = (channelType) => {
    const normalized = String(channelType || '').trim().toLowerCase();
    if (normalized === 'whatsapp') return 'WhatsApp';
    if (normalized === 'messenger') return 'Messenger';
    if (normalized === 'instagram') return 'Instagram';
    if (normalized === 'webchat') return 'Webchat';
    if (normalized === 'voice') return 'Voz';
    return normalized || 'Canal';
  };

  // Voice + Digital: retorno de chamada perdida direto do card de voz.
  const returningCallRef = useRef(false);
  const handleReturnCall = async (call) => {
    if (!call?.phone || returningCallRef.current) return;
    returningCallRef.current = true;
    try {
      await operatorCallback({
        phone: call.phone,
        target: call.phone,
        note: 'Retorno de chamada perdida via Inbox',
      });
      showToast(`Retorno agendado para ${call.phone}.`, 'success');
    } catch (err) {
      if (err?.status === 403 || err?.body?.error === 'forbidden') {
        showToast('Sem permissão para agendar retorno de chamada.', 'error');
      } else {
        showToast('Não foi possível agendar o retorno de chamada.', 'error');
      }
    } finally {
      returningCallRef.current = false;
    }
  };

  const formatRelativeTime = (value) => {
    if (!value) return '-';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return '-';
    const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (diffSeconds < 60) return 'agora';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} d`;
    return formatTime(value);
  };

  const formatBadgeCount = (value) => {
    const n = Number(value || 0);
    if (n > 99) return '99+';
    return String(Math.max(0, n));
  };

  const getContactName = (ticket) => {
    const name = String(ticket?.contactName || '').trim();
    const phone = String(ticket?.phoneNumber || '').trim();
    return name || phone || 'Cliente';
  };

  const getPhoneNode = (ticket) => {
    if (!ticket?.phoneNumber) return '—';
    return <MaskedPhone phone={ticket.phoneNumber} mask={phoneMaskingEnabled} />;
  };

  const getMediaPlaceholder = (type) => {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'image') return '📷 Imagem';
    if (normalized === 'audio') return '🎧 Áudio';
    if (normalized === 'video') return '🎬 Vídeo';
    if (normalized === 'document' || normalized === 'file') return '📎 Documento';
    if (normalized === 'call') return '📞 Chamada';
    return null;
  };

  const getTicketPreview = (ticket) => {
    const lastMessage = ticket?.lastMessage;
    const text = String(lastMessage?.text || '').trim();
    const preview = text || getMediaPlaceholder(lastMessage?.type) || 'Sem mensagens';
    if (preview.length <= 80) return preview;
    return `${preview.slice(0, 79)}…`;
  };

  const getAssignedLabel = (ticket) => ticket?.assignedToDisplay || ticket?.assignedTo || 'Não atribuído';
  const getQueueLabel = (ticket) => ticket?.queue || 'Sem fila';

  const formatSla = (ticket) => {
    const minutes = getSlaMinutes(ticket);
    if (!Number.isFinite(minutes)) return '-';
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const isSlaExceeded = (ticket) => {
    const maxMin = Number(slaMaxMinutes);
    if (!Number.isFinite(maxMin) || maxMin < 0) return false;
    const minutes = getSlaMinutes(ticket);
    if (!Number.isFinite(minutes)) return false;
    return minutes > maxMin;
  };

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>📥 Caixa de Entrada</h1>
        <div className="support-controls" style={{ flexWrap: 'wrap' }}>
          <label>
            Status
            <select
              className="support-form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          {caseManagementEnabled ? (
            <label>
              Fila
              <select
                className="support-form-select"
                value={queueFilter}
                onChange={(e) => setQueueFilter(e.target.value)}
              >
                <option value="">Todas</option>
                {queues.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Atendente
            <input
              className="support-form-input"
              value={assignedFilter}
              onChange={(e) => setAssignedFilter(e.target.value)}
              placeholder="ID ou username"
            />
          </label>
          <label>
            Tag
            <input
              className="support-form-input"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="ex: vip, atraso"
            />
          </label>
          <label>
            Canal
            <select
              className="support-form-select"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="messenger">Messenger</option>
              <option value="instagram">Instagram</option>
              <option value="webchat">Webchat</option>
              <option value="voice">Voz</option>
            </select>
          </label>
          {caseManagementEnabled ? (
            <label>
              SLA máx (min)
              <input
                className="support-form-input"
                value={slaMaxMinutes}
                onChange={(e) => setSlaMaxMinutes(e.target.value)}
                placeholder="ex: 30"
              />
            </label>
          ) : null}
          {caseManagementEnabled ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox"
                checked={prioritizeSla}
                onChange={(e) => setPrioritizeSla(e.target.checked)}
              />
              Priorizar SLA estourado
            </label>
          ) : null}
          <Button onClick={loadTickets} disabled={loading} className="support-button">
            Atualizar
          </Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      <div className={`support-grid${isMobile ? ' is-mobile' : ''}${selectedTicket ? ' has-selected' : ''}`}>
        <div className="support-tickets-panel">
          <div className="inbox-search">
            <input
              className="support-form-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar conversa (nome, telefone, mensagem)"
              aria-label="Buscar conversa"
            />
          </div>
          <div className="support-tickets-list" role="list">
            {displayedTickets.length === 0 && (
              <p className="support-tickets-empty">Nenhuma conversa disponível</p>
            )}
            {visibleTickets.map((ticket) => (
              <div
                key={ticket.id}
                role="listitem"
                className={`support-ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                onClick={() => handleSelectTicket(ticket)}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectTicket(ticket)}
                tabIndex={0}
              >
                <div className="support-ticket-contact-row">
                  <span className="support-ticket-contact-name">{getContactName(ticket)}</span>
                  <span className="support-ticket-contact-phone">{getPhoneNode(ticket)}</span>
                </div>
                <div className="support-ticket-id-row">
                  <span className="support-ticket-id">#{ticket.id}</span>
                  <span className="support-ticket-mode-badge">{formatTicketMode(ticket.mode)}</span>
                  <span className="support-ticket-mode-badge">{formatChannelLabel(ticket.channelType)}</span>
                </div>
                <div className="support-ticket-top-row">
                  <div className="support-ticket-status-group">
                    <span className={`support-ticket-status ${String(ticket.status || '').toLowerCase()}`}>
                      {formatTicketStatus(ticket.status)}
                    </span>
                    <span className="support-ticket-time">{formatRelativeTime(ticket.lastMessageAt || ticket.updatedAt)}</span>
                  </div>
                  {ticket.unreadCount > 0 ? (
                    <span className="support-ticket-unread-badge">{formatBadgeCount(ticket.unreadCount)}</span>
                  ) : null}
                </div>
                <div className="support-ticket-preview">{getTicketPreview(ticket)}</div>
                <div className="support-ticket-meta-row">
                  {getAssignedLabel(ticket)} • {getQueueLabel(ticket)}
                </div>
              </div>
            ))}
            {hasMoreTickets ? (
              <div ref={ticketListSentinelRef} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={loadMoreTickets}
                  aria-label={`Carregar mais conversas (${visibleTicketCount} de ${totalTicketCount} exibidas)`}
                >
                  Carregar mais conversas ({visibleTicketCount}/{totalTicketCount})
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="support-details-panel">
          {selectedTicket ? (
            <div className="support-details-content">
              <div className="support-details-header">
                <h3 className="support-details-title">
                  {isMobile ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedTicket(null)}
                      aria-label="Voltar para a lista de conversas"
                    >
                      ← Voltar
                    </Button>
                  ) : null}
                  Conversa #{selectedTicket.id}
                </h3>
                <div style={{ color: 'var(--color-text-tertiary)' }}>
                  Status: {formatTicketStatus(selectedTicket.status)} · Fila: {selectedTicket.queue || '-'}
                </div>
                <div className="inbox-status-actions">
                  {['resolved', 'closed'].includes(String(selectedTicket.status || '').toLowerCase()) ? (
                    <Button size="sm" onClick={() => handleStatusChange('open')} className="support-button">
                      Reabrir
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => handleStatusChange('resolved')} className="support-button">
                      Resolver
                    </Button>
                  )}
                </div>
              </div>

              {intelligence && (intelligence.suggestion || intelligence.tenantRecommendation
                || (Array.isArray(intelligence.recentOutcomes) && intelligence.recentOutcomes.length > 0)) ? (
                <div className="support-details-section" data-testid="inbox-intelligence">
                  <label className="support-form-label">Inteligência da conversa</label>
                  {intelligence.suggestion ? (
                    <div className="inbox-intelligence-block">
                      <strong>{intelligence.suggestion.label}</strong>
                      <p className="support-muted">{intelligence.suggestion.reason}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <SuggestionMeta suggestion={intelligence.suggestion} />
                      </div>
                      <SuggestionExpectedOutcome suggestion={intelligence.suggestion} />
                      {intelligence.suggestion.action?.kind ? (
                        <Button
                          size="sm"
                          className="support-button-full"
                          disabled={intelligenceBusy}
                          onClick={handleExecuteIntelligenceSuggestion}
                        >
                          {intelligence.suggestion.action.label || 'Executar ação sugerida'}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {intelligence.tenantRecommendation ? (
                    <div className="inbox-intelligence-block">
                      <strong>{intelligence.tenantRecommendation.title}</strong>
                      {intelligence.tenantRecommendation.description ? (
                        <p className="support-muted">{intelligence.tenantRecommendation.description}</p>
                      ) : null}
                      <Button
                        size="sm"
                        className="support-button-full"
                        disabled={intelligenceBusy}
                        onClick={handleApplyIntelligenceRecommendation}
                      >
                        Aplicar recomendação
                      </Button>
                    </div>
                  ) : null}
                  {Array.isArray(intelligence.recentOutcomes) && intelligence.recentOutcomes.length > 0 ? (
                    <div className="inbox-intelligence-block">
                      <strong>Resultados recentes</strong>
                      {intelligence.recentOutcomes.slice(0, 2).map((item) => {
                        const execFeedback = describeExecutedAction(item.executedAction);
                        const signals = Array.isArray(item.outcome?.actionSignals) ? item.outcome.actionSignals : [];
                        return (
                          <div key={item.id} className="inbox-intelligence-outcome">
                            <span>{item.title}</span>
                            {execFeedback ? (
                              <p className={executedActionToneClass(execFeedback.tone)}>{execFeedback.message}</p>
                            ) : null}
                            {signals.map((signal, signalIndex) => {
                              const signalFeedback = describeActionSignal(signal);
                              if (!signalFeedback) return null;
                              return (
                                <p key={`${item.id}-signal-${signalIndex}`} className={executedActionToneClass(signalFeedback.tone)}>
                                  {signalFeedback.message}
                                </p>
                              );
                            })}
                            {item.outcome?.reason ? (
                              <p className="support-muted">{describeOutcomeReason(item.outcome.reason)}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="support-details-section">
                <div className="support-form-group">
                  <label className="support-form-label">Atribuir para</label>
                  <input
                    className="support-form-input"
                    value={assignInput}
                    onChange={(e) => setAssignInput(e.target.value)}
                    placeholder="ID/username (vazio = você)"
                  />
                  <Button onClick={handleAssign} className="support-button-full">Atribuir</Button>
                </div>
              </div>

              <div className="support-details-section">
                <div className="support-form-group">
                  <label className="support-form-label">Transferir</label>
                  {caseManagementEnabled ? (
                    <select
                      className="support-form-select"
                      value={transferQueue}
                      onChange={(e) => setTransferQueue(e.target.value)}
                    >
                      <option value="">Selecione a fila</option>
                      {queues.map((q) => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    className="support-form-input"
                    value={transferAssigned}
                    onChange={(e) => setTransferAssigned(e.target.value)}
                    placeholder="Atendente (opcional)"
                  />
                  <Button onClick={handleTransfer} className="support-button-full">Transferir</Button>
                </div>
              </div>

              {caseManagementEnabled ? (
                <div className="support-details-section">
                  <Button onClick={handleCreateCase} disabled={creatingCase} className="support-button-full">
                    {creatingCase ? 'Criando chamado...' : 'Criar chamado'}
                  </Button>
                </div>
              ) : null}

              <div className="support-details-section">
                <div className="support-form-group">
                  <label className="support-form-label">Responder</label>
                  <div className="inbox-quick-replies">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleToggleQuickReplies}
                      aria-label="Respostas rápidas"
                      aria-expanded={quickRepliesOpen}
                    >
                      ⚡ Respostas rápidas
                    </Button>
                    {quickRepliesOpen ? (
                      <div className="inbox-quick-replies-picker" role="menu">
                        {quickRepliesLoading ? (
                          <div className="inbox-quick-replies-empty">Carregando...</div>
                        ) : null}
                        {!quickRepliesLoading && quickReplies.length === 0 ? (
                          <div className="inbox-quick-replies-empty">Nenhuma resposta rápida cadastrada</div>
                        ) : null}
                        {quickReplies.map((reply) => (
                          <button
                            key={reply.id}
                            type="button"
                            role="menuitem"
                            className="inbox-quick-replies-item"
                            onClick={() => handleSelectQuickReply(reply)}
                          >
                            <span className="inbox-quick-replies-item-title">{reply.title || 'Resposta rápida'}</span>
                            <span className="inbox-quick-replies-item-preview">{reply.message || reply.content || ''}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {outboxPending > 0 ? (
                    <div
                      className="inbox-outbox-banner"
                      data-testid="inbox-outbox-banner"
                      role="status"
                      style={{ marginBottom: '8px', fontSize: '0.85rem', opacity: 0.9 }}
                    >
                      📤 {outboxPending} resposta(s) aguardando conexão para envio automático
                    </div>
                  ) : null}
                  {outboxFailed > 0 ? (
                    <div
                      className="inbox-outbox-banner inbox-outbox-banner-failed"
                      data-testid="inbox-outbox-failed-banner"
                      role="alert"
                      style={{ marginBottom: '8px', fontSize: '0.85rem', opacity: 0.9 }}
                    >
                      ⚠️ {outboxFailed} resposta(s) não puderam ser enviadas
                    </div>
                  ) : null}
                  <textarea
                    ref={replyTextareaRef}
                    className="support-form-textarea"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Escreva a resposta para o cliente"
                    rows={3}
                  />
                  <Button onClick={handleReply} className="support-button-full">Enviar resposta</Button>
                </div>
              </div>

              <div className="support-details-section">
                <div className="support-form-group">
                  <label className="support-form-label">Notas internas</label>
                  <textarea
                    className="support-form-textarea support-note-textarea"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Escreva uma nota interna"
                    rows={3}
                  />
                  <Button onClick={handleAddNote} className="support-button-full">Salvar nota</Button>
                </div>
                {notes.length > 0 ? (
                  <div className="support-notes-list" style={{ marginTop: '8px' }}>
                    {notes.map((note, index) => (
                      <div key={`${note.at || note.timestamp || 'note'}-${index}`} className="mb-2">
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                          {`Nota • ${note.authorUsername || note.authorName || note.author || agent?.username || 'system'}`}
                          {' · '}{formatDate(note.at || note.timestamp)}
                        </div>
                        <div style={{ color: 'var(--color-status-warning)' }}>
                          {note.note || note.text || '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="support-details-section">
                <div className="support-details-subtitle">Mensagens</div>
                <div className="support-details-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {messages.length === 0 && (
                    <div style={{ color: 'var(--color-text-tertiary)' }}>Sem mensagens</div>
                  )}
                  {hasMoreMessages ? (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadMoreMessages}
                        aria-label="Carregar mensagens anteriores"
                      >
                        Carregar mensagens anteriores
                      </Button>
                    </div>
                  ) : null}
                  {visibleMessages.map((msg) => {
                    // Contrato novo (channel_messages): { direction, body: { text, mediaUrl }, createdAt };
                    // compat legado (ledger do ticket): { sender, text, timestamp }.
                    const senderLabel = msg.sender || (msg.direction === 'out' ? 'agent' : 'customer');
                    const messageBody = msg.body || {};
                    const messageText = msg.text || messageBody.text || '';
                    const messageAt = msg.timestamp || msg.createdAt;
                    const mediaUrl = messageBody.mediaUrl || msg.mediaUrl || null;
                    const mediaType = String(messageBody.type || msg.type || '').trim().toLowerCase();
                    const mediaName = messageBody.filename || messageBody.fileName || msg.filename || 'arquivo';
                    return (
                      <div key={msg.id || messageAt} className="mb-2">
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                          {msg.sender === 'note' ? `Nota • ${msg.authorName || agent?.username || 'system'}` : senderLabel}
                          {' · '}{formatDate(messageAt)}
                        </div>
                        <div style={{ color: msg.sender === 'note' ? 'var(--color-status-warning)' : 'var(--color-text-primary)' }}>
                          {mediaType === 'call' && messageBody.call ? (
                            <div
                              data-testid="inbox-call-card"
                              className="border border-border-default rounded-lg p-3"
                              style={{ display: 'inline-block', minWidth: '240px' }}
                            >
                              <div className="font-medium text-text-primary">
                                {messageBody.call.answered
                                  ? (messageBody.call.direction === 'in' ? '📞 Chamada recebida' : '📞 Chamada realizada')
                                  : (messageBody.call.direction === 'in' ? '📵 Chamada perdida' : '📞 Chamada não atendida')}
                              </div>
                              <div className="text-text-secondary" style={{ marginTop: '2px' }}>
                                {messageBody.call.answered
                                  ? `Duração: ${Math.floor((messageBody.call.billsec || messageBody.call.durationSec || 0) / 60)} min ${(messageBody.call.billsec || messageBody.call.durationSec || 0) % 60} s`
                                  : `De ${messageBody.call.src || messageBody.call.phone || '-'}`}
                              </div>
                              {messageBody.call.direction === 'in' && !messageBody.call.answered && messageBody.call.phone ? (
                                <div style={{ marginTop: '8px' }}>
                                  <Button
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); handleReturnCall(messageBody.call); }}
                                    aria-label={`Retornar chamada para ${messageBody.call.phone}`}
                                  >
                                    Retornar chamada
                                  </Button>
                                </div>
                              ) : null}
                              {messageBody.transcription?.text ? (
                                <div
                                  className="text-text-secondary"
                                  data-testid="call-transcription"
                                  style={{
                                    marginTop: '8px',
                                    padding: '6px 8px',
                                    borderLeft: '2px solid var(--color-border-default)',
                                    fontSize: '13px',
                                    fontStyle: 'italic',
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {messageBody.transcription.text}
                                </div>
                              ) : null}
                              {messageBody.call.insight?.summary ? (
                                <div
                                  className="text-text-secondary"
                                  data-testid="call-insight"
                                  style={{ marginTop: '6px', fontSize: '13px' }}
                                >
                                  💡 {messageBody.call.insight.summary}
                                  {messageBody.call.insight.urgency === 'alta' ? ' (urgente)' : ''}
                                </div>
                              ) : null}
                              {messageBody.call.recordingId ? (
                                <CallRecordingPlayer recordingId={messageBody.call.recordingId} />
                              ) : null}
                            </div>
                          ) : null}
                          {mediaType !== 'call' && mediaUrl && mediaType === 'image' ? (
                            <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                              <img src={mediaUrl} alt={mediaName} className="inbox-media-image" />
                            </a>
                          ) : null}
                          {mediaUrl && mediaType === 'audio' ? (
                            <audio controls src={mediaUrl} className="inbox-media-audio" />
                          ) : null}
                          {mediaUrl && mediaType !== 'image' && mediaType !== 'audio' && mediaType !== 'call' ? (
                            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" download={mediaName} className="inbox-media-link">
                              📎 {mediaName}
                            </a>
                          ) : null}
                          {mediaType === 'call' && messageBody.call ? null : (messageText || (!mediaUrl ? '-' : ''))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="support-details-empty">
              <p>Selecione uma conversa para visualizar detalhes.</p>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
      <InstallPwaPrompt />
    </CrudPageBase>
  );
}
