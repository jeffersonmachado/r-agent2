import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listTicketsPaged,
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
  uploadSupportMedia,
  getTicketDeliveryFailures,
  getTicketAiSummary,
  generateTicketAiSummary,
  debugExtractEntities,
  suggestSupportTags,
  suggestSupportSentiment,
} from '../api/tickets';
import { getConversationMessages } from '../api/conversations';
import { getCategories as getQuickReplyCategories, listQuickReplies, searchQuickReplies, useQuickReply } from '../api/quickReplies';
import { listCloseReasons } from '../api/closeReasons';
import { addTagToTicket, removeTagFromTicket, getAllTags } from '../api/segmentation';
import { queryAuditLogs } from '../api/audit';
import { searchCrmContacts } from '../api/crm';
import { isTenantFeatureEnabled } from '../api/featureFlags';
import { getAgentNameById } from '../api/auth';
import {
  isWebPushSupported,
  getCurrentWebPushSubscription,
  subscribeCurrentUserWebPush,
  unsubscribeCurrentUserWebPush,
} from '../api/webPush';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { PlatformGrid } from '../modules/platform-grid';
import { Button } from '../styles/Button';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useDebounce } from '../hooks/useDebounce';
import { useInFlightGuard } from '../hooks/useInFlightGuard';
import { useLatestRef } from '../hooks/useLatestRef';
import { usePhoneMasking } from '../hooks/usePhoneMasking';
import { MaskedPhone } from '../components/MaskedPhone';
import { ScheduleModal } from '../components/ScheduleModal';
import {
  SupportConversationPane,
  SupportDetailsSidebar,
  SupportFiltersBar,
  SupportTicketList,
  SupportWorkspaceHeader,
} from '../modules/support-workspace/components';
import {
  CRMTimelinePanel,
  OperationalRecommendationsCard,
  OperationalSignalsCard,
  PlaybookExecutionModal,
  PlaybookSuggestionCard,
  useCrmOperationalProfile,
  usePlaybookExecution,
  usePlaybooks,
  useOperationalRecommendations,
  useOperationalSignals,
} from '../modules/crm';
import {
  listSchedules,
  confirmSchedule as confirmScheduleApi,
  cancelSchedule as cancelScheduleApi,
  rescheduleSchedule as rescheduleScheduleApi,
  markScheduleDone,
  markScheduleNoShow,
} from '../api/scheduling';
import {
  createAutonomousWaitingListEntry,
  listAutonomousCampaigns,
  listAutonomousRecommendations,
  runAutonomousGapDetection,
} from '../api/autonomousScheduling';
import { hasPermission } from '../utils/menuPermissions';
import { listDocuments as listRagDocuments } from '../api/ragDocuments';
import { useWebSocketStatus } from '../utils/webSocketStatusConfig';
import { getStaticUrl } from '../utils/index';
import websocketMetrics from '../utils/websocketMetrics';
import logger from '../utils/logger';

const SUPPORT_UI_FILTERS_STORAGE_KEY = 'support_ui_filters_v1';
const SUPPORT_FILTER_CHIPS = ['all', 'unread', 'waiting', 'in_progress', 'closed', 'unassigned'];

function norm(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function digits(str) {
  if (!str) return '';
  return String(str).replace(/\D/g, '');
}

function getContactName(ticket) {
  return (
    ticket?.customerName
    || ticket?.context?.metadata?.contactName
    || ticket?.context?.variables?.customerName
    || ticket?.context?.variables?.name
    || ticket?.context?.variables?.nome
    || 'Cliente'
  );
}

function getTicketContactId(ticket) {
  return String(
    ticket?.contactId
    || ticket?.context?.metadata?.contactId
    || ticket?.context?.variables?.contactId
    || ''
  ).trim();
}

function buildSearchIndex(ticket) {
  const phoneDigits = digits(ticket?.phoneNumber || '');
  const tagsText = Array.isArray(ticket?.tags)
    ? ticket.tags.map((tag) => {
      if (typeof tag === 'string') return tag;
      if (tag && typeof tag === 'object') return String(tag?.tag || tag?.name || tag?.label || '');
      return '';
    }).filter(Boolean).join(' ')
    : '';
  const parts = [
    ticket?.id,
    getContactName(ticket),
    ticket?.phoneNumber,
    phoneDigits,
    ticket?.lastUserMessage,
    ticket?.queue,
    tagsText,
  ].filter(Boolean);
  return norm(parts.join(' '));
}

function subseqMatchScore(text, query) {
  let ti = 0;
  let qi = 0;
  let hits = 0;

  while (ti < text.length && qi < query.length) {
    if (text[ti] === query[qi]) {
      hits++;
      qi++;
    }
    ti++;
  }

  return qi === query.length ? hits : 0;
}

function scoreTicket(ticket, query) {
  const q = norm(query);
  if (!q) return 1;

  const qDigits = digits(query);
  let score = 0;

  if (qDigits.length >= 3) {
    if (String(ticket?._phoneDigits || '').includes(qDigits)) score += 200;
    if (String(ticket?._phoneDigits || '').endsWith(qDigits)) score += 60;
  }

  if (String(ticket?._nameNorm || '').includes(q)) score += 120;
  if (String(ticket?._nameNorm || '').startsWith(q)) score += 40;
  if (String(ticket?._searchIndex || '').includes(q)) score += 80;

  if (score === 0) {
    const fuzzy = subseqMatchScore(String(ticket?._searchIndex || ''), q);
    if (fuzzy > 0) score += 30 + fuzzy;
  }

  return score;
}

function applySupportUiFilters(ticketsBase, options) {
  const {
    uiChip = 'all',
    uiQueue = '',
  } = options || {};

  return [...(Array.isArray(ticketsBase) ? ticketsBase : [])].filter((ticket) => {
    if (uiChip !== 'all') {
      if (uiChip === 'unread' && !(Number(ticket?.unreadCount || 0) > 0)) return false;
      if (uiChip === 'waiting' && ticket?.status !== 'waiting') return false;
      if (uiChip === 'in_progress' && ticket?.status !== 'in_progress') return false;
      if (uiChip === 'closed' && ticket?.status !== 'closed') return false;
      if (uiChip === 'unassigned' && Boolean(ticket?.assignedTo)) return false;
    }

    if (uiQueue && String(ticket?.queue || '') !== uiQueue) {
      return false;
    }
    return true;
  });
}

function applySearchRanked(tickets, query) {
  const q = String(query || '').trim();
  if (!q) return tickets;

  const scored = [];
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    const score = scoreTicket(ticket, q);
    if (score > 0) scored.push({ ticket, score, index: i });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((item) => item.ticket);
}

function highlightText(text, query) {
  if (!text || !query) return text;
  const normalizedQuery = norm(query);
  if (!normalizedQuery) return text;

  const source = String(text);
  const indexMap = [];
  let normalizedSource = '';

  for (let i = 0; i < source.length; i += 1) {
    const normalizedChar = source[i]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    for (let j = 0; j < normalizedChar.length; j += 1) {
      normalizedSource += normalizedChar[j];
      indexMap.push(i);
    }
  }

  const matchAt = normalizedSource.indexOf(normalizedQuery);
  if (matchAt < 0) return text;

  const start = indexMap[matchAt];
  const endIndex = matchAt + normalizedQuery.length - 1;
  const end = (indexMap[endIndex] ?? source.length - 1) + 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return text;

  return (
    <>
      {source.slice(0, start)}
      <mark className="rounded bg-yellow-200 px-1">{source.slice(start, end)}</mark>
      {source.slice(end)}
    </>
  );
}

/**
 * Página de atendimento para gerenciar tickets.
 * Mostra apenas tickets do usuário logado ou sem atribuição.
 * Estilo inspirado no WhatsApp.
 */
export function SupportPage() {
  const PAGE_SIZE = 30;
  const { agent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const canReadAutonomousScheduling = hasPermission(agent, 'autonomous_scheduling', 'read');
  const canRunAutonomousScheduling = hasPermission(agent, 'autonomous_scheduling', 'run');
  const canUpdateAutonomousScheduling = hasPermission(agent, 'autonomous_scheduling', 'update');

  // Estados - devem ser declarados antes de qualquer early return
  const [queues, setQueues] = useState([]);
  const [tickets, setTickets] = useState([]);
  const ticketsBase = tickets;
  const setTicketsBase = setTickets;
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [messageAttachments, setMessageAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [recordingAudioSeconds, setRecordingAudioSeconds] = useState(0);
  const [showRagAttachModal, setShowRagAttachModal] = useState(false);
  const [ragAttachSearch, setRagAttachSearch] = useState('');
  const [ragAttachLoading, setRagAttachLoading] = useState(false);
  const [ragAttachDocuments, setRagAttachDocuments] = useState([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 900px)').matches;
  });
  const [showOthers, setShowOthers] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [uiSearch, setUiSearch] = useState('');
  const [uiSearchDebounced, setUiSearchDebounced] = useState('');
  const [uiChip, setUiChip] = useState('all');
  const [uiQueue, setUiQueue] = useState('');
  const [uiContactHistoryOnly, setUiContactHistoryOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  // Auto-refresh sempre ativo quando WebSocket não está disponível
  const autoRefresh = true;
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [newConversationPhone, setNewConversationPhone] = useState('');
  const [newConversationMessage, setNewConversationMessage] = useState('');
  const [newConversationQueue, setNewConversationQueue] = useState('');
  const [newConversationCustomerName, setNewConversationCustomerName] = useState('');
  const [crmContactSearch, setCrmContactSearch] = useState('');
  const [crmContactResults, setCrmContactResults] = useState([]);
  const [crmContactsLoading, setCrmContactsLoading] = useState(false);
  const [selectedCrmContact, setSelectedCrmContact] = useState(null);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [quickReplySuggestions, setQuickReplySuggestions] = useState([]);
  const [quickReplySlashResults, setQuickReplySlashResults] = useState([]);
  const [quickReplySlashOpen, setQuickReplySlashOpen] = useState(false);
  const [slashMenuActiveIndex, setSlashMenuActiveIndex] = useState(0);
  const [slashQuickReplyPickerOpen, setSlashQuickReplyPickerOpen] = useState(false);
  const [slashQuickReplyLoading, setSlashQuickReplyLoading] = useState(false);
  const [quickReplyCategories, setQuickReplyCategories] = useState([]);
  const [quickReplySelectedCategory, setQuickReplySelectedCategory] = useState('');
  const [quickReplyCategoryItems, setQuickReplyCategoryItems] = useState([]);
  const [showNoQuickReplyDialog, setShowNoQuickReplyDialog] = useState(false);
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
  const [aiDiagnosticsLoading, setAiDiagnosticsLoading] = useState(false);
  const [aiDiagnosticsError, setAiDiagnosticsError] = useState('');
  const [aiDiagnostics, setAiDiagnostics] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [timelineMessages, setTimelineMessages] = useState([]);
  const [ticketEvents, setTicketEvents] = useState([]);
  const [ticketAuditLogs, setTicketAuditLogs] = useState([]);
  const [ticketAuditLoading, setTicketAuditLoading] = useState(false);
  const [showDeliveryFailuresModal, setShowDeliveryFailuresModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [ticketSchedules, setTicketSchedules] = useState([]);
  const [ticketSchedulesLoading, setTicketSchedulesLoading] = useState(false);
  const [supportCockpitEnabled, setSupportCockpitEnabled] = useState(false);
  const [supportCockpitFlagLoading, setSupportCockpitFlagLoading] = useState(true);
  const [activeSupportPlaybook, setActiveSupportPlaybook] = useState(null);
  const [supportPlaybookModalOpen, setSupportPlaybookModalOpen] = useState(false);
  const [autonomousCampaigns, setAutonomousCampaigns] = useState([]);
  const [autonomousCampaignsLoading, setAutonomousCampaignsLoading] = useState(false);
  const [autonomousRecommendations, setAutonomousRecommendations] = useState([]);
  const [autonomousRunning, setAutonomousRunning] = useState(false);
  const [showTicketEventsModal, setShowTicketEventsModal] = useState(false);
  const [showTicketAuditModal, setShowTicketAuditModal] = useState(false);
  const [deliveryFailuresLoading, setDeliveryFailuresLoading] = useState(false);
  const [deliveryFailures, setDeliveryFailures] = useState({ outboundQueue: [], channelMessages: [] });
  const [webPushSupported, setWebPushSupported] = useState(false);
  const [webPushEnabled, setWebPushEnabled] = useState(false);
  const [webPushLoading, setWebPushLoading] = useState(false);
  const { enabled: phoneMaskingEnabled } = usePhoneMasking();
  const autoAppliedAiTagsByTicketRef = React.useRef(new Map());

  const closeSlashDropdown = useCallback(() => {
    setQuickReplySlashOpen((prev) => (prev ? false : prev));
    setQuickReplySlashResults((prev) => (prev.length > 0 ? [] : prev));
    setSlashQuickReplyPickerOpen((prev) => (prev ? false : prev));
    setSlashQuickReplyLoading(false);
    setSlashMenuActiveIndex(0);
  }, []);

  const openSlashQuickReplyPicker = useCallback(() => {
    const fallback = (quickReplyCategoryItems.length > 0 ? quickReplyCategoryItems : quickReplySuggestions).slice(0, 8);
    setSlashQuickReplyPickerOpen(true);
    setQuickReplySlashResults(fallback);
    setQuickReplySlashOpen(true);
    setMessageText('/');
    // Garante conteúdo mesmo quando sugestões locais ainda não carregaram.
    setSlashQuickReplyLoading(true);
    listQuickReplies({ activeOnly: true, category: quickReplySelectedCategory || undefined })
      .then((resp) => {
        const list = Array.isArray(resp?.quickReplies) ? resp.quickReplies : [];
        const top = list.slice(0, 8);
        if (top.length === 0 && fallback.length === 0) {
          closeSlashDropdown();
          setMessageText('');
          setShowNoQuickReplyDialog(true);
          return;
        }
        setQuickReplySlashResults(top);
      })
      .catch(() => {
        if (fallback.length === 0) {
          closeSlashDropdown();
          setMessageText('');
          setShowNoQuickReplyDialog(true);
        }
      })
      .finally(() => setSlashQuickReplyLoading(false));
  }, [quickReplyCategoryItems, quickReplySuggestions, quickReplySelectedCategory, closeSlashDropdown]);

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

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      setSupportCockpitEnabled(false);
      setSupportCockpitFlagLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSupportCockpitFlagLoading(true);
    isTenantFeatureEnabled('support_cockpit_enabled', false)
      .then((enabled) => {
        if (!cancelled) setSupportCockpitEnabled(enabled === true);
      })
      .catch(() => {
        if (!cancelled) setSupportCockpitEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setSupportCockpitFlagLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, agent?.tenantId]);

  const getWebPushPreferenceKey = useCallback(() => {
    const userPart = String(agent?.id || 'anonymous');
    const tenantPart = String(agent?.tenantId || 'no-tenant');
    return `web_push_enabled:${tenantPart}:${userPart}`;
  }, [agent?.id, agent?.tenantId]);

  useEffect(() => {
    const supported = isWebPushSupported();
    setWebPushSupported(supported);
    if (!supported) {
      setWebPushEnabled(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const currentSubscription = await getCurrentWebPushSubscription();
        const preferenceKey = getWebPushPreferenceKey();
        const localPreference = typeof window !== 'undefined'
          ? window.localStorage.getItem(preferenceKey)
          : null;
        const enabled = Boolean(currentSubscription) && localPreference !== '0';
        if (!cancelled) {
          setWebPushEnabled(enabled);
        }
      } catch (err) {
        logger.debug('[SupportPage] Não foi possível carregar estado do Web Push', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getWebPushPreferenceKey]);

  const handleEnableWebPush = useCallback(async () => {
    if (!webPushSupported || webPushLoading) return;
    setWebPushLoading(true);
    try {
      await subscribeCurrentUserWebPush({
        deviceName: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(getWebPushPreferenceKey(), '1');
      }
      setWebPushEnabled(true);
      showToast('Notificações ativadas com sucesso.', 'success', 4000);
    } catch (err) {
      const message = String(err?.message || 'Falha ao ativar notificações');
      showToast(message, 'warning', 6000);
      logger.warn('[SupportPage] Falha ao ativar Web Push', err);
    } finally {
      setWebPushLoading(false);
    }
  }, [getWebPushPreferenceKey, showToast, webPushLoading, webPushSupported]);

  const handleDisableWebPush = useCallback(async () => {
    if (!webPushSupported || webPushLoading) return;
    setWebPushLoading(true);
    try {
      await unsubscribeCurrentUserWebPush();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(getWebPushPreferenceKey(), '0');
      }
      setWebPushEnabled(false);
      showToast('Notificações desativadas.', 'info', 4000);
    } catch (err) {
      showToast('Não foi possível desativar notificações.', 'warning', 6000);
      logger.warn('[SupportPage] Falha ao desativar Web Push', err);
    } finally {
      setWebPushLoading(false);
    }
  }, [getWebPushPreferenceKey, showToast, webPushLoading, webPushSupported]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 900px)');
    const applyMobileState = (matches) => {
      setIsMobile(matches);
      if (matches) {
        setIsRightPanelCollapsed(true);
      }
    };
    applyMobileState(media.matches);
    const onChange = (event) => applyMobileState(event.matches);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SUPPORT_UI_FILTERS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const savedChip = String(parsed?.uiChip || 'all');
      setUiSearch(String(parsed?.uiSearch || ''));
      setUiChip(SUPPORT_FILTER_CHIPS.includes(savedChip) ? savedChip : 'all');
      setUiQueue(String(parsed?.uiQueue || ''));
    } catch {
      // ignore invalid localStorage payload
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SUPPORT_UI_FILTERS_STORAGE_KEY, JSON.stringify({
        uiSearch,
        uiChip,
        uiQueue,
      }));
    } catch {
      // ignore localStorage write failures
    }
  }, [uiSearch, uiChip, uiQueue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUiSearchDebounced(uiSearch);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [uiSearch]);

  useEffect(() => {
    if (!showClosed && uiChip === 'closed') {
      setUiChip('all');
    }
  }, [showClosed, uiChip]);

  const selectedTicketContactId = React.useMemo(() => getTicketContactId(selectedTicket), [selectedTicket]);
  const selectedTicketPhoneDigits = React.useMemo(() => digits(selectedTicket?.phoneNumber || ''), [selectedTicket?.phoneNumber]);
  const supportQuickActionContext = React.useMemo(() => {
    const ticketId = String(selectedTicket?.id || '').trim();
    const queueId = String(selectedTicket?.queue || '').trim();
    const departmentId = String(
      selectedTicket?.context?.departmentId
      || selectedTicket?.context?.metadata?.departmentId
      || ''
    ).trim();

    const context = {};
    if (ticketId) context.ticketId = ticketId;
    if (queueId) context.queueId = queueId;
    if (departmentId) context.departmentId = departmentId;
    return Object.keys(context).length > 0 ? context : null;
  }, [selectedTicket]);
  const canFilterBySelectedContactHistory = Boolean(selectedTicketContactId || selectedTicketPhoneDigits);
  const crmOperational = useCrmOperationalProfile({
    contactId: selectedTicketContactId,
    enabled: supportCockpitEnabled && Boolean(selectedTicket?.id),
    timelineLimit: 20,
  });
  const crmOperationalSignals = useOperationalSignals({
    contactId: selectedTicketContactId,
    scope: 'contact',
    enabled: supportCockpitEnabled && Boolean(selectedTicket?.id),
    activeOnly: true,
    limit: 12,
  });
  const crmOperationalRecommendations = useOperationalRecommendations({
    contactId: selectedTicketContactId,
    scope: 'contact',
    enabled: supportCockpitEnabled && Boolean(selectedTicket?.id),
    limit: 12,
  });
  const crmContactPlaybooks = usePlaybooks({
    contactId: selectedTicketContactId,
    scope: 'contact',
    enabled: supportCockpitEnabled && Boolean(selectedTicket?.id),
    limit: 12,
  });
  const supportPlaybookExecution = usePlaybookExecution();
  const supportTenantId = React.useMemo(
    () => String(selectedTicket?.tenantId || agent?.tenantId || '').trim(),
    [agent?.tenantId, selectedTicket?.tenantId],
  );

  const supportPlaybookSuggestions = React.useMemo(
    () => (Array.isArray(crmContactPlaybooks.items) ? crmContactPlaybooks.items : []),
    [crmContactPlaybooks.items],
  );

  const handleExecuteSupportPlaybookSuggestion = useCallback(async (suggestion) => {
    const playbook = suggestion?.playbook;
    if (!playbook?.id || !supportTenantId || !selectedTicketContactId) return;

    const profileContact = crmOperational?.profile?.contact || {};
    const out = await supportPlaybookExecution.startExecution({
      playbookId: playbook.id,
      tenantId: supportTenantId,
      contactId: selectedTicketContactId,
      signalId: suggestion?.signal?.id || null,
      recommendationId: suggestion?.recommendation?.id || null,
      accountId: profileContact?.account_id || profileContact?.accountId || null,
      phoneNumber: profileContact?.phone || selectedTicket?.phoneNumber || null,
      conversationId: selectedTicket?.conversationId || null,
      ticketId: selectedTicket?.id || null,
      metadata: {
        source: 'support',
        queue: selectedTicket?.queue || null,
      },
    });

    if (out?.ok) {
      setActiveSupportPlaybook(playbook);
      setSupportPlaybookModalOpen(true);
    }
  }, [
    crmOperational?.profile?.contact,
    selectedTicket?.conversationId,
    selectedTicket?.id,
    selectedTicket?.phoneNumber,
    selectedTicket?.queue,
    selectedTicketContactId,
    supportPlaybookExecution,
    supportTenantId,
  ]);

  const handleExecuteSupportPlaybookStep = useCallback(async (step) => {
    if (!activeSupportPlaybook?.id || !supportPlaybookExecution.execution?.id || !supportTenantId) return;
    await supportPlaybookExecution.runStep({
      playbookId: activeSupportPlaybook.id,
      tenantId: supportTenantId,
      executionId: supportPlaybookExecution.execution.id,
      stepId: step.id,
      context: {
        ticketId: selectedTicket?.id || null,
      },
    });
  }, [
    activeSupportPlaybook?.id,
    selectedTicket?.id,
    supportPlaybookExecution,
    supportTenantId,
  ]);

  const handleExecuteSupportPlaybookNext = useCallback(async () => {
    if (!activeSupportPlaybook?.id || !supportPlaybookExecution.execution?.id || !supportTenantId) return;
    await supportPlaybookExecution.runNextStep({
      playbookId: activeSupportPlaybook.id,
      tenantId: supportTenantId,
      executionId: supportPlaybookExecution.execution.id,
      context: {
        ticketId: selectedTicket?.id || null,
      },
    });
  }, [
    activeSupportPlaybook?.id,
    selectedTicket?.id,
    supportPlaybookExecution,
    supportTenantId,
  ]);

  useEffect(() => {
    if (uiContactHistoryOnly && !canFilterBySelectedContactHistory) {
      setUiContactHistoryOnly(false);
    }
  }, [uiContactHistoryOnly, canFilterBySelectedContactHistory]);

  // Usa useRef para manter referências estáveis
  const showToastRef = useLatestRef(showToast);
  const loadTicketsRef = React.useRef();
  const loadMoreTicketsRef = React.useRef();
  const sentinelRef = React.useRef(null);
  const composeTextareaRef = React.useRef(null);
  const attachmentInputRef = React.useRef(null);
  const ragAttachSearchRef = React.useRef('');
  const composeContainerRef = React.useRef(null);
  const emojiPickerRef = React.useRef(null);
  const composeSelectionRef = React.useRef({ start: 0, end: 0 });
  const slashMenuRef = React.useRef(null);
  const loggedDeliveryErrorKeysRef = React.useRef(new Set());
  const recordingMediaRecorderRef = React.useRef(null);
  const recordingMediaChunksRef = React.useRef([]);
  const recordingMediaStreamRef = React.useRef(null);
  const recordingTimerRef = React.useRef(null);

  // Debounce para loadTickets - agrupa múltiplos eventos WebSocket
  // DEVE ser definido ANTES de handleWebSocketEvent para evitar erro de inicialização
  const { debouncedFn: debouncedLoadTickets } = useDebounce(() => {
    if (loadTicketsRef.current) {
      loadTicketsRef.current();
    }
  }, 500); // 500ms de debounce

  // Debounce para quick replies via "/atalho"
  const { debouncedFn: debouncedSearchSlashQuickReplies } = useDebounce(() => {
    const txt = (messageText || '').trimStart();
    if (!txt.startsWith('/')) {
      closeSlashDropdown();
      return;
    }
    setQuickReplySlashOpen(true);
    const q = txt.slice(1).trim();
    const qLower = q.toLowerCase();
    const knownCommands = ['assumir', 'devolver', 'pausar', 'retomar', 'falhas', 'fechar', 'agendar', 'emoji', 'anexo', 'limpar', 'resposta-rapida'];
    if (!q) {
      if (slashQuickReplyPickerOpen) {
        // Não limpa resultados já carregados para evitar "sumir" da lista.
        if ((quickReplySlashResults || []).length === 0) {
          const fallback = (quickReplyCategoryItems.length > 0 ? quickReplyCategoryItems : quickReplySuggestions).slice(0, 8);
          setQuickReplySlashResults(fallback);
        }
      } else {
        setQuickReplySlashResults([]);
      }
      return;
    }
    if (!slashQuickReplyPickerOpen) {
      const commandLike = knownCommands.some((cmd) => cmd.startsWith(qLower));
      if (commandLike) {
        // Prioriza comandos e evita busca de respostas rápidas no menu principal.
        setQuickReplySlashResults([]);
        return;
      }
      setQuickReplySlashResults([]);
      return;
    }
    setSlashQuickReplyLoading(true);
    listQuickReplies({ search: q, activeOnly: true, category: quickReplySelectedCategory || undefined })
      .then(async (resp) => {
        const list = resp?.quickReplies || [];
        if (list.length === 0 && quickReplySelectedCategory) {
          const fallback = await listQuickReplies({ search: q, activeOnly: true });
          const fallbackList = fallback?.quickReplies || [];
          setQuickReplySlashResults(fallbackList.slice(0, 8));
          return;
        }
        setQuickReplySlashResults(list.slice(0, 8));
      })
      .catch(() => {
        // Mantém os resultados atuais em caso de erro transitório.
      })
      .finally(() => setSlashQuickReplyLoading(false));
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
          showToastRef.current(`Novo chamado criado: ${data.ticketId}`, 'info', 3000);
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
          showToastRef.current(`Chamado atribuído para você: ${data.ticketId}`, 'success', 3000);
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
            showToastRef.current(`Nova mensagem no chamado ${data.ticketId}`, 'info', 3000);
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

  const { connected: wsConnected, authenticated: wsAuthenticated, authFailed } = useWebSocketContext({
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

  // UI: status do WebSocket centralizado no módulo
  const wsStatus = useWebSocketStatus({
    connected: wsConnected,
    authenticated: wsAuthenticated,
    authFailed,
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
    if (!selectedTicket || selectedTicket.status !== 'in_progress') {
      closeSlashDropdown();
      return;
    }
    debouncedSearchSlashQuickReplies();
  }, [messageText, selectedTicket?.id, selectedTicket?.status, debouncedSearchSlashQuickReplies, closeSlashDropdown]);

  const insertQuickReply = useCallback(async (reply, options = {}) => {
    if (!reply) return;
    const fromSlashMenu = !!options?.fromSlashMenu;
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
      if (fromSlashMenu || p.startsWith('/')) return rendered;
      return prev ? `${prev}\n${rendered}` : rendered;
    });
    requestAnimationFrame(() => {
      const el = composeTextareaRef.current;
      if (!el) return;
      el.focus();
      const pos = (el.value || '').length;
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    });

    closeSlashDropdown();
    try { await useQuickReply(reply.id); } catch {}
  }, [applyTemplateVariables, selectedTicket, closeSlashDropdown]);

  const inferMediaType = useCallback((fileName, mimeType) => {
    const mime = String(mimeType || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/.test(name)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/.test(name)) return 'audio';
    return 'document';
  }, []);

  const focusComposeInput = useCallback(() => {
    requestAnimationFrame(() => {
      const el = composeTextareaRef.current;
      if (!el) return;
      el.focus();
      const pos = (el.value || '').length;
      try {
        el.setSelectionRange(pos, pos);
      } catch (_) {}
    });
  }, []);

  const handleSelectTicket = useCallback((ticket) => {
    if (!ticket) return;
    setSelectedTicket(ticket);
    if (ticket.status === 'in_progress') {
      focusComposeInput();
    }
  }, [focusComposeInput]);

  const adjustComposeTextareaHeight = useCallback(() => {
    const el = composeTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 180);
    el.style.height = `${Math.max(nextHeight, 38)}px`;
    el.style.overflowY = el.scrollHeight > 180 ? 'auto' : 'hidden';
  }, []);

  const resolveSupportMediaUrl = useCallback((value, tenantHint = null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw) || raw.startsWith('//')) {
      return raw;
    }
    if (raw.startsWith('/')) return getStaticUrl(raw);
    if (raw.startsWith('public/')) return getStaticUrl(`/${raw}`);
    if (raw.startsWith('support-media/')) return getStaticUrl(`/public/${raw}`);
    if (raw.startsWith('storage/support-media/')) return getStaticUrl(`/public/${raw.slice('storage/'.length)}`);

    const tenantSegment = String(
      tenantHint
      || selectedTicket?.tenantId
      || agent?.tenantId
      || 'system'
    ).trim() || 'system';
    const looksLikeFileName = /^[^/?#\\]+\.[a-z0-9]{2,10}$/i.test(raw);
    if (looksLikeFileName) {
      return getStaticUrl(`/public/support-media/${encodeURIComponent(tenantSegment)}/${encodeURIComponent(raw)}`);
    }
    return getStaticUrl(`/${raw}`);
  }, [agent?.tenantId, selectedTicket?.tenantId]);

  const resetNewConversationForm = useCallback(() => {
    setShowNewConversationModal(false);
    setNewConversationPhone('');
    setNewConversationMessage('');
    setNewConversationQueue('');
    setNewConversationCustomerName('');
    setCrmContactSearch('');
    setCrmContactResults([]);
    setCrmContactsLoading(false);
    setSelectedCrmContact(null);
  }, []);

  useEffect(() => {
    if (!showNewConversationModal) return;
    const query = String(crmContactSearch || '').trim();
    if (query.length < 2) {
      setCrmContactResults([]);
      setCrmContactsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setCrmContactsLoading(true);
      searchCrmContacts(query, { limit: 8 })
        .then((resp) => {
          if (cancelled) return;
          setCrmContactResults(Array.isArray(resp?.contacts) ? resp.contacts : []);
        })
        .catch(() => {
          if (cancelled) return;
          setCrmContactResults([]);
        })
        .finally(() => {
          if (!cancelled) setCrmContactsLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [crmContactSearch, showNewConversationModal]);

  useEffect(() => {
    adjustComposeTextareaHeight();
  }, [messageText, selectedTicket?.id, adjustComposeTextareaHeight]);

  const insertTextAtCursor = useCallback((textToInsert) => {
    const el = composeTextareaRef.current;
    if (!el) {
      setMessageText((prev) => `${prev || ''}${textToInsert}`);
      return;
    }
    const hasFocus = document.activeElement === el;
    const start = hasFocus
      ? (el.selectionStart || 0)
      : (composeSelectionRef.current?.start || 0);
    const end = hasFocus
      ? (el.selectionEnd || start)
      : (composeSelectionRef.current?.end || start);
    const current = typeof el.value === 'string' ? el.value : (messageText || '');
    const next = `${current.slice(0, start)}${textToInsert}${current.slice(end)}`;
    setMessageText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + textToInsert.length;
      el.setSelectionRange(pos, pos);
      composeSelectionRef.current = { start: pos, end: pos };
      adjustComposeTextareaHeight();
    });
  }, [adjustComposeTextareaHeight, messageText]);

  const captureComposeSelection = useCallback(() => {
    const el = composeTextareaRef.current;
    if (!el) return;
    composeSelectionRef.current = {
      start: el.selectionStart || 0,
      end: el.selectionEnd || 0,
    };
  }, []);

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    stopRecordingTimer();
    const stream = recordingMediaStreamRef.current;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (_err) {}
      });
    }
    recordingMediaStreamRef.current = null;
    recordingMediaRecorderRef.current = null;
    recordingMediaChunksRef.current = [];
    setRecordingAudio(false);
    setRecordingAudioSeconds(0);
  }, [stopRecordingTimer]);

  const handleAttachFiles = useCallback(async (files) => {
    if (!Array.isArray(files) || files.length === 0 || !selectedTicket) return;
    setUploadingAttachment(true);
    try {
      const uploadedItems = await Promise.all(files.map(async (file) => {
        const uploaded = await uploadSupportMedia(file);
        const mediaType = inferMediaType(uploaded?.fileName || file.name, uploaded?.mimeType || file.type);
        return {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mediaType,
          mediaUrl: uploaded?.url,
          fileName: uploaded?.fileName || file.name,
          mimeType: uploaded?.mimeType || file.type || null,
          sizeBytes: uploaded?.sizeBytes || file.size || 0,
        };
      }));
      setMessageAttachments((prev) => [...prev, ...uploadedItems]);
      showToastRef.current(
        uploadedItems.length > 1 ? `${uploadedItems.length} anexos carregados` : 'Anexo carregado',
        'success',
        2200
      );
    } catch (err) {
      logger.error('Erro ao carregar anexo', err);
      const isPayloadTooLarge = Number(err?.status) === 413
        || String(err?.message || '').includes('HTTP 413')
        || String(err?.body || '').includes('413 Request Entity Too Large');
      const friendlyMessage = isPayloadTooLarge
        ? 'Arquivo muito grande para upload no ambiente atual (HTTP 413).'
        : (err?.message || 'Erro ao carregar anexo');
      showToastRef.current(friendlyMessage, 'error');
    } finally {
      setUploadingAttachment(false);
    }
  }, [inferMediaType, selectedTicket]);

  const startMicrophoneRecording = useCallback(async () => {
    if (!selectedTicket) return;
    if (recordingAudio) return;
    const canRecord = typeof window !== 'undefined'
      && typeof window.MediaRecorder !== 'undefined'
      && navigator?.mediaDevices?.getUserMedia;
    if (!canRecord) {
      showToastRef.current('Gravação de áudio não suportada neste navegador.', 'warning');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = '';
      if (window.MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (window.MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (window.MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';

      const mediaRecorder = mimeType
        ? new window.MediaRecorder(stream, { mimeType })
        : new window.MediaRecorder(stream);

      recordingMediaChunksRef.current = [];
      recordingMediaStreamRef.current = stream;
      recordingMediaRecorderRef.current = mediaRecorder;
      setRecordingAudioSeconds(0);
      setRecordingAudio(true);
      stopRecordingTimer();
      recordingTimerRef.current = setInterval(() => {
        setRecordingAudioSeconds((prev) => prev + 1);
      }, 1000);

      mediaRecorder.ondataavailable = (event) => {
        if (event?.data && event.data.size > 0) {
          recordingMediaChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        showToastRef.current('Erro ao gravar áudio do microfone.', 'error');
        cleanupRecordingResources();
      };

      mediaRecorder.onstop = async () => {
        const chunks = recordingMediaChunksRef.current || [];
        const blobType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: blobType });
        cleanupRecordingResources();

        if (!blob || blob.size === 0) {
          showToastRef.current('Gravação vazia. Tente novamente.', 'warning');
          return;
        }

        const ext = blobType.includes('ogg') ? 'ogg' : 'webm';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `gravacao-${stamp}.${ext}`;
        let file;
        try {
          file = new File([blob], fileName, { type: blobType });
        } catch (_err) {
          file = blob;
          Object.defineProperty(file, 'name', { value: fileName, configurable: true });
        }
        await handleAttachFiles([file]);
      };

      mediaRecorder.start();
    } catch (err) {
      logger.error('Erro ao iniciar gravação de áudio', err);
      showToastRef.current('Não foi possível acessar o microfone.', 'error');
      cleanupRecordingResources();
    }
  }, [cleanupRecordingResources, handleAttachFiles, recordingAudio, selectedTicket, stopRecordingTimer]);

  const stopMicrophoneRecording = useCallback(() => {
    const recorder = recordingMediaRecorderRef.current;
    if (!recorder) {
      cleanupRecordingResources();
      return;
    }
    stopRecordingTimer();
    setRecordingAudio(false);
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        cleanupRecordingResources();
      }
    } catch (_err) {
      cleanupRecordingResources();
    }
  }, [cleanupRecordingResources, stopRecordingTimer]);

  const handleComposePaste = useCallback((event) => {
    const clipboardItems = Array.from(event?.clipboardData?.items || []);
    if (!clipboardItems.length) return;

    const imageFiles = clipboardItems
      .filter((item) => String(item?.kind || '').toLowerCase() === 'file' && String(item?.type || '').startsWith('image/'))
      .map((item) => item.getAsFile?.())
      .filter(Boolean)
      .map((file, index) => {
        const originalName = String(file?.name || '').trim();
        if (originalName) return file;
        const ext = String(file?.type || '').split('/')[1] || 'png';
        const fallbackName = `screenshot-${Date.now()}-${index + 1}.${ext}`;
        try {
          return new File([file], fallbackName, { type: file?.type || 'image/png' });
        } catch (_err) {
          return file;
        }
      });

    if (!imageFiles.length) return;
    event.preventDefault();
    handleAttachFiles(imageFiles);
  }, [handleAttachFiles]);

  useEffect(() => () => {
    stopRecordingTimer();
    const stream = recordingMediaStreamRef.current;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (_err) {}
      });
    }
  }, [stopRecordingTimer]);

  useEffect(() => {
    if (selectedTicket?.status === 'in_progress') return;
    if (recordingAudio) {
      stopMicrophoneRecording();
    }
  }, [recordingAudio, selectedTicket?.status, stopMicrophoneRecording]);

  const handleAttachRagDocument = useCallback((doc) => {
    if (!doc || !doc.id) return;
    const fileName = String(
      doc?.metadata?.originalBinary?.filename
      || doc?.metadata?.fileName
      || doc?.title
      || `documento-${doc.id}`
    ).trim();
    const mimeType = String(
      doc?.metadata?.originalBinary?.mimeType
      || doc?.metadata?.mime
      || doc?.metadata?.fileType
      || 'application/octet-stream'
    ).trim();
    const sizeBytesRaw = Number(
      doc?.metadata?.originalBinary?.sizeBytes
      || doc?.metadata?.fileSize
      || 0
    );
    const sizeBytes = Number.isFinite(sizeBytesRaw) ? sizeBytesRaw : 0;
    const mediaType = inferMediaType(fileName, mimeType);

    setMessageAttachments((prev) => ([
      ...prev,
      {
        id: `rag-${doc.id}-${Date.now()}`,
        mediaKind: 'rag',
        documentId: String(doc.id),
        mediaType,
        mediaUrl: `/rag/documents/${encodeURIComponent(String(doc.id))}/file`,
        fileName,
        mimeType: mimeType || null,
        sizeBytes,
      },
    ]));
    setShowRagAttachModal(false);
    setRagAttachSearch('');
    showToastRef.current('Documento do RAG anexado', 'success', 2200);
  }, [inferMediaType]);

  useEffect(() => {
    if (!showRagAttachModal || !selectedTicket) return;
    let cancelled = false;
    const query = String(ragAttachSearch || '').trim();
    ragAttachSearchRef.current = query;

    setRagAttachLoading(true);
    listRagDocuments({ search: query || undefined })
      .then((items) => {
        if (cancelled) return;
        const rows = Array.isArray(items) ? items : [];
        setRagAttachDocuments(rows.slice(0, 60));
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Erro ao listar documentos do RAG para anexo', err);
        setRagAttachDocuments([]);
      })
      .finally(() => {
        if (!cancelled) setRagAttachLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showRagAttachModal, ragAttachSearch, selectedTicket]);

  const slashMode = (messageText || '').trimStart().startsWith('/');
  useEffect(() => {
    if (slashMode) {
      setEmojiPickerOpen(false);
      return;
    }
    setSlashQuickReplyPickerOpen((prev) => (prev ? false : prev));
    setQuickReplySlashOpen((prev) => (prev ? false : prev));
    setSlashMenuActiveIndex(0);
  }, [slashMode]);

  const slashCommandItems = React.useMemo(() => {
    const quickReplies = (quickReplySlashResults || []).map((qr) => ({
      id: `qr:${qr.id}`,
      kind: 'quick-reply',
      title: qr.title || 'Resposta rápida',
      description: String(qr.message || '').slice(0, 120),
      action: () => insertQuickReply(qr),
    }));
    const actionCommands = [];
    if (selectedTicket?.status === 'in_progress') {
      const mode = selectedTicket?.mode || 'bot';
      if (mode === 'bot') {
        actionCommands.push({
          id: 'cmd:assumir',
          kind: 'command',
          title: '/assumir',
          description: 'Assumir atendimento (modo humano)',
          action: () => handleTakeOver(),
        });
      }
      if (mode === 'human') {
        actionCommands.push(
          {
            id: 'cmd:devolver',
            kind: 'command',
            title: '/devolver',
            description: 'Devolver atendimento ao bot',
            action: () => handleReturnToBot(),
          },
          {
            id: 'cmd:pausar',
            kind: 'command',
            title: '/pausar',
            description: 'Pausar atendimento',
            action: () => handlePause(),
          }
        );
      }
      if (mode === 'paused') {
        actionCommands.push(
          {
            id: 'cmd:retomar',
            kind: 'command',
            title: '/retomar',
            description: 'Retomar atendimento humano',
            action: () => handleResume(),
          },
          {
            id: 'cmd:devolver',
            kind: 'command',
            title: '/devolver',
            description: 'Devolver atendimento ao bot',
            action: () => handleReturnToBot(),
          }
        );
      }
      actionCommands.push(
        {
          id: 'cmd:falhas',
          kind: 'command',
          title: '/falhas',
          description: deliveryFailuresLoading ? 'Carregando falhas...' : 'Abrir falhas de entrega',
          action: () => openDeliveryFailures(selectedTicket.id),
        },
        {
          id: 'cmd:agendar',
          kind: 'command',
          title: '/agendar',
          description: 'Abrir modal de agendamento para o chamado atual',
          action: () => setShowScheduleModal(true),
        },
        {
          id: 'cmd:fechar',
          kind: 'command',
          title: '/fechar',
          description: 'Fechar chamado atual',
          action: () => handleClose(selectedTicket.id),
        }
      );
    }
    const commandItems = [
      ...actionCommands,
      {
        id: 'cmd:resposta-rapida',
        kind: 'command',
        title: '/resposta-rapida',
        description: 'Abrir lista de respostas rápidas',
        action: () => openSlashQuickReplyPicker(),
      },
      {
        id: 'cmd:emoji',
        kind: 'command',
        title: '/emoji',
        description: 'Abrir seletor de emojis',
        action: () => setEmojiPickerOpen(true),
      },
      {
        id: 'cmd:anexo',
        kind: 'command',
        title: '/anexo',
        description: 'Selecionar mídia ou arquivo',
        action: () => attachmentInputRef.current?.click(),
      },
      {
        id: 'cmd:anexo-rag',
        kind: 'command',
        title: '/anexo-rag',
        description: 'Selecionar documento do RAG',
        action: () => setShowRagAttachModal(true),
      },
      {
        id: 'cmd:limpar',
        kind: 'command',
        title: '/limpar',
        description: 'Limpar mensagem digitada',
        action: () => setMessageText(''),
      },
    ];
    if (slashQuickReplyPickerOpen) {
      return quickReplies;
    }
    return commandItems;
  }, [insertQuickReply, quickReplySlashResults, selectedTicket, deliveryFailuresLoading, openSlashQuickReplyPicker, slashQuickReplyPickerOpen]);

  const slashVisibleItems = React.useMemo(() => {
    if (!slashMode) return [];
    if (slashQuickReplyPickerOpen) {
      return slashCommandItems;
    }
    const query = String(messageText || '').trimStart().slice(1).trim().toLowerCase();
    if (!query) return slashCommandItems;
    return slashCommandItems.filter((item) => {
      if (item?.kind !== 'command') return false;
      const cmd = String(item.title || '').trim().toLowerCase().replace(/^\//, '');
      return cmd.startsWith(query);
    });
  }, [slashMode, slashQuickReplyPickerOpen, slashCommandItems, messageText]);

  useEffect(() => {
    if (!slashMode || !quickReplySlashOpen || slashVisibleItems.length === 0) {
      setSlashMenuActiveIndex(0);
      return;
    }
    setSlashMenuActiveIndex((prev) => (prev >= 0 && prev < slashVisibleItems.length ? prev : 0));
  }, [slashMode, quickReplySlashOpen, slashVisibleItems.length]);

  useEffect(() => {
    if (!slashMode || !quickReplySlashOpen) return;
    const menu = slashMenuRef.current;
    const activeEl = menu?.querySelector(`[data-slash-index=\"${slashMenuActiveIndex}\"]`);
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [slashMode, quickReplySlashOpen, slashMenuActiveIndex, slashVisibleItems.length]);

  const executeSlashCommand = useCallback((title) => {
    const normalized = String(title || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === '/assumir') { handleTakeOver(); return true; }
    if (normalized === '/devolver') { handleReturnToBot(); return true; }
    if (normalized === '/pausar') { handlePause(); return true; }
    if (normalized === '/retomar') { handleResume(); return true; }
    if (normalized === '/falhas') {
      openDeliveryFailures(selectedTicket?.id || selectedTicketIdRef.current || null);
      return true;
    }
    if (normalized === '/agendar' && selectedTicket?.id) { setShowScheduleModal(true); return true; }
    if (normalized === '/fechar' && selectedTicket?.id) { handleClose(selectedTicket.id); return true; }
    if (normalized === '/resposta-rapida') { openSlashQuickReplyPicker(); return true; }
    if (normalized === '/emoji') { setEmojiPickerOpen(true); return true; }
    if (normalized === '/anexo') { attachmentInputRef.current?.click(); return true; }
    if (normalized === '/anexo-rag') { setShowRagAttachModal(true); return true; }
    if (normalized === '/limpar') { setMessageText(''); return true; }
    return false;
  }, [selectedTicket?.id, openSlashQuickReplyPicker]);

  const handleSlashItemSelect = useCallback((item) => {
    if (!item) return;
    if (item.kind === 'command') {
      const normalized = String(item.title || '').trim().toLowerCase();
      if (normalized === '/resposta-rapida') {
        // Força transição para o picker de respostas rápidas ao clicar no comando.
        // Evita voltar para a lista de comandos por causa do texto parcial digitado.
        setSlashQuickReplyPickerOpen(true);
        setQuickReplySlashOpen(true);
        setSlashMenuActiveIndex(0);
        setMessageText('/');
        if (typeof item.action === 'function') {
          item.action();
        } else {
          openSlashQuickReplyPicker();
        }
        return;
      }
      // Sempre limpa o texto parcial digitado (ex.: "/fe") ao escolher um comando.
      setMessageText('');
      const handled = executeSlashCommand(item.title);
      if (!handled && typeof item.action === 'function') {
        item.action();
      }
      closeSlashDropdown();
      return;
    }
    if (item.kind === 'quick-reply') {
      const rawId = String(item.id || '');
      const quickReplyId = rawId.startsWith('qr:') ? rawId.slice(3) : rawId;
      const currentReply = (quickReplySlashResults || []).find((qr) => String(qr?.id) === String(quickReplyId));
      if (currentReply) {
        insertQuickReply(currentReply, { fromSlashMenu: true });
      } else if (typeof item.action === 'function') {
        item.action();
      }
      closeSlashDropdown();
      return;
    }
    if (typeof item.action === 'function') {
      item.action();
    }
    closeSlashDropdown();
  }, [closeSlashDropdown, executeSlashCommand, insertQuickReply, openSlashQuickReplyPicker, quickReplySlashResults]);

  useEffect(() => {
    if (!emojiPickerOpen && !quickReplySlashOpen) return;

    const handleClickOutside = (event) => {
      const target = event.target;
      if (!target) return;

      const clickedSlash = slashMenuRef.current?.contains(target);
      if (clickedSlash) {
        if (emojiPickerOpen) setEmojiPickerOpen(false);
        return;
      }

      const clickedInsideCompose = composeContainerRef.current?.contains(target);
      if (!clickedInsideCompose) {
        setEmojiPickerOpen(false);
        closeSlashDropdown();
        return;
      }

      const clickedEmoji = emojiPickerRef.current?.contains(target);
      if (emojiPickerOpen && !clickedEmoji) setEmojiPickerOpen(false);
      if (quickReplySlashOpen && !clickedSlash) closeSlashDropdown();
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [emojiPickerOpen, quickReplySlashOpen, closeSlashDropdown]);

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
  const loadTicketsGuard = useInFlightGuard();
  const pendingLoadTicketsRef = React.useRef(false);
  // Timestamp do último erro mostrado para evitar spam de toasts
  const lastErrorToastTimeRef = React.useRef(0);
  const ERROR_TOAST_COOLDOWN = 30000; // 30 segundos entre erros

  // Carrega tickets de acordo com os filtros da lista
  const mergeTicketsById = useCallback((existing, incoming) => {
    const base = Array.isArray(existing) ? existing : [];
    const add = Array.isArray(incoming) ? incoming : [];
    if (base.length === 0) {
      return Array.from(new Map(add.map((ticket) => [ticket.id, ticket])).values());
    }

    const incomingMap = new Map(add.map((ticket) => [ticket.id, ticket]));
    const existingIds = new Set(base.map((ticket) => ticket.id));
    const merged = base.map((ticket) => incomingMap.get(ticket.id) || ticket);
    for (const ticket of add) {
      if (!existingIds.has(ticket.id)) {
        merged.push(ticket);
      }
    }
    return merged;
  }, []);

  const backendStatuses = React.useMemo(() => (
    (showClosed || uiContactHistoryOnly) ? ['waiting', 'in_progress', 'closed'] : ['waiting', 'in_progress']
  ), [showClosed, uiContactHistoryOnly]);
  const backendQuery = String(uiSearchDebounced || '').trim();

  const loadTickets = useCallback(async () => {
    // Evita requisições duplicadas
    if (!loadTicketsGuard.start()) {
      pendingLoadTicketsRef.current = true;
      return;
    }

    setLoading(true);
    setIsLoadingPage(true);
    try {
      const page = await listTicketsPaged({
        status: backendStatuses,
        limit: PAGE_SIZE,
        queue: uiQueue || undefined,
        q: backendQuery || undefined,
        contactId: uiContactHistoryOnly && selectedTicketContactId ? selectedTicketContactId : undefined,
        phoneNumber: uiContactHistoryOnly && !selectedTicketContactId && selectedTicketPhoneDigits ? selectedTicketPhoneDigits : undefined,
      });

      const shouldShowAssignedTicket = (assignedValue) => {
        if (assignedValue === undefined || assignedValue === null || assignedValue === '') return true;
        return assignedValue === agent?.id || assignedValue === agent?.username;
      };

      const filteredTickets = showOthers
        ? (Array.isArray(page?.items) ? page.items : [])
        : (Array.isArray(page?.items) ? page.items : []).filter((ticket) => shouldShowAssignedTicket(ticket?.assignedTo));

      setTicketsBase(filteredTickets);
      setNextCursor(page?.nextCursor || null);
      setHasMore(Boolean(page?.hasMore));
      
      // Verifica se o ticket selecionado ainda existe na nova lista
      // Se não existir mais, limpa a seleção e as mensagens
      setSelectedTicket(prevSelected => {
        if (!prevSelected) return null;
        const updatedTicket = filteredTickets.find(t => t.id === prevSelected.id);
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
      logger.error('Erro ao carregar chamados', error);
      
      // Só mostra toast se passou tempo suficiente desde o último erro
      const now = Date.now();
      if (now - lastErrorToastTimeRef.current > ERROR_TOAST_COOLDOWN) {
        lastErrorToastTimeRef.current = now;
        // Toast de erro com duração menor para não ficar muito tempo na tela
        showToastRef.current('Erro ao carregar chamados', 'error', 5000);
      }
    } finally {
      setLoading(false);
      setIsLoadingPage(false);
      loadTicketsGuard.end();
      if (pendingLoadTicketsRef.current) {
        pendingLoadTicketsRef.current = false;
        Promise.resolve().then(() => loadTicketsRef.current?.());
      }
    }
  }, [showOthers, backendStatuses, backendQuery, uiQueue, uiContactHistoryOnly, selectedTicketContactId, selectedTicketPhoneDigits, agent?.id, agent?.username, showToastRef]);

  const loadMoreTickets = useCallback(async () => {
    if (!hasMore || isLoadingPage || !nextCursor) return;
    setIsLoadingPage(true);
    try {
      const page = await listTicketsPaged({
        status: backendStatuses,
        limit: PAGE_SIZE,
        cursor: nextCursor,
        queue: uiQueue || undefined,
        q: backendQuery || undefined,
        contactId: uiContactHistoryOnly && selectedTicketContactId ? selectedTicketContactId : undefined,
        phoneNumber: uiContactHistoryOnly && !selectedTicketContactId && selectedTicketPhoneDigits ? selectedTicketPhoneDigits : undefined,
      });

      setTicketsBase((prev) => {
        const merged = mergeTicketsById(prev, page?.items || []);
        const shouldShowAssignedTicket = (assignedValue) => {
          if (assignedValue === undefined || assignedValue === null || assignedValue === '') return true;
          return assignedValue === agent?.id || assignedValue === agent?.username;
        };
        return showOthers ? merged : merged.filter((ticket) => shouldShowAssignedTicket(ticket?.assignedTo));
      });
      setNextCursor(page?.nextCursor || null);
      setHasMore(Boolean(page?.hasMore));
    } catch (error) {
      logger.error('Erro ao carregar próxima página de chamados', error);
    } finally {
      setIsLoadingPage(false);
    }
  }, [hasMore, isLoadingPage, nextCursor, backendStatuses, backendQuery, uiQueue, uiContactHistoryOnly, selectedTicketContactId, selectedTicketPhoneDigits, mergeTicketsById, showOthers, agent?.id, agent?.username]);

  // Atualiza ref quando loadTickets muda
  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
    loadMoreTicketsRef.current = loadMoreTickets;
  }, [loadTickets, loadMoreTickets]);

  const hasLoadedTicketsRef = React.useRef(false);
  useEffect(() => {
    if (!hasLoadedTicketsRef.current) {
      hasLoadedTicketsRef.current = true;
      return;
    }
    loadTickets();
  }, [loadTickets, showClosed, showOthers, uiSearchDebounced, uiQueue, uiChip, uiContactHistoryOnly, selectedTicketContactId, selectedTicketPhoneDigits]);

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

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry?.isIntersecting) return;
      if (loadMoreTicketsRef.current) {
        loadMoreTicketsRef.current();
      }
    }, {
      root: null,
      rootMargin: '200px 0px',
      threshold: 0.01,
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreTickets]);

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

  function extractTicketMediaInfo(msg) {
    const raw = msg?.raw || msg || {};
    const media = raw?.media && typeof raw.media === 'object' ? raw.media : {};
    const body = raw?.body && typeof raw.body === 'object' ? raw.body : {};
    const mediaKind = String(raw?.mediaKind || media?.kind || body?.kind || '').trim().toLowerCase();
    const documentId = String(raw?.documentId || media?.documentId || body?.documentId || '').trim();
    const mediaUrl = String(
      raw?.mediaUrl
      || media?.url
      || body?.url
      || body?.mediaUrl
      || body?.media_url
      || raw?.url
      || ((mediaKind === 'rag' && documentId) ? `/rag/documents/${encodeURIComponent(documentId)}/file` : '')
      || ''
    ).trim();
    if (!mediaUrl) return null;
    const fileName = String(
      raw?.fileName
      || media?.fileName
      || media?.filename
      || body?.fileName
      || body?.filename
      || ''
    ).trim() || null;
    const mimeType = String(
      raw?.mimeType
      || media?.mimeType
      || media?.mime_type
      || body?.mimeType
      || body?.mime_type
      || ''
    ).trim() || null;
    const typeRaw = String(
      raw?.type
      || raw?.messageType
      || media?.type
      || body?.type
      || ''
    ).trim().toLowerCase();
    const mediaType = ['image', 'video', 'audio', 'document'].includes(typeRaw)
      ? typeRaw
      : inferMediaType(fileName, mimeType);
    return { mediaType, mediaUrl, fileName, mediaKind, documentId: documentId || null };
  }

  function renderTimelineMessageContent(msg) {
    if (!msg) {
      return null;
    }

    const ticketMedia = msg.source === 'ticket' ? extractTicketMediaInfo(msg) : null;
    if (ticketMedia?.mediaUrl) {
      const mediaType = ticketMedia.mediaType;
      const mediaUrl = resolveSupportMediaUrl(ticketMedia.mediaUrl, msg?.raw?.tenantId || selectedTicket?.tenantId);
      const fileName = ticketMedia.fileName;
      const caption = msg.text && !String(msg.text || '').startsWith('[') ? msg.text : '';
      if (mediaType === 'image') {
        return (
          <div>
            {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
            <a href={mediaUrl} target="_blank" rel="noreferrer">Abrir imagem</a>
            <div style={{ marginTop: '8px' }}>
              <img src={mediaUrl} alt={fileName || 'imagem'} style={{ width: '100%', maxWidth: 'min(360px, 100%)', height: 'auto', borderRadius: '8px', border: '1px solid #eee' }} />
            </div>
          </div>
        );
      }
      if (mediaType === 'video') {
        return (
          <div>
            {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
            <a href={mediaUrl} target="_blank" rel="noreferrer">Abrir vídeo</a>
            <div style={{ marginTop: '8px' }}>
              <video controls src={mediaUrl} style={{ width: '100%', maxWidth: 'min(360px, 100%)', borderRadius: '8px' }} />
            </div>
          </div>
        );
      }
      if (mediaType === 'audio') {
        return (
          <div>
            {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
            <a href={mediaUrl} target="_blank" rel="noreferrer">Abrir áudio</a>
            <div style={{ marginTop: '8px' }}>
              <audio controls src={mediaUrl} style={{ width: '100%', maxWidth: 'min(360px, 100%)' }} />
            </div>
          </div>
        );
      }
      return (
        <div>
          {fileName ? <div style={{ marginBottom: '6px' }}><strong>{fileName}</strong></div> : null}
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          <a href={mediaUrl} target="_blank" rel="noreferrer">Abrir documento</a>
        </div>
      );
    }

    if (msg.source !== 'channel' || !msg.channel) {
      return <>{msg?.text}</>;
    }

    const cm = msg.channel;
    const type = String(cm?.type || '').toLowerCase();
    const body = cm?.body || {};
    const text = safeGetBodyText(body);

    const asMediaUrl = (candidate) => {
      const raw = String(candidate || '').trim();
      if (!raw) return null;
      if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
        return raw;
      }
      if (raw.startsWith('public/') || raw.startsWith('support-media/') || raw.startsWith('storage/support-media/')) {
        return raw;
      }
      if (/^[^/?#\\]+\.[a-z0-9]{2,10}$/i.test(raw)) {
        return raw;
      }
      return null;
    };

    const commonMeta = (() => {
      // Instagram: attachments normalmente têm payload.url
      if (Array.isArray(body.attachments) && body.attachments[0]?.payload?.url) {
        return { url: String(body.attachments[0].payload.url) };
      }
      // Outbound Instagram que persistimos: body.url
      const commonCandidates = [
        body.url,
        body.mediaUrl,
        body.media_url,
        body.media_id,
        body.mediaId,
        body.fileUrl,
      ];
      const found = commonCandidates.map(asMediaUrl).find(Boolean);
      if (found) return { url: found };
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
            <summary style={{ cursor: 'pointer', color: '#555' }}>Ver detalhes técnicos</summary>
            <pre style={{ marginTop: '8px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
              {safeStringify(interactive || body, 3000) || '[sem detalhes]'}
            </pre>
          </details>
        </div>
      );
    }

    if (type === 'image') {
      const image = body.image || body.raw?.image || {};
      const caption = safeGetBodyText(body) || '';
      const imageId = image?.id || body?.media_id || body?.mediaId || null;
      const url = commonMeta.url || image?.link || asMediaUrl(imageId);
      const resolvedUrl = resolveSupportMediaUrl(url, cm?.tenantId || selectedTicket?.tenantId);
      const mime = image?.mime_type || null;
      const id = imageId || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Imagem</div>
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {resolvedUrl ? (
            <div style={{ marginTop: '6px' }}>
              <a href={resolvedUrl} target="_blank" rel="noreferrer">Abrir imagem</a>
              <div style={{ marginTop: '8px' }}>
                <img src={resolvedUrl} alt={caption || 'imagem'} style={{ width: '100%', maxWidth: 'min(360px, 100%)', height: 'auto', borderRadius: '8px', border: '1px solid #eee' }} />
              </div>
            </div>
          ) : (
            <div className="support-message-meta">
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
      const documentId = doc?.id || body?.media_id || body?.mediaId || null;
      const url = commonMeta.url || doc?.link || asMediaUrl(documentId);
      const resolvedUrl = resolveSupportMediaUrl(url, cm?.tenantId || selectedTicket?.tenantId);
      const filename = doc?.filename || null;
      const mime = doc?.mime_type || null;
      const id = documentId || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Documento</div>
          {filename ? <div style={{ marginBottom: '4px' }}><strong>{String(filename)}</strong></div> : null}
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {resolvedUrl ? (
            <a href={resolvedUrl} target="_blank" rel="noreferrer">Abrir documento</a>
          ) : (
            <div className="support-message-meta">
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
      const audioId = audio?.id || body?.media_id || body?.mediaId || null;
      const url = commonMeta.url || audio?.link || asMediaUrl(audioId);
      const resolvedUrl = resolveSupportMediaUrl(url, cm?.tenantId || selectedTicket?.tenantId);
      const mime = audio?.mime_type || null;
      const id = audioId || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Áudio</div>
          {resolvedUrl ? (
            <div>
              <a href={resolvedUrl} target="_blank" rel="noreferrer">Abrir áudio</a>
              <div style={{ marginTop: '8px' }}>
                <audio controls src={resolvedUrl} style={{ width: '100%', maxWidth: 'min(360px, 100%)' }} />
              </div>
            </div>
          ) : (
            <div className="support-message-meta">
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
      const videoId = video?.id || body?.media_id || body?.mediaId || null;
      const url = commonMeta.url || video?.link || asMediaUrl(videoId);
      const resolvedUrl = resolveSupportMediaUrl(url, cm?.tenantId || selectedTicket?.tenantId);
      const mime = video?.mime_type || null;
      const id = videoId || null;
      return (
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Vídeo</div>
          {caption ? <div style={{ marginBottom: '6px' }}>{caption}</div> : null}
          {resolvedUrl ? (
            <div>
              <a href={resolvedUrl} target="_blank" rel="noreferrer">Abrir vídeo</a>
              <div style={{ marginTop: '8px' }}>
                <video controls src={resolvedUrl} style={{ width: '100%', maxWidth: 'min(360px, 100%)', borderRadius: '8px' }} />
              </div>
            </div>
          ) : (
            <div className="support-message-meta">
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
          <summary style={{ cursor: 'pointer', color: '#555' }}>Ver detalhes técnicos</summary>
          <pre style={{ marginTop: '8px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
            {safeStringify(body, 3000) || '[sem detalhes]'}
          </pre>
        </details>
      </div>
    );
  }

  function getReplySenderLabel(replySender) {
    const normalized = String(replySender || '').toLowerCase();
    if (normalized === 'user') return 'Usuário';
    if (normalized === 'agent') return 'Atendente';
    if (normalized === 'bot') return 'Bot';
    return 'Mensagem';
  }

  function buildReplyTargetFromMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;
    const externalMessageId = msg?.externalMessageId ? String(msg.externalMessageId) : '';
    const clientMessageId = msg?.clientMessageId ? String(msg.clientMessageId) : '';
    const messageId = msg?.raw?.id ? String(msg.raw.id) : '';
    const previewText = String(msg?.text || '').trim().slice(0, 160);
    if (!externalMessageId && !clientMessageId && !messageId && !previewText) return null;
    return {
      messageId: messageId || undefined,
      externalMessageId: externalMessageId || undefined,
      clientMessageId: clientMessageId || undefined,
      sender: String(msg?.sender || 'system'),
      text: previewText || undefined,
      timestamp: msg?.timestamp || undefined,
    };
  }

  function normalizeDeliveryError(rawError, reasonCodeRaw = null) {
    const reasonCode = reasonCodeRaw ? String(reasonCodeRaw).trim() : '';
    let text = '';

    if (rawError === null || rawError === undefined) {
      text = '';
    } else if (typeof rawError === 'string') {
      const trimmed = rawError.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const first = parsed[0];
            text = String(first?.message || first?.title || first?.error_data?.details || first?.code || trimmed);
          } else if (parsed && typeof parsed === 'object') {
            text = String(parsed.message || parsed.error || parsed.details || trimmed);
          } else {
            text = trimmed;
          }
        } catch {
          text = trimmed;
        }
      } else {
        text = trimmed;
      }
    } else if (typeof rawError === 'object') {
      text = String(rawError.message || rawError.error || rawError.details || rawError.code || '');
    } else {
      text = String(rawError);
    }

    const compact = text ? text.replace(/\s+/g, ' ').trim() : '';
    if (compact && reasonCode) return `${compact} (${reasonCode})`;
    if (compact) return compact;
    if (reasonCode) return reasonCode;
    return '';
  }

  function buildTimelineMessages(ticketMsgs = [], channelMsgs = [], deliveryFailures = null) {
    const byExternal = new Map();
    const byClient = new Map();
    const items = [];
    const failureByExternal = new Map();
    const failureByClient = new Map();

    const outboundFailures = Array.isArray(deliveryFailures?.outboundQueue) ? deliveryFailures.outboundQueue : [];
    const channelFailures = Array.isArray(deliveryFailures?.channelMessages) ? deliveryFailures.channelMessages : [];

    for (const f of outboundFailures) {
      const normalized = normalizeDeliveryError(f?.last_error, f?.reason_code);
      if (!normalized) continue;

      const externalId = f?.external_message_id ? String(f.external_message_id) : '';
      if (externalId) failureByExternal.set(externalId, normalized);

      const messagePayload = (f?.message && typeof f.message === 'object') ? f.message : null;
      const clientId = messagePayload?.meta?.clientMessageId ? String(messagePayload.meta.clientMessageId) : '';
      if (clientId) failureByClient.set(clientId, normalized);
    }

    for (const f of channelFailures) {
      const externalId = f?.external_message_id ? String(f.external_message_id) : '';
      if (!externalId) continue;
      const fromBody = normalizeDeliveryError(
        f?.body?.error
          || f?.body?.errors
          || f?.body?.message
          || null,
        f?.reason_code || null,
      );
      if (fromBody && !failureByExternal.has(externalId)) {
        failureByExternal.set(externalId, fromBody);
      }
    }

    const resolveDeliveryError = (externalMessageId, clientMessageId) => {
      const ext = externalMessageId ? failureByExternal.get(String(externalMessageId)) : '';
      if (ext) return ext;
      const cli = clientMessageId ? failureByClient.get(String(clientMessageId)) : '';
      if (cli) return cli;
      return '';
    };

    const pushItem = (it) => {
      items.push(it);
      if (it.externalMessageId) byExternal.set(it.externalMessageId, it);
      if (it.clientMessageId) byClient.set(it.clientMessageId, it);
    };

    for (const m of (Array.isArray(ticketMsgs) ? ticketMsgs : [])) {
      const ticketMedia = extractTicketMediaInfo(m);
      const fallbackText = ticketMedia
        ? `[${ticketMedia.mediaType}] ${ticketMedia.fileName || ''}`.trim()
        : '';
      pushItem({
        key: `t:${m?.id || Math.random().toString(36).slice(2)}`,
        source: 'ticket',
        sender: m?.sender || 'system',
        text: m?.text || fallbackText,
        timestamp: m?.timestamp || null,
        externalMessageId: m?.externalMessageId || null,
        clientMessageId: m?.clientMessageId || null,
        deliveryStatus: m?.deliveryStatus || null,
        deliveryError: m?.deliveryError || resolveDeliveryError(m?.externalMessageId, m?.clientMessageId),
        replyTo: m?.replyTo && typeof m.replyTo === 'object' ? m.replyTo : null,
        raw: m,
      });
    }

    for (const cm of (Array.isArray(channelMsgs) ? channelMsgs : [])) {
      const ext = cm?.externalMessageId || null;
      const channelClientMessageId = cm?.body?.meta?.clientMessageId || cm?.meta?.clientMessageId || null;
      const existing = (ext ? byExternal.get(ext) : null) || (channelClientMessageId ? byClient.get(channelClientMessageId) : null);
      const normalizedSender = (cm?.direction === 'in')
        ? 'user'
        : (cm?.direction === 'out' ? 'agent' : 'system');
      const channelType = String(cm?.type || '').toLowerCase();
      const channelBody = cm?.body || {};
      const channelMediaUrl = String(
        channelBody?.url
        || channelBody?.mediaUrl
        || channelBody?.media_url
        || channelBody?.image?.link
        || channelBody?.video?.link
        || channelBody?.audio?.link
        || channelBody?.document?.link
        || ''
      ).trim() || null;
      const channelMimeType = String(
        channelBody?.mimeType
        || channelBody?.mime_type
        || channelBody?.image?.mime_type
        || channelBody?.video?.mime_type
        || channelBody?.audio?.mime_type
        || channelBody?.document?.mime_type
        || ''
      ).trim() || null;
      const channelFileName = String(
        channelBody?.fileName
        || channelBody?.filename
        || channelBody?.document?.filename
        || ''
      ).trim() || null;
      const isChannelMedia = ['image', 'video', 'audio', 'document'].includes(channelType);

      if (existing) {
        existing.channel = cm;
        if (!existing.deliveryStatus && cm?.status) existing.deliveryStatus = cm.status;
        if (!existing.deliveryError) {
          existing.deliveryError = resolveDeliveryError(existing.externalMessageId || ext, existing.clientMessageId || channelClientMessageId);
        }
        if (isChannelMedia) {
          const nextRaw = existing.raw && typeof existing.raw === 'object' ? { ...existing.raw } : {};
          if (!nextRaw.mediaUrl && channelMediaUrl) nextRaw.mediaUrl = channelMediaUrl;
          if (!nextRaw.type) nextRaw.type = channelType;
          if (!nextRaw.messageType) nextRaw.messageType = channelType;
          if (!nextRaw.fileName && channelFileName) nextRaw.fileName = channelFileName;
          if (!nextRaw.mimeType && channelMimeType) nextRaw.mimeType = channelMimeType;
          existing.raw = nextRaw;
        }
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
        clientMessageId: channelClientMessageId || null,
        deliveryStatus: cm?.status || null,
        deliveryError: resolveDeliveryError(ext, channelClientMessageId),
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

  async function resolveAgentNamesInSystemMessages(items = []) {
    const list = Array.isArray(items) ? items : [];
    const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    const ids = new Set();

    for (const item of list) {
      if (!item || item.sender !== 'system' || typeof item.text !== 'string') continue;
      const matches = item.text.match(uuidRegex);
      if (!matches) continue;
      for (const id of matches) ids.add(id);
    }

    if (ids.size === 0) return list;

    const resolvedById = {};
    await Promise.all(Array.from(ids).map(async (id) => {
      try {
        const resp = await getAgentNameById(id);
        const name = resp?.agent?.name;
        if (name) resolvedById[id] = name;
      } catch {
        resolvedById[id] = id;
      }
    }));

    return list.map((item) => {
      if (!item || item.sender !== 'system' || typeof item.text !== 'string') return item;
      const text = item.text.replace(uuidRegex, (id) => resolvedById[id] || id);
      if (text === item.text) return item;
      return { ...item, text };
    });
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
      let deliveryFailuresData = { outboundQueue: [], channelMessages: [] };
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

      try {
        const failuresResult = await getTicketDeliveryFailures(ticketId);
        deliveryFailuresData = {
          outboundQueue: Array.isArray(failuresResult?.outboundQueue) ? failuresResult.outboundQueue : [],
          channelMessages: Array.isArray(failuresResult?.channelMessages) ? failuresResult.channelMessages : [],
        };
      } catch (err) {
        logger.debug('Falha ao enriquecer mensagens com erros de entrega (best-effort)', err);
      }

      const timeline = buildTimelineMessages(result.messages || [], convMsgs, deliveryFailuresData);
      const timelineWithNames = await resolveAgentNamesInSystemMessages(timeline);
      setTimelineMessages(timelineWithNames);
      
      // Marca como lidas se ticket está atribuído e em progresso
      setTickets(prevTickets => {
        const ticket = prevTickets.find(t => t.id === ticketId);
        if (ticket && ticket.status === 'in_progress' && ticket.unreadCount > 0) {
          markTicketAsRead(ticketId).catch(err => {
            logger.error('Erro ao marcar chamado como lido', err);
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

  const ticketTextBlob = React.useMemo(() => {
    const texts = [];
    for (const m of (Array.isArray(timelineMessages) ? timelineMessages : [])) {
      if (!m) continue;
      if (typeof m.text === 'string' && m.text.trim()) texts.push(m.text);
      const bodyText = m?.channel?.body?.text;
      if (typeof bodyText === 'string' && bodyText.trim()) texts.push(bodyText);
    }
    return texts.join('\n').trim();
  }, [timelineMessages]);

  const extractedEntities = React.useMemo(() => {
    if (!ticketTextBlob) return { emails: [], cpfs: [], cnpjs: [], phones: [], urls: [] };

    const emails = Array.from(new Set((ticketTextBlob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(s => s.toLowerCase()))).slice(0, 10);
    const urls = Array.from(new Set((ticketTextBlob.match(/https?:\/\/[^\s)]+/gi) || []))).slice(0, 10);
    const cpfs = Array.from(new Set((ticketTextBlob.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || []).map(s => s.replace(/\D/g, '')))).slice(0, 10);
    const cnpjs = Array.from(new Set((ticketTextBlob.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || []).map(s => s.replace(/\D/g, '')))).slice(0, 10);
    const phones = Array.from(new Set((ticketTextBlob.match(/\b\+?55\s*\(?\d{2}\)?\s*\d{4,5}-?\d{4}\b/g) || []).map(s => s.replace(/\s+/g, ' ').trim()))).slice(0, 10);

    return { emails, cpfs, cnpjs, phones, urls };
  }, [ticketTextBlob]);

  const isLikelyTicketId = (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) return false;
    if (/^\d{1,12}$/.test(value)) return true;
    if (/^#?\d{1,12}$/.test(value)) return true;
    if (/^(ticket|chamado|tck|tk)[-_]?\d{1,12}$/i.test(value)) return true;
    return false;
  };

  const aiEntitySummary = React.useMemo(() => {
    if (!Array.isArray(aiDiagnostics?.entities?.entitySummary)) return [];
    return aiDiagnostics.entities.entitySummary
      .map((item) => {
        const key = String(item?.key || '').trim().toLowerCase();
        const samples = Array.isArray(item?.samples) ? item.samples : [];
        if (key !== 'ticket_id') return item;

        const validSamples = samples.filter((sample) => isLikelyTicketId(sample));
        if (samples.length > 0 && validSamples.length === 0) return null;
        return {
          ...item,
          samples: validSamples,
          count: validSamples.length > 0 ? validSamples.length : item.count,
        };
      })
      .filter(Boolean);
  }, [aiDiagnostics]);

  // Carrega mensagens quando ticket é selecionado
  useEffect(() => {
    if (selectedTicket) {
      loadTicketMessages(selectedTicket.id, selectedTicket.conversationId);
      loadTicketSchedules(selectedTicket.id);
      loadAutonomousCampaigns();
      loadAutonomousRecommendations();
      
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
      setTicketSchedules([]);
      setAutonomousCampaigns([]);
      setAutonomousRecommendations([]);
      setAssignedTo(''); // Limpa o campo quando nenhum ticket está selecionado
      setMessageText('');
      setMessageAttachments([]);
      setEmojiPickerOpen(false);
      setQuickReplySlashOpen((prev) => (prev ? false : prev));
      setAiDiagnostics(null);
      setAiDiagnosticsError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicket?.id]); // Apenas quando o ID do ticket muda

  const runAiDiagnostics = useCallback(async (options = {}) => {
    if (!selectedTicket) return;
    const text = String(ticketTextBlob || '').trim();
    if (!text) {
      setAiDiagnostics(null);
      setAiDiagnosticsError('Sem texto suficiente para diagnosticar.');
      return;
    }

    const maxChars = 5000;
    const diagnosticText = text.length > maxChars ? text.slice(-maxChars) : text;
    const tenantId = selectedTicket.tenantId || agent?.tenantId || null;
    const channel = selectedTicket.channelType || 'whatsapp';

    setAiDiagnosticsLoading(true);
    setAiDiagnosticsError('');
    try {
      const [entityResult, tagResult, sentimentResult] = await Promise.allSettled([
        debugExtractEntities(diagnosticText, { tenantId, channel }),
        suggestSupportTags(diagnosticText),
        suggestSupportSentiment(diagnosticText),
      ]);
      const entityRes = entityResult.status === 'fulfilled' ? entityResult.value : null;
      const tagRes = tagResult.status === 'fulfilled' ? tagResult.value : null;
      const sentimentRes = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null;
      if (!entityRes && !tagRes && !sentimentRes) {
        const rootError = entityResult.status === 'rejected'
          ? entityResult.reason
          : (tagResult.status === 'rejected' ? tagResult.reason : sentimentResult.reason);
        throw rootError || new Error('Falha ao gerar diagnóstico IA');
      }
      setAiDiagnostics({
        entities: entityRes || null,
        tags: tagRes || null,
        sentiment: sentimentRes || null,
        generatedAt: new Date().toISOString(),
      });
      if (selectedTicket?.id && Array.isArray(tagRes?.tags) && tagRes.tags.length > 0) {
        const normalizeTag = (value) => String(value || '').trim().toLowerCase();
        const getNamespace = (tag) => {
          const normalized = normalizeTag(tag);
          const idx = normalized.indexOf(':');
          return idx > 0 ? normalized.slice(0, idx) : '';
        };
        const existingTagsList = (selectedTicket.tags || []).map((t) => String(t || '').trim()).filter(Boolean);
        const existingTags = new Set(existingTagsList.map(normalizeTag));
        const ticketId = String(selectedTicket.id);
        const alreadyAutoApplied = autoAppliedAiTagsByTicketRef.current.get(ticketId) || new Set();
        const desiredByNamespace = new Map();
        for (const rawTag of tagRes.tags) {
          const tag = String(rawTag || '').trim();
          if (!tag) continue;
          const namespace = getNamespace(tag);
          const current = desiredByNamespace.get(namespace);
          const normalized = normalizeTag(tag);
          // Preferimos valores específicos sobre "...:unknown" no mesmo namespace.
          if (!current) {
            desiredByNamespace.set(namespace, tag);
            continue;
          }
          if (normalizeTag(current).endsWith(':unknown') && !normalized.endsWith(':unknown')) {
            desiredByNamespace.set(namespace, tag);
          }
        }

        const toApply = [];
        const toRemove = [];
        for (const desiredTag of desiredByNamespace.values()) {
          const desiredNormalized = normalizeTag(desiredTag);
          const namespace = getNamespace(desiredTag);
          if (!namespace) continue;
          const conflictingExisting = existingTagsList
            .filter((existingTag) => getNamespace(existingTag) === namespace)
            .map((existingTag) => String(existingTag || '').trim())
            .filter(Boolean)
            .filter((existingTag) => normalizeTag(existingTag) !== desiredNormalized)
            .filter((existingTag) => {
              const normalizedExisting = normalizeTag(existingTag);
              return normalizedExisting.endsWith(':unknown') || alreadyAutoApplied.has(normalizedExisting);
            });
          if (conflictingExisting.length > 0) {
            toRemove.push(...conflictingExisting);
          }
          if (!existingTags.has(desiredNormalized) && !alreadyAutoApplied.has(desiredNormalized)) {
            toApply.push(desiredTag);
          }
        }

        if (toRemove.length > 0 || toApply.length > 0) {
          const nextAutoApplied = new Set(alreadyAutoApplied);
          for (const tag of toRemove) {
            const normalized = normalizeTag(tag);
            try {
              const updated = await removeTagFromTicket(selectedTicket.id, tag);
              if (updated) {
                updateTicketLocal(updated);
              }
              nextAutoApplied.delete(normalized);
            } catch (removeErr) {
              logger.error('Erro ao remover tag conflitante sugerida automaticamente', { tag, error: removeErr });
            }
          }
          for (const tag of toApply) {
            nextAutoApplied.add(normalizeTag(tag));
            autoAppliedAiTagsByTicketRef.current.set(ticketId, nextAutoApplied);
            try {
              const updated = await addTagToTicket(selectedTicket.id, tag);
              if (updated) {
                updateTicketLocal(updated);
              }
            } catch (applyErr) {
              logger.error('Erro ao aplicar tag sugerida automaticamente', { tag, error: applyErr });
            }
          }
          autoAppliedAiTagsByTicketRef.current.set(ticketId, nextAutoApplied);
        }
      }
      if (entityResult.status === 'rejected' || tagResult.status === 'rejected' || sentimentResult.status === 'rejected') {
        const entityMessage = entityResult.status === 'rejected'
          ? (entityResult.reason?.message || 'entidades indisponível')
          : null;
        const tagMessage = tagResult.status === 'rejected'
          ? (tagResult.reason?.message || 'tags indisponível')
          : null;
        const sentimentMessage = sentimentResult.status === 'rejected'
          ? (sentimentResult.reason?.message || 'sentimento indisponível')
          : null;
        const partial = [entityMessage, tagMessage, sentimentMessage].filter(Boolean).join(' | ');
        setAiDiagnosticsError(`Diagnóstico parcial: ${partial}`);
      } else {
        setAiDiagnosticsError('');
      }
    } catch (err) {
      logger.error('Erro ao gerar diagnóstico IA', err);
      setAiDiagnosticsError(err?.body?.message || err?.message || 'Falha ao gerar diagnóstico IA');
    } finally {
      setAiDiagnosticsLoading(false);
    }
  }, [selectedTicket, ticketTextBlob, agent?.tenantId, updateTicketLocal]);

  useEffect(() => {
    if (!selectedTicket?.id) return;
    if (!ticketTextBlob) return;
    const timeoutId = setTimeout(() => {
      runAiDiagnostics({ auto: true });
    }, 220);
    return () => clearTimeout(timeoutId);
  }, [selectedTicket?.id, ticketTextBlob, runAiDiagnostics]);

  // Auto-refresh a cada 5 segundos - usa refs para evitar recriação do intervalo
  const selectedTicketIdRef = useLatestRef(selectedTicket?.id || null);

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

  useEffect(() => {
    setReplyTarget(null);
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
      showToast('Selecione um chamado primeiro', 'warning');
      return;
    }

    // Usa o valor do campo ou o valor padrão do agente
    const assigneeName = assignedTo.trim() || agent?.username || agent?.id || '';
    
    if (!assigneeName) {
      showToast('Informe o nome do atendente', 'warning');
      return;
    }

    try {
      const assignedTicket = await assignTicket(selectedTicket.id, assigneeName);
      showToastRef.current('Chamado atribuído com sucesso', 'success');

      const nextTicket = {
        ...selectedTicket,
        ...(assignedTicket && typeof assignedTicket === 'object' ? assignedTicket : {}),
        status: (assignedTicket && assignedTicket.status) ? assignedTicket.status : 'in_progress',
        assignedTo: (assignedTicket && assignedTicket.assignedTo) ? assignedTicket.assignedTo : assigneeName,
      };

      setSelectedTicket(nextTicket);
      setIsRightPanelCollapsed(true);
      await loadTicketMessages(nextTicket.id, nextTicket.conversationId);
      focusComposeInput();

      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    } catch (error) {
      logger.error('Erro ao atribuir chamado', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao atribuir chamado. Verifique se o atendente existe.';
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
      title: 'Fechar Chamado',
      message: 'Deseja realmente fechar este chamado? Esta ação não pode ser desfeita.',
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
      showToastRef.current('Chamado fechado com sucesso', 'success');
      if (selectedTicket?.id === closingTicketId) {
        setSelectedTicket(null);
        setTicketMessages([]);
      }
      setShowCloseModal(false);
      setClosingTicketId(null);
      if (loadTicketsRef.current) loadTicketsRef.current();
    } catch (error) {
      logger.error('Erro ao fechar chamado', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao fechar chamado. Tente novamente.';
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
    if (!selectedTicket) return;
    const text = String(messageText || '').trim();
    const attachmentsToSend = (messageAttachments || []).filter((att) => (
      att
      && (
        !!String(att.mediaUrl || '').trim()
        || (
          String(att.mediaKind || '').trim().toLowerCase() === 'rag'
          && !!String(att.documentId || '').trim()
        )
      )
    ));
    const hasAttachment = attachmentsToSend.length > 0;
    if (!text && !hasAttachment) {
      showToast('Digite uma mensagem ou anexe um arquivo', 'warning');
      return;
    }
    if (slashMode) {
      showToast('Selecione um item do menu "/" antes de enviar', 'warning');
      return;
    }

    const messageToSend = text;
    const replyToSnapshot = replyTarget && typeof replyTarget === 'object' ? { ...replyTarget } : null;
    const attachmentsSnapshot = hasAttachment ? attachmentsToSend.map((att) => ({ ...att })) : [];
    
    // Limpa o campo imediatamente para melhor UX
    setMessageText('');
    setReplyTarget(null);
    setMessageAttachments([]);
    setEmojiPickerOpen(false);
    setQuickReplySlashOpen((prev) => (prev ? false : prev));

    try {
      if (!hasAttachment) {
        await sendTicketMessage(selectedTicket.id, messageToSend, {
          ...(replyToSnapshot ? { replyTo: replyToSnapshot } : {}),
        });
      } else {
        for (let i = 0; i < attachmentsSnapshot.length; i += 1) {
          const attachment = attachmentsSnapshot[i];
          const textForThisMessage = i === 0 ? messageToSend : '';
          await sendTicketMessage(
            selectedTicket.id,
            textForThisMessage,
            {
              ...(i === 0 && replyToSnapshot ? { replyTo: replyToSnapshot } : {}),
              mediaKind: attachment.mediaKind || 'standard',
              documentId: attachment.documentId || undefined,
              mediaType: attachment.mediaType,
              mediaUrl: attachment.mediaUrl,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: Number.isFinite(attachment?.sizeBytes) ? Number(attachment.sizeBytes) : undefined,
            }
          );
        }
      }
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
      if (replyToSnapshot) setReplyTarget(replyToSnapshot);
      if (attachmentsSnapshot.length > 0) setMessageAttachments(attachmentsSnapshot);
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

  const openDeliveryFailures = async (ticketIdFromAction = null) => {
    const ticketId = ticketIdFromAction || selectedTicket?.id || selectedTicketIdRef.current || null;
    if (!ticketId) return;
    setShowDeliveryFailuresModal(true);
    setDeliveryFailuresLoading(true);
    try {
      const data = await getTicketDeliveryFailures(ticketId);
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
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
  };

  const formatTime = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const loadTicketSchedules = useCallback(async (ticketId) => {
    if (!ticketId) {
      setTicketSchedules([]);
      return;
    }
    setTicketSchedulesLoading(true);
    try {
      const out = await listSchedules({
        contextType: 'ticket',
        contextId: String(ticketId),
        limit: 50,
      });
      setTicketSchedules(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      logger.error('Erro ao carregar agendamentos do ticket', err);
      setTicketSchedules([]);
    } finally {
      setTicketSchedulesLoading(false);
    }
  }, []);

  const loadAutonomousCampaigns = useCallback(async () => {
    if (!canReadAutonomousScheduling) {
      setAutonomousCampaigns([]);
      setAutonomousCampaignsLoading(false);
      return;
    }
    if (typeof window !== 'undefined' && !window.localStorage.getItem('auth_token')) {
      setAutonomousCampaigns([]);
      setAutonomousCampaignsLoading(false);
      return;
    }
    setAutonomousCampaignsLoading(true);
    try {
      const out = await listAutonomousCampaigns({ limit: 20 });
      setAutonomousCampaigns(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      logger.error('Erro ao carregar campanhas da Agenda Autônoma', err);
      setAutonomousCampaigns([]);
    } finally {
      setAutonomousCampaignsLoading(false);
    }
  }, [canReadAutonomousScheduling]);

  const loadAutonomousRecommendations = useCallback(async () => {
    if (!canReadAutonomousScheduling) {
      setAutonomousRecommendations([]);
      return;
    }
    if (typeof window !== 'undefined' && !window.localStorage.getItem('auth_token')) {
      setAutonomousRecommendations([]);
      return;
    }
    try {
      const out = await listAutonomousRecommendations({
        serviceType: ticketSchedules?.[0]?.purpose || undefined,
      });
      setAutonomousRecommendations(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      logger.error('Erro ao carregar recomendações da Agenda Autônoma', err);
      setAutonomousRecommendations([]);
    }
  }, [canReadAutonomousScheduling, selectedTicket?.contactId, selectedTicket?.context, ticketSchedules]);

  const runAutonomousScheduling = useCallback(async () => {
    if (!canRunAutonomousScheduling) {
      showToast('Sem permissão para rodar Agenda Autônoma.', 'warning');
      return;
    }
    if (typeof window !== 'undefined' && !window.localStorage.getItem('auth_token')) {
      showToast('Sessão inválida para rodar Agenda Autônoma.', 'warning');
      return;
    }
    setAutonomousRunning(true);
    try {
      const scopedSchedule = Array.isArray(ticketSchedules) && ticketSchedules.length > 0 ? ticketSchedules[0] : null;
      const payload = scopedSchedule
        ? {
          contextType: selectedTicket?.id ? 'ticket' : undefined,
          contextId: selectedTicket?.id ? String(selectedTicket.id) : undefined,
          ownerId: scopedSchedule.ownerId || null,
          teamId: scopedSchedule.teamId || null,
          channel: selectedTicket?.channelType || 'whatsapp',
          serviceType: scopedSchedule.purpose || null,
          metadata: { triggeredFrom: 'support' },
        }
        : {};
      const out = await runAutonomousGapDetection(payload);
      showToast(`Agenda Autônoma executada. ${out?.created || 0} campanha(s) criada(s).`, 'success');
      await loadAutonomousCampaigns();
    } catch (err) {
      logger.error('Erro ao rodar Agenda Autônoma', err);
      showToast(err?.message || 'Erro ao rodar Agenda Autônoma', 'error');
    } finally {
      setAutonomousRunning(false);
    }
  }, [canRunAutonomousScheduling, loadAutonomousCampaigns, selectedTicket, showToast, ticketSchedules]);

  const addSelectedTicketToWaitingList = useCallback(async () => {
    if (!canUpdateAutonomousScheduling) {
      showToast('Sem permissão para atualizar waiting list.', 'warning');
      return;
    }
    const contactId = selectedTicket?.contactId || selectedTicket?.context?.metadata?.contactId || selectedTicket?.context?.variables?.contactId || null;
    if (!contactId) {
      showToast('Ticket sem contexto de contato CRM suficiente para waiting list.', 'warning');
      return;
    }
    try {
      await createAutonomousWaitingListEntry({
        contactId: String(contactId),
        contextType: 'ticket',
        contextId: selectedTicket?.id ? String(selectedTicket.id) : null,
        desiredChannel: selectedTicket?.channelType || 'whatsapp',
        serviceType: ticketSchedules?.[0]?.purpose || null,
        ownerId: ticketSchedules?.[0]?.ownerId || null,
        teamId: ticketSchedules?.[0]?.teamId || null,
        notes: `Adicionado pelo Support a partir do ticket ${selectedTicket?.id || ''}`.trim(),
      });
      showToast('Contato adicionado na waiting list.', 'success');
    } catch (err) {
      logger.error('Erro ao adicionar contato na waiting list da Agenda Autônoma', err);
      showToast(err?.message || 'Erro ao adicionar contato na waiting list', 'error');
    }
  }, [canUpdateAutonomousScheduling, selectedTicket, showToast, ticketSchedules]);

  const formatScheduleStatus = useCallback((status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'scheduled') return 'Agendado';
    if (s === 'in_progress') return 'Em andamento';
    if (s === 'done') return 'Concluído';
    if (s === 'no_show') return 'No-show';
    if (s === 'canceled') return 'Cancelado';
    if (s === 'draft') return 'Rascunho';
    return s || '-';
  }, []);

  const formatConfirmationStatus = useCallback((status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'pending') return 'Pendente';
    if (s === 'confirmed') return 'Confirmado';
    if (s === 'declined') return 'Recusado';
    if (s === 'not_required') return 'Não exigida';
    return s || '-';
  }, []);

  const handleManualReschedule = useCallback(async (schedule) => {
    const currentStart = schedule?.startAt ? new Date(schedule.startAt) : null;
    const currentEnd = schedule?.endAt ? new Date(schedule.endAt) : null;
    const durationMin = (currentStart && currentEnd)
      ? Math.max(5, Math.round((currentEnd.getTime() - currentStart.getTime()) / 60000))
      : 30;
    const promptDefault = currentStart && !Number.isNaN(currentStart.getTime())
      ? new Date(currentStart.getTime() - currentStart.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '';
    const nextLocal = window.prompt('Novo horário (AAAA-MM-DDTHH:mm):', promptDefault);
    if (!nextLocal) return;
    const parsed = new Date(nextLocal);
    if (Number.isNaN(parsed.getTime())) {
      showToast('Data/hora inválida', 'warning');
      return;
    }
    const nextStartIso = parsed.toISOString();
    const nextEndIso = new Date(parsed.getTime() + durationMin * 60000).toISOString();
    try {
      await rescheduleScheduleApi(schedule.id, {
        startAt: nextStartIso,
        endAt: nextEndIso,
        timezone: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        by: 'ui_support',
      });
      showToast('Agendamento reagendado', 'success');
      if (selectedTicket?.id) loadTicketSchedules(selectedTicket.id);
    } catch (err) {
      logger.error('Erro ao reagendar', err);
      showToast(err?.message || 'Erro ao reagendar', 'error');
    }
  }, [loadTicketSchedules, selectedTicket?.id, showToast]);

  const runScheduleAction = useCallback(async (action, schedule) => {
    if (!schedule?.id) return;
    try {
      if (action === 'confirm') {
        await confirmScheduleApi(schedule.id, { by: 'ui_support' });
      } else if (action === 'cancel') {
        await cancelScheduleApi(schedule.id, { reason: 'manual_support' });
      } else if (action === 'done') {
        await markScheduleDone(schedule.id);
      } else if (action === 'no_show') {
        await markScheduleNoShow(schedule.id);
      } else if (action === 'reschedule') {
        await handleManualReschedule(schedule);
        return;
      }
      showToast('Agendamento atualizado', 'success');
      if (selectedTicket?.id) loadTicketSchedules(selectedTicket.id);
    } catch (err) {
      logger.error('Erro ao executar ação de agendamento', err);
      showToast(err?.message || 'Erro ao atualizar agendamento', 'error');
    }
  }, [handleManualReschedule, loadTicketSchedules, selectedTicket?.id, showToast]);

  const formatTicketStatus = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'in_progress') return 'Em atendimento';
    if (normalized === 'waiting') return 'Aguardando';
    if (normalized === 'closed') return 'Fechado';
    if (!normalized) return 'Aberto';
    return normalized;
  };

  const formatTicketMode = (mode) => {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'bot' || normalized === 'assistant' || normalized === 'ai') return 'Bot';
    if (!normalized || normalized === 'human' || normalized === 'agent') return 'Humano';
    return normalized;
  };

  const formatEntityLabel = (rawKey) => {
    const key = String(rawKey || '').trim().toLowerCase();
    const entityMap = {
      ticket_id: 'ID do chamado',
      product_or_plan: 'Produto/plano',
      order_id: 'ID do pedido',
      invoice_id: 'ID da fatura',
      contract_id: 'ID do contrato',
      http_status: 'Status HTTP',
      error_code: 'Codigo de erro',
      money: 'Valor',
      date: 'Data',
      time: 'Hora',
      phone: 'Telefone',
      email: 'E-mail',
      cpf: 'CPF',
      cnpj: 'CNPJ',
      url: 'URL',
    };
    if (entityMap[key]) return entityMap[key];
    if (!key) return '-';
    return key.replace(/_/g, ' ');
  };

  const formatAiTag = (rawTag) => {
    const original = String(rawTag || '').trim();
    if (!original) return '';
    const idx = original.indexOf(':');
    if (idx < 0) return original;
    const ns = original.slice(0, idx).toLowerCase();
    const valueRaw = original.slice(idx + 1).trim();
    const namespaceMap = {
      intent: 'Intencao',
      severity: 'Severidade',
      topic: 'Tema',
      queue: 'Fila',
      department: 'Departamento',
      channel: 'Canal',
    };
    const valueMap = {
      sales: 'Vendas',
      comercial: 'Comercial',
      commercial: 'Comercial',
      'follow-up': 'Retorno',
      follow_up: 'Retorno',
      callback: 'Retorno',
      critical: 'Critica',
      high: 'Alta',
      medium: 'Media',
      low: 'Baixa',
      support: 'Suporte',
      billing: 'Cobranca',
      technical: 'Tecnico',
    };
    const nsLabel = namespaceMap[ns] || ns.replace(/_/g, ' ');
    const valueKey = valueRaw.toLowerCase();
    const valueLabel = valueMap[valueKey] || valueRaw.replace(/_/g, ' ');
    return `${nsLabel}: ${valueLabel}`;
  };

  const formatSentimentLabel = (rawValue) => {
    const value = String(rawValue || '').trim().toLowerCase();
    const sentimentMap = {
      positive: 'positivo',
      negative: 'negativo',
      neutral: 'neutro',
      mixed: 'misto',
    };
    return sentimentMap[value] || (value || '-');
  };

  const formatIntentLabel = (rawValue) => {
    const value = String(rawValue || '').trim().toLowerCase();
    const intentMap = {
      greeting: 'saudacao',
      question: 'duvida',
      complaint: 'reclamacao',
      purchase: 'compra',
      support: 'suporte',
      cancellation: 'cancelamento',
      billing: 'cobranca',
      feedback: 'feedback',
      goodbye: 'despedida',
      fallback: 'indefinida',
      unknown: 'indefinida',
    };
    return intentMap[value] || (value || '-');
  };

  const formatAiExplanation = (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    const normalized = value.toLowerCase();
    if (normalized === 'classification via nlp service.' || normalized === 'classificacao via servico nlp.') {
      return 'Classificação via serviço NLP.';
    }
    if (normalized === 'classification via ai service.' || normalized === 'classification via ai.') {
      return 'Classificação via serviço de IA.';
    }
    if (normalized === 'fallback heuristic classification.' || normalized === 'heuristic fallback classification.') {
      return 'Classificação heurística de fallback.';
    }
    return value;
  };

  const formatBadgeCount = (value) => {
    const n = Number(value || 0);
    if (n > 99) return '99+';
    return String(Math.max(0, n));
  };

  const getPhoneNode = (ticket) => {
    if (!ticket?.phoneNumber) return '—';
    return <MaskedPhone phone={ticket.phoneNumber} mask={phoneMaskingEnabled} />;
  };

  const getTicketPreview = (ticket, query = '') => {
    const text = String(ticket?.lastUserMessage || '').trim();
    if (!text) return 'Sem mensagens';
    const previewText = text.length <= 80 ? text : `${text.slice(0, 79)}…`;
    return highlightText(previewText, query);
  };

  const getAssignedLabel = (ticket) => ticket?.assignedToDisplay || ticket?.assignedTo || 'Não atribuído';
  const getQueueLabel = (ticket) => ticket?.queue || 'Sem fila';

  const supportGridColumns = React.useMemo(() => ([
    {
      id: 'contact',
      header: 'Contato',
      render: (ticket) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="support-ticket-contact-name">
            {highlightText(getContactName(ticket), uiSearchDebounced)}
          </span>
          <span className="support-ticket-contact-phone">
            {getPhoneNode(ticket)}
          </span>
        </div>
      ),
      sortValue: (ticket) => getContactName(ticket),
    },
    {
      id: 'ticket',
      header: 'Ticket',
      render: (ticket) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="support-ticket-id">#{ticket.id}</span>
          <span className="support-ticket-mode-badge">{formatTicketMode(ticket.mode)}</span>
        </div>
      ),
      sortValue: (ticket) => ticket.id,
      width: '110px',
    },
    {
      id: 'status',
      header: 'Status',
      render: (ticket) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className={`support-ticket-status ${getStatusClass(ticket.status)}`}>
            {formatTicketStatus(ticket.status)}
          </span>
          <span className="support-ticket-time">{formatTime(ticket.updatedAt)}</span>
        </div>
      ),
      sortValue: (ticket) => ticket.updatedAt || ticket.createdAt || '',
      width: '130px',
    },
    {
      id: 'preview',
      header: 'Última mensagem',
      render: (ticket) => (
        <div className="support-ticket-preview" style={{ maxWidth: '420px' }}>
          {getTicketPreview(ticket, uiSearchDebounced)}
        </div>
      ),
      sortable: false,
    },
    {
      id: 'meta',
      header: 'Responsável / Fila',
      render: (ticket) => (
        <div className="support-ticket-meta-row">
          {getAssignedLabel(ticket)} • {getQueueLabel(ticket)}
        </div>
      ),
      sortable: false,
      width: '220px',
    },
    {
      id: 'unread',
      header: 'Não lidas',
      render: (ticket) => (
        ticket.unreadCount > 0 ? (
          <span
            className="support-ticket-unread-badge"
            role="status"
            aria-label={`${ticket.unreadCount} mensagens não lidas`}
          >
            {formatBadgeCount(ticket.unreadCount)}
          </span>
        ) : '—'
      ),
      sortValue: (ticket) => Number(ticket.unreadCount || 0),
      width: '96px',
    },
  ]), [uiSearchDebounced, phoneMaskingEnabled]);

  const ticketQueueOptions = React.useMemo(() => {
    const fromTickets = (Array.isArray(ticketsBase) ? ticketsBase : [])
      .map((ticket) => String(ticket?.queue || '').trim())
      .filter(Boolean);
    const fromQueues = (Array.isArray(queues) ? queues : [])
      .map((queueItem) => {
        if (typeof queueItem === 'string') return queueItem;
        if (queueItem && typeof queueItem === 'object') return String(queueItem.name || queueItem.id || '').trim();
        return '';
      })
      .filter(Boolean);
    return Array.from(new Set([...fromQueues, ...fromTickets]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [queues, ticketsBase]);

  const ticketsIndexed = React.useMemo(() => {
    return (Array.isArray(ticketsBase) ? ticketsBase : []).map((ticket) => ({
      ...ticket,
      _searchIndex: ticket?._searchIndex || buildSearchIndex(ticket),
      _nameNorm: norm(getContactName(ticket)),
      _phoneDigits: digits(ticket?.phoneNumber || ''),
    }));
  }, [ticketsBase]);

  const ticketsView = React.useMemo(() => {
    let ticketsFiltered = applySupportUiFilters(ticketsIndexed, {
      uiChip,
      uiQueue,
    });
    ticketsFiltered = applySearchRanked(ticketsFiltered, uiSearchDebounced);
    return ticketsFiltered;
  }, [ticketsIndexed, uiChip, uiQueue, uiSearchDebounced]);

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

  const getDeliveryStatusBadge = (deliveryStatusRaw, deliveryErrorRaw = '') => {
    const s = deliveryStatusRaw ? String(deliveryStatusRaw).toLowerCase() : '';
    if (!s) return null;
    const deliveryError = normalizeDeliveryError(deliveryErrorRaw);
    if (s === 'pending') return { text: '…', title: 'Pendente', color: '#6b7280' };
    if (s === 'sent') return { text: '✓', title: 'Enviado', color: '#6b7280' };
    if (s === 'delivered') return { text: '✓✓', title: 'Entregue', color: '#6b7280' };
    if (s === 'read') return { text: '✓✓', title: 'Lido', color: '#2563eb' };
    if (s === 'failed') {
      return {
        text: '!',
        title: deliveryError ? `Falhou: ${deliveryError}` : 'Falhou',
        color: '#b91c1c',
        showTooltip: !!deliveryError,
      };
    }
    // fallback
    return { text: s, title: s, color: '#6b7280' };
  };

  const deliveryConsoleErrors = React.useMemo(() => {
    const items = Array.isArray(timelineMessages) ? timelineMessages : [];
    const out = [];
    for (const msg of items) {
      if (!msg) continue;
      const sender = String(msg.sender || '');
      if (sender !== 'agent' && sender !== 'bot') continue;
      const status = String(msg.deliveryStatus || '').toLowerCase();
      if (status !== 'failed') continue;
      const errorText = normalizeDeliveryError(msg.deliveryError || '');
      if (!errorText) continue;
      out.push({
        key: String(msg.key || `${msg.externalMessageId || msg.clientMessageId || Math.random()}`),
        timestamp: msg.timestamp || null,
        externalMessageId: msg.externalMessageId || null,
        clientMessageId: msg.clientMessageId || null,
        error: errorText,
      });
    }
    return out;
  }, [timelineMessages]);

  useEffect(() => {
    loggedDeliveryErrorKeysRef.current = new Set();
  }, [selectedTicket?.id]);

  useEffect(() => {
    for (const item of deliveryConsoleErrors) {
      const dedupeKey = `${selectedTicket?.id || 'no-ticket'}:${item.key}:${item.error}`;
      if (loggedDeliveryErrorKeysRef.current.has(dedupeKey)) continue;
      loggedDeliveryErrorKeysRef.current.add(dedupeKey);
      logger.error('[SupportPage] Falha de entrega outbound', {
        ticketId: selectedTicket?.id || null,
        externalMessageId: item.externalMessageId,
        clientMessageId: item.clientMessageId,
        error: item.error,
      });
    }
  }, [deliveryConsoleErrors, selectedTicket?.id]);

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
    return null;
  }

  const isTicketSelected = !!selectedTicket;
  const visibleAutonomousCampaigns = autonomousCampaigns.filter((item) => {
    if (!selectedTicket?.id) return true;
    return item.contextType === 'ticket' && String(item.contextId) === String(selectedTicket.id);
  });
  const autonomousCampaignsForDisplay = visibleAutonomousCampaigns.length > 0 ? visibleAutonomousCampaigns : autonomousCampaigns;
  const autonomousSlotsToday = autonomousCampaignsForDisplay.filter((item) => {
    if (!item?.gapStartAt) return false;
    const date = new Date(item.gapStartAt);
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }).length;
  const supportGridClassName = [
    'support-grid',
    isMobile ? 'is-mobile' : '',
    isMobile && isTicketSelected ? 'has-selected' : '',
    isMobile && !isRightPanelCollapsed ? 'right-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`support-page ${isMobile ? 'is-mobile' : ''}`}>
      <SupportWorkspaceHeader
        wsStatus={wsStatus}
        loadTickets={loadTicketsRef.current}
        loading={loading}
        queues={queues}
        setNewConversationQueue={setNewConversationQueue}
        setShowNewConversationModal={setShowNewConversationModal}
        setCrmContactSearch={setCrmContactSearch}
        setCrmContactResults={setCrmContactResults}
        setCrmContactsLoading={setCrmContactsLoading}
        setSelectedCrmContact={setSelectedCrmContact}
        webPushSupported={webPushSupported}
        webPushEnabled={webPushEnabled}
        webPushLoading={webPushLoading}
        handleDisableWebPush={handleDisableWebPush}
        handleEnableWebPush={handleEnableWebPush}
        uiContactHistoryOnly={uiContactHistoryOnly}
        canFilterBySelectedContactHistory={canFilterBySelectedContactHistory}
        selectedTicket={selectedTicket}
        getContactName={getContactName}
      />

      <SupportFiltersBar
        uiSearch={uiSearch}
        setUiSearch={setUiSearch}
        uiChip={uiChip}
        setUiChip={setUiChip}
        showClosed={showClosed}
        ticketQueueOptions={ticketQueueOptions}
        uiQueue={uiQueue}
        setUiQueue={setUiQueue}
        uiContactHistoryOnly={uiContactHistoryOnly}
        setUiContactHistoryOnly={setUiContactHistoryOnly}
        canFilterBySelectedContactHistory={canFilterBySelectedContactHistory}
        onClear={() => {
          setUiSearch('');
          setUiChip('all');
          setUiQueue('');
          setUiContactHistoryOnly(false);
        }}
      />

      <div className={supportGridClassName}>
        <SupportTicketList
          showOthers={showOthers}
          setShowOthers={setShowOthers}
          showClosed={showClosed}
          setShowClosed={setShowClosed}
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
          sentinelRef={sentinelRef}
          isLoadingPage={isLoadingPage}
          supportGridColumns={supportGridColumns}
        />

        {/* Painel de Detalhes e Ações */}
        <div className="support-details-panel">
          {selectedTicket ? (
            <>
              <div className="support-details-split">
                <SupportConversationPane
                  isMobile={isMobile}
                  selectedTicket={selectedTicket}
                  setSelectedTicket={setSelectedTicket}
                  isRightPanelCollapsed={isRightPanelCollapsed}
                  setIsRightPanelCollapsed={setIsRightPanelCollapsed}
                  handleAssign={handleAssign}
                  timelineMessages={timelineMessages}
                  messagesContainerRef={messagesContainerRef}
                  formatDate={formatDate}
                  getDeliveryStatusBadge={getDeliveryStatusBadge}
                  buildReplyTargetFromMessage={buildReplyTargetFromMessage}
                  showToast={showToast}
                  setReplyTarget={setReplyTarget}
                  focusComposeInput={focusComposeInput}
                  getReplySenderLabel={getReplySenderLabel}
                  renderTimelineMessageContent={renderTimelineMessageContent}
                  replyTarget={replyTarget}
                  composeContainerRef={composeContainerRef}
                  attachmentInputRef={attachmentInputRef}
                  handleAttachFiles={handleAttachFiles}
                  composeTextareaRef={composeTextareaRef}
                  messageText={messageText}
                  setMessageText={setMessageText}
                  composeSelectionRef={composeSelectionRef}
                  slashMode={slashMode}
                  quickReplySlashOpen={quickReplySlashOpen}
                  slashVisibleItems={slashVisibleItems}
                  closeSlashDropdown={closeSlashDropdown}
                  setSlashMenuActiveIndex={setSlashMenuActiveIndex}
                  slashMenuActiveIndex={slashMenuActiveIndex}
                  handleSlashItemSelect={handleSlashItemSelect}
                  executeSlashCommand={executeSlashCommand}
                  handleSendMessage={handleSendMessage}
                  handleComposePaste={handleComposePaste}
                  captureComposeSelection={captureComposeSelection}
                  setEmojiPickerOpen={setEmojiPickerOpen}
                  recordingAudio={recordingAudio}
                  stopMicrophoneRecording={stopMicrophoneRecording}
                  startMicrophoneRecording={startMicrophoneRecording}
                  uploadingAttachment={uploadingAttachment}
                  setShowRagAttachModal={setShowRagAttachModal}
                  recordingAudioSeconds={recordingAudioSeconds}
                  emojiPickerOpen={emojiPickerOpen}
                  emojiPickerRef={emojiPickerRef}
                  insertTextAtCursor={insertTextAtCursor}
                  messageAttachments={messageAttachments}
                  setMessageAttachments={setMessageAttachments}
                  resolveSupportMediaUrl={resolveSupportMediaUrl}
                  slashQuickReplyLoading={slashQuickReplyLoading}
                  slashQuickReplyPickerOpen={slashQuickReplyPickerOpen}
                  slashMenuRef={slashMenuRef}
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
                      <div>Status: <strong>{formatTicketStatus(selectedTicket.status)}</strong></div>
                      {selectedTicket.pauseReason ? (
                        <div>Motivo: <strong>{selectedTicket.pauseReason}</strong></div>
                      ) : null}
                      {selectedTicket?.context?.closeReasonName ? (
                        <div>Motivo de encerramento: <strong>{selectedTicket.context.closeReasonName}</strong></div>
                      ) : null}
                      {selectedTicket.channelType ? <div>Canal: <strong>{selectedTicket.channelType}</strong></div> : null}
                      {selectedTicket.conversationId ? <div>ID da conversa: <code>{selectedTicket.conversationId}</code></div> : null}
                      <div>Criado: {formatDate(selectedTicket.createdAt)}</div>
                    </div>
                  </div>

                  <CRMTimelinePanel
                    enabled={supportCockpitEnabled}
                    contactId={selectedTicketContactId}
                    profile={crmOperational.profile}
                    timeline={crmOperational.timeline}
                    loading={supportCockpitFlagLoading || crmOperational.loading}
                    formatDate={formatDate}
                  />

                  <OperationalSignalsCard
                    title="Sinais Operacionais"
                    subtitle="Sinais ativos para o contato selecionado."
                    tenantId={supportTenantId}
                    quickActionsScope="contact"
                    contactId={selectedTicketContactId}
                    supportContext={supportQuickActionContext}
                    enabled={supportCockpitEnabled}
                    signals={crmOperationalSignals.items}
                    loading={supportCockpitFlagLoading || crmOperationalSignals.loading}
                    error={crmOperationalSignals.error}
                    onRefresh={crmOperationalSignals.reload}
                    emptyMessage={selectedTicketContactId
                      ? 'Nenhum sinal operacional ativo para este contato.'
                      : 'Ticket sem vínculo de contato CRM para sinais operacionais.'}
                  />

                  <OperationalRecommendationsCard
                    title="Recomendações Operacionais"
                    subtitle="Ações sugeridas automaticamente para este contato."
                    tenantId={supportTenantId}
                    quickActionsScope="contact"
                    contactId={selectedTicketContactId}
                    supportContext={supportQuickActionContext}
                    enabled={supportCockpitEnabled}
                    recommendations={crmOperationalRecommendations.items}
                    loading={supportCockpitFlagLoading || crmOperationalRecommendations.loading}
                    error={crmOperationalRecommendations.error}
                    onRefresh={crmOperationalRecommendations.reload}
                    emptyMessage={selectedTicketContactId
                      ? 'Nenhuma recomendação operacional disponível para este contato.'
                      : 'Ticket sem vínculo de contato CRM para recomendações operacionais.'}
                  />

                  <PlaybookSuggestionCard
                    title="Playbooks Operacionais"
                    subtitle="Execução guiada de ações sugeridas para o contato selecionado."
                    enabled={supportCockpitEnabled}
                    suggestions={supportPlaybookSuggestions}
                    loading={supportCockpitFlagLoading || crmContactPlaybooks.loading || supportPlaybookExecution.loading}
                    error={crmContactPlaybooks.error || supportPlaybookExecution.error}
                    onExecute={handleExecuteSupportPlaybookSuggestion}
                    emptyMessage={selectedTicketContactId
                      ? 'Nenhum playbook sugerido para este contato.'
                      : 'Ticket sem vínculo de contato CRM para playbooks operacionais.'}
                  />

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <div style={{ fontWeight: 700 }}>Agendamentos</div>
                      <Button
                        onClick={() => setShowScheduleModal(true)}
                        style={{ width: 'auto', padding: '4px 10px', fontSize: '12px' }}
                      >
                        Novo
                      </Button>
                    </div>
                    {ticketSchedulesLoading ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Carregando...</div>
                    ) : ticketSchedules.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Nenhum agendamento para este ticket.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {ticketSchedules.map((schedule) => (
                          <div key={schedule.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontSize: '12px' }}>{schedule.purpose || 'compromisso'}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                                {formatScheduleStatus(schedule.status)}
                              </span>
                            </div>
                            <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                              {formatDate(schedule.startAt)} → {formatDate(schedule.endAt)}
                            </div>
                            <div style={{ marginTop: '2px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                              confirmação: <strong>{formatConfirmationStatus(schedule.confirmationStatus)}</strong>
                              {schedule.requiresConfirmation && schedule.confirmationStatus === 'pending' ? ' • aguardando cliente' : ''}
                            </div>
                            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              <Button onClick={() => runScheduleAction('confirm', schedule)} style={{ width: 'auto', padding: '4px 8px', fontSize: '11px' }}>Confirmar</Button>
                              <Button onClick={() => runScheduleAction('reschedule', schedule)} style={{ width: 'auto', padding: '4px 8px', fontSize: '11px' }}>Reagendar</Button>
                              <Button onClick={() => runScheduleAction('cancel', schedule)} style={{ width: 'auto', padding: '4px 8px', fontSize: '11px' }}>Cancelar</Button>
                              <Button onClick={() => runScheduleAction('done', schedule)} style={{ width: 'auto', padding: '4px 8px', fontSize: '11px' }}>Done</Button>
                              <Button onClick={() => runScheduleAction('no_show', schedule)} style={{ width: 'auto', padding: '4px 8px', fontSize: '11px' }}>No-show</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <div style={{ fontWeight: 700 }}>Agenda Autônoma</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Button
                          onClick={addSelectedTicketToWaitingList}
                          disabled={!canUpdateAutonomousScheduling}
                          style={{ width: 'auto', padding: '4px 10px', fontSize: '12px' }}
                        >
                          Waiting list
                        </Button>
                        <Button
                          onClick={runAutonomousScheduling}
                          disabled={autonomousRunning || !canRunAutonomousScheduling}
                          style={{ width: 'auto', padding: '4px 10px', fontSize: '12px' }}
                        >
                          {autonomousRunning ? 'Rodando...' : 'Rodar agenda autônoma'}
                        </Button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginBottom: '10px' }}>
                      <div style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '8px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Vagas livres hoje</div>
                        <div style={{ fontSize: '22px', fontWeight: 700 }}>{autonomousSlotsToday}</div>
                      </div>
                      <div style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '8px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Campanhas abertas</div>
                        <div style={{ fontSize: '22px', fontWeight: 700 }}>{autonomousCampaignsForDisplay.length}</div>
                      </div>
                    </div>
                    {!canReadAutonomousScheduling ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Sem permissão para visualizar campanhas da Agenda Autônoma.</div>
                    ) : autonomousCampaignsLoading ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Carregando...</div>
                    ) : autonomousCampaignsForDisplay.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {selectedTicket?.contactId ? 'Nenhuma campanha aberta para o contexto atual.' : 'Nenhuma campanha aberta. Ticket sem contato CRM não permite waiting list contextual.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {autonomousCampaignsForDisplay.slice(0, 3).map((campaign) => (
                          <div key={campaign.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                              <strong style={{ fontSize: '12px' }}>{campaign.serviceType || 'agenda_autonoma'}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{campaign.status}</span>
                            </div>
                            <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                              {formatDate(campaign.gapStartAt)} → {formatDate(campaign.gapEndAt)}
                            </div>
                            <div style={{ marginTop: '2px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                              contexto: <strong>{campaign.contextType}:{campaign.contextId}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {canReadAutonomousScheduling && autonomousRecommendations.length > 0 ? (
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Recommendations relevantes</div>
                        {autonomousRecommendations.slice(0, 2).map((item) => (
                          <div key={`${item.type}-${item.relatedEntityId || item.title}`} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '6px' }}>
                            <strong style={{ fontSize: '12px' }}>{item.title}</strong>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{item.message}</div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>{(item.reasonCodes || []).join(' • ')}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selectedTicket.status === 'waiting' && (
                    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                      <div style={{ fontWeight: 700, marginBottom: '8px' }}>Atribuição</div>
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
                          aria-label="Nome do atendente para atribuir o chamado"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAssign();
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Console de erros</div>
                    {deliveryConsoleErrors.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        Sem falhas de entrega no momento.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                        {deliveryConsoleErrors.slice(-8).reverse().map((it) => (
                          <div key={it.key} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '8px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                              {it.timestamp ? formatDate(it.timestamp) : '-'}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--color-danger)', whiteSpace: 'pre-wrap' }}>
                              {it.error}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Entidades</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {aiEntitySummary.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {aiEntitySummary.map((item) => (
                            <div key={item.key}>
                              <code>{formatEntityLabel(item.key)}</code> ({item.count})
                              {Array.isArray(item.samples) && item.samples.length > 0 ? `: ${item.samples.join(', ')}` : ''}
                            </div>
                          ))}
                        </div>
                      ) : (extractedEntities.emails.length === 0
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
                      {aiDiagnostics?.entities?.explanation ? (
                        <div style={{ marginTop: '8px', color: 'var(--color-text-tertiary)' }}>
                          Motivo IA: {aiDiagnostics.entities.explanation}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Sentimento</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {aiDiagnostics?.sentiment?.sentiment ? (
                        <div>
                          <div>
                            Classificação: <strong>{formatSentimentLabel(aiDiagnostics.sentiment.sentiment)}</strong>
                          </div>
                          {aiDiagnostics?.sentiment?.intent ? (
                            <div style={{ marginTop: '4px' }}>
                              Intenção: <strong>{formatIntentLabel(aiDiagnostics.sentiment.intent)}</strong>
                            </div>
                          ) : null}
                          {Number.isFinite(Number(aiDiagnostics?.sentiment?.confidence))
                            ? (
                              <div style={{ marginTop: '4px' }}>
                                Confiança: <strong>{Math.round(Number(aiDiagnostics.sentiment.confidence) * 100)}%</strong>
                              </div>
                            )
                            : null}
                          {aiDiagnostics?.sentiment?.explanation ? (
                            <div style={{ marginTop: '8px', color: 'var(--color-text-tertiary)' }}>
                              Motivo IA: {formatAiExplanation(aiDiagnostics.sentiment.explanation)}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div style={{ color: 'var(--color-text-tertiary)' }}>Sem análise de sentimento ainda.</div>
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
                            {formatAiTag(t)}
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(t)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                color: 'var(--color-text-tertiary)',
                              }}
                              aria-label={`Remover tag ${formatAiTag(t)}`}
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
                    {aiDiagnostics?.tags?.explanation ? (
                      <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        Motivo IA: {aiDiagnostics.tags.explanation}
                      </div>
                    ) : null}
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700 }}>Diagnóstico IA</div>
                      <Button
                        onClick={() => runAiDiagnostics({ manual: true })}
                        disabled={aiDiagnosticsLoading}
                        style={{ width: 'auto', padding: '4px 10px', fontSize: '12px' }}
                      >
                        {aiDiagnosticsLoading ? 'Analisando…' : 'Reanalisar'}
                      </Button>
                    </div>
                    {aiDiagnosticsError ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-danger)' }}>{aiDiagnosticsError}</div>
                    ) : aiDiagnosticsLoading && !aiDiagnostics ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Gerando diagnóstico…</div>
                    ) : aiDiagnostics ? (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>Tags geradas</div>
                          <div style={{ marginTop: '4px' }}>
                            {(aiDiagnostics.tags?.tags || []).length > 0
                              ? (aiDiagnostics.tags.tags || []).map((t) => formatAiTag(t)).join(', ')
                              : 'Sem tags geradas'}
                          </div>
                          {aiDiagnostics.tags?.explanation ? (
                            <div style={{ marginTop: '4px', color: 'var(--color-text-tertiary)' }}>
                              Motivo: {aiDiagnostics.tags.explanation}
                            </div>
                          ) : null}
                          {aiDiagnostics.tags?.reasons?.decisionBranch ? (
                            <div style={{ marginTop: '2px', color: 'var(--color-text-tertiary)' }}>
                              Regra aplicada: <code>{aiDiagnostics.tags.reasons.decisionBranch}</code>
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <div style={{ fontWeight: 600 }}>Entidades geradas</div>
                          {aiEntitySummary.length > 0 ? (
                            <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {aiEntitySummary.map((item) => (
                                <div key={item.key}>
                                  <code>{formatEntityLabel(item.key)}</code> ({item.count})
                                  {Array.isArray(item.samples) && item.samples.length > 0 ? `: ${item.samples.join(', ')}` : ''}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ marginTop: '4px' }}>Sem entidades geradas</div>
                          )}
                          {aiDiagnostics.entities?.explanation ? (
                            <div style={{ marginTop: '4px', color: 'var(--color-text-tertiary)' }}>
                              Motivo: {aiDiagnostics.entities.explanation}
                            </div>
                          ) : null}
                        </div>

                        <div style={{ color: 'var(--color-text-tertiary)' }}>
                          Atualizado em: {aiDiagnostics.generatedAt ? formatDate(aiDiagnostics.generatedAt) : '—'}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        Sem diagnóstico ainda.
                      </div>
                    )}
                  </div>

                  {Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 ? (
                    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                      <div style={{ fontWeight: 700, marginBottom: '8px' }}>Histórico de transferência</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {selectedTicket.context.handoverHistory.slice(-8).reverse().map((h, idx) => (
                          <div key={`${h.timestamp}-${idx}`} style={{ marginBottom: '6px' }}>
                            <div>{formatDate(h.timestamp)} • {h.mode === 'human' ? 'Humano' : 'Bot'}{h.actorUsername ? ` • ${h.actorUsername}` : ''}{h.reason ? ` • ${h.reason}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ minHeight: 0 }}>
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Registros</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button
                        type="button"
                        className="support-slash-menu-item"
                        onClick={() => setShowTicketEventsModal(true)}
                        style={{ border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', textAlign: 'left', width: '100%', display: 'block' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>Eventos do chamado</span>
                          <span className="support-ticket-unread-badge" style={{ minWidth: '24px', height: '24px' }}>
                            {ticketEvents.length}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="support-slash-menu-item"
                        onClick={() => setShowTicketAuditModal(true)}
                        style={{ border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', textAlign: 'left', width: '100%', display: 'block' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>Auditoria</span>
                          <span className="support-ticket-unread-badge" style={{ minWidth: '24px', height: '24px' }}>
                            {ticketAuditLoading ? '…' : ticketAuditLogs.length}
                          </span>
                        </div>
                      </button>
                    </div>
                  </div>
                </SupportDetailsSidebar>
              </div>
            </>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um chamado para ver detalhes e ações</p>
            </div>
          )}
        </div>
      </div>

      <PlaybookExecutionModal
        open={supportPlaybookModalOpen}
        playbook={activeSupportPlaybook}
        execution={supportPlaybookExecution.execution}
        loading={supportPlaybookExecution.loading}
        error={supportPlaybookExecution.error}
        onClose={() => {
          setSupportPlaybookModalOpen(false);
          supportPlaybookExecution.reset();
        }}
        onExecuteStep={handleExecuteSupportPlaybookStep}
        onExecuteNext={handleExecuteSupportPlaybookNext}
      />

      <ToastContainer />
      <ConfirmDialog />

      {/* Modal: Sem respostas rápidas cadastradas */}
      {showRagAttachModal && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rag-attach-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowRagAttachModal(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowRagAttachModal(false);
            }
          }}
        >
          <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="rag-attach-title" style={{ marginTop: 0 }}>Anexar do RAG</h2>
            <div style={{ marginBottom: '12px', color: 'var(--color-text-secondary)' }}>
              Selecione um documento já enviado ao RAG. O ticket salva apenas a referência do documento.
            </div>
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                value={ragAttachSearch}
                onChange={(e) => setRagAttachSearch(e.target.value)}
                placeholder="Buscar por título, nome de arquivo ou conteúdo..."
                className="support-form-input"
                aria-label="Buscar documento do RAG"
                autoFocus
              />
            </div>
            <div style={{ maxHeight: '380px', overflowY: 'auto', border: '1px solid var(--color-border-default)', borderRadius: '10px' }}>
              {ragAttachLoading ? (
                <div style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Carregando documentos...</div>
              ) : ragAttachDocuments.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Nenhum documento encontrado.</div>
              ) : (
                ragAttachDocuments.map((doc) => {
                  const storedFlag = doc?.metadata?.originalBinary?.stored;
                  const source = String(doc?.metadata?.source || '').trim().toLowerCase();
                  const hasFileNameHint = !!(doc?.metadata?.fileName || doc?.metadata?.filename || doc?.metadata?.originalBinary?.filename);
                  const attachable = storedFlag === true || source === 'file' || hasFileNameHint;
                  const fileName = String(
                    doc?.metadata?.originalBinary?.filename
                    || doc?.metadata?.fileName
                    || doc?.metadata?.filename
                    || doc?.title
                    || `documento-${doc.id}`
                  ).trim();
                  const mimeType = String(
                    doc?.metadata?.originalBinary?.mimeType
                    || doc?.metadata?.mime
                    || doc?.metadata?.fileType
                    || 'application/octet-stream'
                  ).trim();
                  const sizeBytes = Number(
                    doc?.metadata?.originalBinary?.sizeBytes
                    || doc?.metadata?.fileSize
                    || 0
                  );
                  return (
                    <button
                      type="button"
                      key={doc.id}
                      onClick={() => {
                        if (!attachable) return;
                        handleAttachRagDocument(doc);
                      }}
                      disabled={!attachable}
                      className="support-slash-menu-item"
                      style={{
                        width: '100%',
                        border: 'none',
                        borderBottom: '1px solid var(--color-border-default)',
                        borderRadius: 0,
                        textAlign: 'left',
                        opacity: attachable ? 1 : 0.6,
                        cursor: attachable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {doc.title || fileName}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                            {fileName} • {mimeType} • {Math.ceil((Number.isFinite(sizeBytes) ? sizeBytes : 0) / 1024)} KB
                          </div>
                          {!attachable ? (
                            <div style={{ fontSize: '12px', color: '#b45309', marginTop: '4px' }}>
                              Documento sem binário original anexável.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button
                onClick={() => setShowRagAttachModal(false)}
                style={{ background: 'var(--color-bg-secondary)' }}
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Sem respostas rápidas cadastradas */}
      {showNoQuickReplyDialog && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="no-quick-reply-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNoQuickReplyDialog(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowNoQuickReplyDialog(false);
          }}
        >
          <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="no-quick-reply-title" style={{ marginTop: 0 }}>Respostas rápidas</h2>
            <div style={{ marginBottom: '16px', color: 'var(--color-text-secondary)' }}>
              Não há respostas rápidas cadastradas no momento.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setShowNoQuickReplyDialog(false)} style={{ background: 'var(--color-bg-secondary)' }}>
                Entendi
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Falhas de entrega */}
      {showDeliveryFailuresModal && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delivery-failures-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDeliveryFailuresModal(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowDeliveryFailuresModal(false);
            }
          }}
        >
          <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="delivery-failures-title" style={{ marginTop: 0 }}>
              Falhas de entrega
            </h2>

            <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              Mostra itens com erro na saída e mensagens do canal marcadas como <strong>falha</strong>.
            </div>

            {deliveryFailuresLoading ? (
              <div style={{ padding: '12px 0' }}>Carregando...</div>
            ) : (
              <>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Fila de saída</div>
                  {deliveryFailures.outboundQueue.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#777' }}>Nenhuma falha registrada.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                      {deliveryFailures.outboundQueue.map((it) => {
                        const text = it?.message?.body?.text || it?.message?.body?.body || it?.message?.text || '';
                        const to = it?.message?.to || null;
                        const reasonCode = it?.reason_code || it?.reasonCode || null;
                        return (
                          <div key={it.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '10px' }}>
                            <div className="support-message-meta">
                              <strong>{it.channel_type}</strong> • {it.status} • tentativas: {it.attempts ?? '-'}
                              {to ? ` • para: ${to}` : ''}
                            </div>
                            {reasonCode ? (
                              <div style={{ fontSize: '12px', color: '#b45309', marginBottom: '6px' }}>
                                reason_code: <strong>{String(reasonCode)}</strong>
                              </div>
                            ) : null}
                            <div style={{ fontSize: '13px', marginBottom: '6px', whiteSpace: 'pre-wrap' }}>
                              {text ? text : <span style={{ color: '#999' }}>(sem texto)</span>}
                            </div>
                            {it.last_error ? (
                              <div style={{ fontSize: '12px', color: '#b91c1c', marginBottom: '8px' }}>
                                {String(it.last_error).slice(0, 500)}
                              </div>
                            ) : null}
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                              <Button
                                onClick={async () => {
                                  if (!selectedTicket) return;
                                  if (!text || !String(text).trim()) {
                                    showToast('Não há texto para reenviar', 'warning');
                                    return;
                                  }
                                  try {
                                    await sendTicketMessage(selectedTicket.id, String(text));
                                    showToastRef.current('Reenvio solicitado', 'success', 2500);
                                  } catch (err) {
                                    logger.error('Erro ao reenviar', err);
                                    showToast('Erro ao reenviar mensagem', 'error');
                                  }
                                }}
                              >
                                Reenviar
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Mensagens do canal (com falha)</div>
                  {deliveryFailures.channelMessages.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#777' }}>Nenhuma mensagem do canal marcada como falha.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
                      {deliveryFailures.channelMessages.map((m) => (
                        <div key={m.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '10px' }}>
                          <div className="support-message-meta">
                            <strong>{m.channel_type}</strong> • {m.status} • {m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : ''}
                          </div>
                          <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>
                            {m?.body?.text ? String(m.body.text) : JSON.stringify(m.body || {})}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <Button
                    onClick={() => setShowDeliveryFailuresModal(false)}
                    style={{ background: 'var(--color-bg-secondary)' }}
                  >
                    Fechar
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Eventos do chamado */}
      {showTicketEventsModal && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-events-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTicketEventsModal(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowTicketEventsModal(false);
          }}
        >
          <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="ticket-events-title" style={{ marginTop: 0 }}>Eventos do chamado</h2>
            <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              {ticketEvents.length} item(ns)
            </div>
            <div className="support-table-wrap">
              <div style={{ minWidth: '620px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px 170px 1fr', gap: '8px', fontSize: '12px', fontWeight: 700, padding: '8px', borderBottom: '1px solid var(--color-border-default)' }}>
                  <div>Tipo</div>
                  <div>Data</div>
                  <div>Payload</div>
                </div>
                <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {ticketEvents.length === 0 ? (
                    <div style={{ padding: '12px 8px', color: 'var(--color-text-tertiary)' }}>Sem eventos para este chamado.</div>
                  ) : (
                    ticketEvents.map((ev, idx) => (
                      <div key={ev.id || `${ev.type}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '180px 170px 1fr', gap: '8px', fontSize: '12px', padding: '10px 8px', borderBottom: '1px solid var(--color-border-default)' }}>
                        <div style={{ fontWeight: 600 }}>{ev.type || '-'}</div>
                        <div>{formatDate(ev.createdAt || ev.timestamp)}</div>
                        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>
                          {ev?.payload ? (typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload, null, 2)) : '-'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button onClick={() => setShowTicketEventsModal(false)} style={{ background: 'var(--color-bg-secondary)' }}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Auditoria */}
      {showTicketAuditModal && (
        <div
          className="support-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-audit-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTicketAuditModal(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowTicketAuditModal(false);
          }}
        >
          <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="ticket-audit-title" style={{ marginTop: 0 }}>Auditoria</h2>
            <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              {ticketAuditLoading ? 'Carregando…' : `${ticketAuditLogs.length} item(ns)`}
            </div>
            <div className="support-table-wrap">
              <div style={{ minWidth: '700px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 170px 130px 1fr', gap: '8px', fontSize: '12px', fontWeight: 700, padding: '8px', borderBottom: '1px solid var(--color-border-default)' }}>
                  <div>Ação</div>
                  <div>Data</div>
                  <div>Usuário</div>
                  <div>Detalhes</div>
                </div>
                <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {ticketAuditLoading ? (
                    <div style={{ padding: '12px 8px' }}>Carregando…</div>
                  ) : ticketAuditLogs.length === 0 ? (
                    <div style={{ padding: '12px 8px', color: 'var(--color-text-tertiary)' }}>Sem logs de auditoria para este chamado.</div>
                  ) : (
                    ticketAuditLogs.map((l, idx) => (
                      <div key={`${l.timestamp || l.createdAt || idx}`} style={{ display: 'grid', gridTemplateColumns: '160px 170px 130px 1fr', gap: '8px', fontSize: '12px', padding: '10px 8px', borderBottom: '1px solid var(--color-border-default)' }}>
                        <div style={{ fontWeight: 600 }}>{l.action || '-'}</div>
                        <div>{formatDate(l.timestamp || l.createdAt)}</div>
                        <div>{l.username || 'sistema'}</div>
                        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>
                          {l.details ? (typeof l.details === 'string' ? l.details : JSON.stringify(l.details, null, 2)) : '-'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button onClick={() => setShowTicketAuditModal(false)} style={{ background: 'var(--color-bg-secondary)' }}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

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
              Encerrar Chamado
            </h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Motivo de encerramento *
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

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Tags (opcional)
              </label>
              <input
                type="text"
                value={closeTagsInput}
                onChange={(e) => setCloseTagsInput(e.target.value)}
                placeholder="Ex: cobrança, prioridade, vip (separadas por vírgula)"
                className="support-form-input"
                list="support-known-tags"
              />
              <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                Dica: use tags curtas e consistentes.
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
              resetNewConversationForm();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              resetNewConversationForm();
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
                htmlFor="new-conversation-crm-search"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
              >
                Buscar Contato no CRM (opcional)
              </label>
              <input
                id="new-conversation-crm-search"
                type="text"
                value={crmContactSearch}
                onChange={(e) => {
                  const next = e.target.value;
                  setCrmContactSearch(next);
                  if (!next.trim()) {
                    setSelectedCrmContact(null);
                  }
                }}
                placeholder="Digite nome, telefone ou e-mail"
                className="support-form-input"
              />
              {crmContactsLoading ? (
                <small style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Buscando contatos...</small>
              ) : null}
              {!crmContactsLoading && crmContactSearch.trim().length >= 2 && crmContactResults.length === 0 ? (
                <small style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Nenhum contato encontrado.</small>
              ) : null}
              {crmContactResults.length > 0 ? (
                <div
                  style={{
                    marginTop: '8px',
                    maxHeight: '160px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: '8px',
                    background: 'var(--color-bg-elevated)',
                  }}
                >
                  {crmContactResults.map((contact) => (
                    <button
                      key={String(contact?.id || `${contact?.name || ''}-${contact?.phone || ''}`)}
                      type="button"
                      className="support-slash-menu-item"
                      style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
                      onClick={() => {
                        const contactPhone = String(contact?.phone || '').trim();
                        const formattedPhone = contactPhone.startsWith('+') ? contactPhone : `+${contactPhone.replace(/\D/g, '')}`;
                        setSelectedCrmContact(contact);
                        setCrmContactResults([]);
                        setCrmContactSearch(String(contact?.name || contactPhone || contact?.email || ''));
                        if (formattedPhone && formattedPhone !== '+') {
                          setNewConversationPhone(formattedPhone);
                        }
                        setNewConversationCustomerName(String(contact?.name || ''));
                      }}
                    >
                      <strong>{String(contact?.name || 'Sem nome')}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {String(contact?.phone || '-')} {contact?.email ? `• ${String(contact.email)}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedCrmContact ? (
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <small style={{ color: 'var(--color-status-success)', fontSize: '12px' }}>
                    Contato selecionado: {String(selectedCrmContact?.name || selectedCrmContact?.phone || selectedCrmContact?.email || '-')}
                  </small>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCrmContact(null);
                      setCrmContactSearch('');
                      setCrmContactResults([]);
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--color-status-error)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      textDecoration: 'underline',
                    }}
                  >
                    Limpar
                  </button>
                </div>
              ) : null}
            </div>
            
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
                htmlFor="new-conversation-customer-name"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
              >
                Nome do Cliente (opcional)
              </label>
              <input
                id="new-conversation-customer-name"
                type="text"
                value={newConversationCustomerName}
                onChange={(e) => setNewConversationCustomerName(e.target.value)}
                placeholder="Nome para identificar o contato"
                className="support-form-input"
              />
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
                onClick={() => resetNewConversationForm()}
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
                      customerName: newConversationCustomerName.trim() || undefined,
                    });

                    showToast('Conversa iniciada com sucesso!', 'success');
                    resetNewConversationForm();

                    // Recarrega tickets
                    if (loadTicketsRef.current) {
                      loadTicketsRef.current();
                    }

                    // Seleciona o ticket criado
                    handleSelectTicket(ticket);
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
      {showScheduleModal && selectedTicket ? (
        <ScheduleModal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          lockReferences
          contextType="ticket"
          contextId={String(selectedTicket.id)}
          contactId={selectedTicket.contactId || ''}
          conversationId={selectedTicket.conversationId || ''}
          defaultPurpose="retorno"
          defaultChannel={selectedTicket.channelType || 'whatsapp'}
          suggestionMessages={(conversationMessages || [])
            .slice(-12)
            .map((m) => m?.text || m?.body || m?.message || '')
            .filter(Boolean)}
          title={`Agendar para ticket #${selectedTicket.id}`}
          onCreated={() => {
            showToast('Agendamento criado', 'success');
          }}
        />
      ) : null}
    </div>
  );
}
