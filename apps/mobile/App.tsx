import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Image, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Video } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import { getJson, normalizeApiRequestError, postFormData, postJson } from './src/api';
import { loginWithPassword } from './src/auth';
import { getApiBaseUrlResolution, getApiSourceLabel } from './src/config';
import { registerNativePush, unregisterNativePush } from './src/push';
import { useAuth } from './src/hooks/useAuth';
import { useTickets } from './src/hooks/useTickets';
import { useWebSocket } from './src/hooks/useWebSocket';
import { isExpoGoRuntime } from './src/runtime';
import { clearStoredSession, loadStoredSession, saveStoredSession } from './src/session';
import type { SupportMessage, SupportTicket, TicketDeliveryFailures, TicketTimelineItem } from './src/support-types';

const APP_VERSION = '1.0.0';
const RESULTS_LOGO = require('./assets/home_results_29.png');
const MESSAGE_PAGE_SIZE = 30;
const MESSAGE_LOAD_MORE_TOP_THRESHOLD = 24;
const TICKET_PREVIEW_MAX = 80;
const CRM_LOOKUP_RETRY_COOLDOWN_MS = 120000;
const CRM_LOOKUP_SEQUENCE_DELAY_MS = 120;
const BRAND_RED_MAIN = '#C62828';
const BRAND_RED_SOFT = '#E57373';
const SUPPORT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

type MediaType = 'image' | 'video' | 'audio' | 'document';

type DraftAttachment = {
  mediaType: MediaType;
  mediaUrl: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
};

type SlashCommandItem = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  action: () => void;
};

function sanitizeBaseUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildWebSocketUrl(baseUrl: string): string {
  const normalized = sanitizeBaseUrl(baseUrl);
  const wsBase = normalized.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/ws`;
}

function formatBadgeCount(value: number): string {
  if (value > 99) return '99+';
  return String(Math.max(0, value));
}

function getTicketUnreadCount(ticket: SupportTicket | null | undefined): number {
  if (!ticket || typeof ticket !== 'object') return 0;
  const raw = (ticket as SupportTicket & { unread_count?: unknown }).unreadCount
    ?? (ticket as SupportTicket & { unread_count?: unknown }).unread_count;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeSupportTicket(ticket: SupportTicket): SupportTicket {
  const source = (ticket || {}) as SupportTicket & {
    unread_count?: unknown;
    assigned_to?: unknown;
    last_user_message?: unknown;
    phone_number?: unknown;
    conversation_id?: unknown;
  };

  return {
    ...source,
    unreadCount: getTicketUnreadCount(source),
    assignedTo: source.assignedTo ?? (typeof source.assigned_to === 'string' ? source.assigned_to : undefined),
    lastUserMessage:
      source.lastUserMessage ?? (typeof source.last_user_message === 'string' ? source.last_user_message : undefined),
    phoneNumber: source.phoneNumber ?? (typeof source.phone_number === 'string' ? source.phone_number : undefined),
    conversationId:
      source.conversationId ?? (typeof source.conversation_id === 'string' ? source.conversation_id : undefined),
  };
}

function logFrontend(event: string, details: Record<string, unknown> = {}): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.log('[frontend]', event, details);
}

function formatApiErrorMessage(err: unknown, fallback = 'Erro na requisição'): string {
  const info = normalizeApiRequestError(err);
  const traceSuffix = info.traceId ? ` (trace: ${info.traceId})` : '';
  if (info.code && info.code !== 'UNKNOWN_ERROR') {
    return `${fallback}: [${info.code}] ${info.message}${traceSuffix}`;
  }
  return `${fallback}: ${info.message}${traceSuffix}`;
}

async function clearSystemNotificationBadge(): Promise<void> {
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // best-effort: alguns launchers Android ignoram limpeza programática
  }
}

type ThemeName = 'dark' | 'light';

type Theme = {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  borderDefault: string;
  borderHover: string;
  accentPrimary: string;
  accentLight: string;
  statusError: string;
  shadow: string;
  bubbleA: string;
  bubbleB: string;
  panel: string;
};

const WS_STATUS_META: Record<string, { label: string; color: string }> = {
  ready: { label: 'Conectado', color: '#10b981' },
  auth: { label: 'Autenticando...', color: '#5e6ad2' },
  auth_error: { label: 'Falha de autenticação', color: '#ef4444' },
  connecting: { label: 'Conectando...', color: '#5e6ad2' },
  disconnected: { label: 'Desconectado', color: '#ef4444' },
};

const THEMES: Record<ThemeName, Theme> = {
  dark: {
    bgPrimary: '#0a0a0a',
    bgSecondary: '#111111',
    bgTertiary: '#1a1a1a',
    textPrimary: '#ffffff',
    textSecondary: '#a0a0a0',
    textTertiary: '#707070',
    borderDefault: '#2a2a2a',
    borderHover: '#3a3a3a',
    accentPrimary: BRAND_RED_SOFT,
    accentLight: 'rgba(229, 115, 115, 0.15)',
    statusError: BRAND_RED_MAIN,
    shadow: 'rgba(0, 0, 0, 0.45)',
    bubbleA: 'rgba(229, 115, 115, 0.12)',
    bubbleB: 'rgba(198, 40, 40, 0.08)',
    panel: '#111111',
  },
  light: {
    bgPrimary: '#F6F7F9',
    bgSecondary: '#FFFFFF',
    bgTertiary: '#F0F2F5',
    textPrimary: '#1F2937',
    textSecondary: '#4B5563',
    textTertiary: '#6B7280',
    borderDefault: '#E1E4E8',
    borderHover: '#D1D5DB',
    accentPrimary: BRAND_RED_MAIN,
    accentLight: 'rgba(198, 40, 40, 0.1)',
    statusError: BRAND_RED_MAIN,
    shadow: 'rgba(0, 0, 0, 0.12)',
    bubbleA: 'rgba(229, 115, 115, 0.08)',
    bubbleB: 'rgba(198, 40, 40, 0.05)',
    panel: '#FFFFFF',
  },
};

export default function App() {
  const { height: viewportHeight } = useWindowDimensions();
  const apiResolution = useMemo(() => getApiBaseUrlResolution(), []);
  const [apiBaseUrl, setApiBaseUrl] = useState(() => sanitizeBaseUrl(apiResolution.baseUrl));

  const {
    username,
    setUsername,
    password,
    setPassword,
    authToken,
    setAuthToken,
    agentId,
    setAgentId,
    tenantId,
    setTenantId,
    sessionBootstrapping,
    setSessionBootstrapping,
    status,
    setStatus,
    error,
    setError,
    registeredPush,
    setRegisteredPush,
    loading,
    setLoading,
    focusedField,
    setFocusedField,
    startupBlockedReason,
    setStartupBlockedReason,
  } = useAuth();

  const {
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
  } = useTickets(MESSAGE_PAGE_SIZE);

  const [themeName, setThemeName] = useState<ThemeName>('dark');
  const {
    wsStatusPhase,
    setWsStatusPhase,
    wsConnected,
    setWsConnected,
    wsAuthenticated,
    setWsAuthenticated,
    wsAuthFailed,
    setWsAuthFailed,
    wsLastEvent,
    setWsLastEvent,
  } = useWebSocket();
  const [routePreview, setRoutePreview] = useState<string | null>(null);
  const [ticketActionLoading, setTicketActionLoading] = useState(false);
  const [deliveryFailuresLoading, setDeliveryFailuresLoading] = useState(false);
  const [deliveryFailures, setDeliveryFailures] = useState<TicketDeliveryFailures>({
    outboundQueue: [],
    channelMessages: [],
  });
  const [showDeliveryFailures, setShowDeliveryFailures] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [draftAttachment, setDraftAttachment] = useState<DraftAttachment | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const responseListener = useRef<{ remove: () => void } | null>(null);
  const receivedListener = useRef<{ remove: () => void } | null>(null);
  const appStateListener = useRef<{ remove: () => void } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsDisconnectDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const loadingMoreMessagesRef = useRef(false);
  const messageScrollOffsetRef = useRef(0);
  const messageContentHeightRef = useRef(0);
  const pendingScrollRestoreRef = useRef<{ prevOffset: number; prevHeight: number } | null>(null);
  const selectedTicketIdRef = useRef<string | null>(null);
  const crmLookupCacheRef = useRef<Record<string, string>>({});
  const agentNameCacheRef = useRef<Record<string, string>>({});
  const crmLookupInFlightRef = useRef<Set<string>>(new Set());
  const crmLookupFailedRef = useRef<Set<string>>(new Set());
  const crmLookupCooldownUntilRef = useRef(0);
  const [crmLookupCooldownUntil, setCrmLookupCooldownUntil] = useState(0);

  const theme = THEMES[themeName];
  const wsStatus = WS_STATUS_META[wsStatusPhase] || WS_STATUS_META.disconnected;

  useEffect(() => {
    if (wsConnected && wsAuthenticated) {
      if (wsDisconnectDelayRef.current) {
        clearTimeout(wsDisconnectDelayRef.current);
        wsDisconnectDelayRef.current = null;
      }
      setWsStatusPhase('ready');
      return;
    }
    if (wsConnected && wsAuthFailed) {
      if (wsDisconnectDelayRef.current) {
        clearTimeout(wsDisconnectDelayRef.current);
        wsDisconnectDelayRef.current = null;
      }
      setWsStatusPhase('auth_error');
      return;
    }
    if (wsConnected && !wsAuthenticated) {
      if (wsDisconnectDelayRef.current) {
        clearTimeout(wsDisconnectDelayRef.current);
        wsDisconnectDelayRef.current = null;
      }
      setWsStatusPhase('auth');
      return;
    }

    setWsStatusPhase('connecting');
    if (wsDisconnectDelayRef.current) clearTimeout(wsDisconnectDelayRef.current);
    wsDisconnectDelayRef.current = setTimeout(() => {
      setWsStatusPhase('disconnected');
      wsDisconnectDelayRef.current = null;
    }, 1500);

    return () => {
      if (wsDisconnectDelayRef.current) {
        clearTimeout(wsDisconnectDelayRef.current);
        wsDisconnectDelayRef.current = null;
      }
    };
  }, [wsConnected, wsAuthenticated, wsAuthFailed]);

  useEffect(() => {
    if (!authToken.trim()) return;
    if (!wsAuthFailed) return;

    setStatus('Sessão expirada no tempo real. Faça login novamente.');
    setAuthToken('');
    setRegisteredPush(null);
    setTickets([]);
    setSelectedTicketId(null);
    setIsChatScreen(false);
    setShowOptionsMenu(false);
    setMessages([]);
    setWsConnected(false);
    setWsAuthenticated(false);
    setWsLastEvent('auth_error_logout');
    void clearStoredSession().catch(() => undefined);
  }, [wsAuthFailed, authToken]);

  useEffect(() => {
    crmLookupFailedRef.current.clear();
    crmLookupCooldownUntilRef.current = 0;
    setCrmLookupCooldownUntil(0);
  }, [authToken, tenantId, apiBaseUrl]);

  useEffect(() => {
    if (!crmLookupCooldownUntil || crmLookupCooldownUntil <= Date.now()) return;
    const msRemaining = crmLookupCooldownUntil - Date.now();
    const timer = setTimeout(() => {
      setCrmLookupCooldownUntil(0);
    }, msRemaining);
    return () => clearTimeout(timer);
  }, [crmLookupCooldownUntil]);

  useEffect(() => {
    if (isExpoGoRuntime()) {
      const reason = 'Expo Go detectado: push remoto requer development build.';
      setStatus(reason);
      setStartupBlockedReason(reason);
      logFrontend('startup_blocked', { reason });
      return;
    }

    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    responseListener.current = Notifications.addNotificationResponseReceivedListener((event) => {
      const data = event.notification.request.content.data || {};
      const ticketId = typeof data.ticketId === 'string' ? data.ticketId : null;
      if (ticketId) {
        setRoutePreview(`/support/ticket/${ticketId}`);
      }
      void clearSystemNotificationBadge();
    });
    receivedListener.current = Notifications.addNotificationReceivedListener(() => {
      void clearSystemNotificationBadge();
    });
    appStateListener.current = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void clearSystemNotificationBadge();
      }
    });
    void clearSystemNotificationBadge();

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
      if (receivedListener.current) {
        receivedListener.current.remove();
      }
      if (appStateListener.current) {
        appStateListener.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreSession(): Promise<void> {
      try {
        const stored = await loadStoredSession();
        if (!stored || !active) return;

        const baseUrl = sanitizeBaseUrl(apiBaseUrl);
        const requestId = buildRequestId('session-restore');

        await getJson({
          baseUrl,
          path: '/auth/me',
          token: stored.token,
          tenantId: stored.tenantId || undefined,
          requestId,
        });
        if (!active) return;

        setAuthToken(stored.token);
        setTenantId(stored.tenantId);
        setAgentId(String(stored.agentId || '').trim());
        if (stored.username) {
          setUsername(stored.username);
        }
        setStatus('Sessão restaurada.');
        logFrontend('session_restored', {
          requestId,
          tenantId: stored.tenantId,
          username: stored.username || null,
        });
      } catch (err) {
        try {
          await clearStoredSession();
        } catch {
          // no-op
        }
        if (!active) return;
        logFrontend('session_restore_failed', {
          message: (err as Error).message || String(err),
        });
      } finally {
        if (active) setSessionBootstrapping(false);
      }
    }

    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  function formatDateTime(value?: string): string {
    if (!value) return 'sem data';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString('pt-BR');
  }

  function formatTime(value?: string): string {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function getTicketTitle(ticket?: SupportTicket): string {
    if (!ticket) return 'Atendimento';
    const phoneKey = String(ticket.phoneNumber || '').replace(/\D/g, '');
    const crmName = phoneKey ? crmLookupCacheRef.current[phoneKey] : '';
    return crmName || ticket.customerName || ticket.phoneNumber || 'Cliente';
  }

  function getTicketContactName(ticket?: SupportTicket): string {
    if (!ticket) return 'Cliente';
    const phoneKey = String(ticket.phoneNumber || '').replace(/\D/g, '');
    const crmName = phoneKey ? crmLookupCacheRef.current[phoneKey] : '';
    const contextName = String(ticket.context?.metadata?.contactName || '').trim();
    const variableName = String(
      ticket.context?.variables?.customerName ||
      ticket.context?.variables?.name ||
      ticket.context?.variables?.nome ||
      ''
    ).trim();
    return crmName || String(ticket.customerName || '').trim() || contextName || variableName || 'Cliente';
  }

  function formatPhoneLabel(value?: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const numeric = raw.replace(/\D/g, '');
    const hasBrazilCountryCode = numeric.startsWith('55') && (numeric.length === 12 || numeric.length === 13);
    const digits = hasBrazilCountryCode ? numeric.slice(2) : numeric;

    if (digits.length === 11) {
      const local = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
      return hasBrazilCountryCode ? `+55 ${local}` : local;
    }
    if (digits.length === 10) {
      const local = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      return hasBrazilCountryCode ? `+55 ${local}` : local;
    }

    return raw;
  }

  function getTicketPhoneLabel(ticket?: SupportTicket): string {
    if (!ticket) return '';
    return formatPhoneLabel(ticket.phoneNumber);
  }

  function getTicketPreview(ticket?: SupportTicket): string {
    if (!ticket) return '';
    const text = String(ticket.lastUserMessage || '').trim();
    if (!text) return 'Sem mensagens';
    if (text.length <= TICKET_PREVIEW_MAX) return text;
    return `${text.slice(0, TICKET_PREVIEW_MAX - 1)}…`;
  }

  function formatTicketMode(mode?: string): string {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'paused') return 'Pausado';
    if (normalized === 'bot' || normalized === 'assistant' || normalized === 'ai') return 'Bot';
    if (!normalized || normalized === 'human' || normalized === 'agent') return 'Humano';
    return normalized;
  }

  function isTicketAssignedToCurrentAgent(ticket?: SupportTicket | null): boolean {
    const assignedTo = String(ticket?.assignedTo || '').trim();
    if (!assignedTo) return false;
    return assignedTo === agentId || assignedTo === username.trim();
  }

  function formatTicketStatus(status?: string): string {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'in_progress') return 'Em atendimento';
    if (normalized === 'waiting') return 'Aguardando';
    if (normalized === 'closed') return 'Fechado';
    if (!normalized) return 'Aberto';
    return normalized;
  }

  function formatTicketStatusLabel(ticket?: SupportTicket): string {
    const mode = String(ticket?.mode || '').trim().toLowerCase();
    if (mode === 'paused') return 'Pausado';
    return formatTicketStatus(ticket?.status);
  }

  function getTicketStatusStyle(ticket?: SupportTicket): { backgroundColor: string; borderColor: string; color: string } {
    const mode = String(ticket?.mode || '').trim().toLowerCase();
    if (mode === 'paused') {
      return {
        backgroundColor: '#3B2A12',
        borderColor: '#C2410C',
        color: '#FDBA74',
      };
    }
    const normalized = String(ticket?.status || '').trim().toLowerCase();
    if (normalized === 'in_progress') {
      return {
        backgroundColor: '#3d1616',
        borderColor: '#8b2c2c',
        color: '#FFCDD2',
      };
    }
    if (normalized === 'waiting') {
      return {
        backgroundColor: '#4d1a1a',
        borderColor: '#b71c1c',
        color: '#FFAB91',
      };
    }
    if (normalized === 'closed') {
      return {
        backgroundColor: '#2d3136',
        borderColor: '#505861',
        color: '#D1D5DB',
      };
    }
    return {
      backgroundColor: '#5d1a1a',
      borderColor: '#c62828',
      color: '#EF9A9A',
    };
  }

  function isOutgoingMessage(sender?: string): boolean {
    const normalized = String(sender || '').toLowerCase();
    return normalized === 'agent' || normalized === 'bot' || normalized === 'assistant' || normalized === 'out';
  }

  function inferMediaType(fileName?: string | null, mimeType?: string | null): MediaType {
    const mime = String(mimeType || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/.test(name)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/.test(name)) return 'audio';
    return 'document';
  }

  function summarizeMedia(mediaType: MediaType | 'text', fileName?: string | null): string {
    if (mediaType === 'text') return fileName ? `[arquivo] ${fileName}` : '[arquivo]';
    if (mediaType === 'image') return `[imagem]${fileName ? ` ${fileName}` : ''}`;
    if (mediaType === 'video') return `[video]${fileName ? ` ${fileName}` : ''}`;
    if (mediaType === 'audio') return `[audio]${fileName ? ` ${fileName}` : ''}`;
    return `[documento]${fileName ? ` ${fileName}` : ''}`;
  }

  function getBodyText(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const body = value as {
      text?: string | { body?: string };
      caption?: string;
      image?: { caption?: string };
      document?: { caption?: string };
      video?: { caption?: string };
    };
    if (typeof body.text === 'string') return body.text;
    if (body.text && typeof body.text === 'object' && typeof body.text.body === 'string') return body.text.body;
    if (typeof body.caption === 'string') return body.caption;
    if (body.image && typeof body.image.caption === 'string') return body.image.caption;
    if (body.document && typeof body.document.caption === 'string') return body.document.caption;
    if (body.video && typeof body.video.caption === 'string') return body.video.caption;
    return '';
  }

  function resolveMediaUrl(mediaUrl?: string | null): string {
    const raw = String(mediaUrl || '').trim();
    if (!raw) return '';
    const base = sanitizeBaseUrl(apiBaseUrl);
    let baseOrigin = '';
    let basePath = '';
    let baseHost = '';
    try {
      const parsedBase = new URL(`${base}/`);
      baseOrigin = parsedBase.origin;
      basePath = String(parsedBase.pathname || '').replace(/\/+$/, '');
      baseHost = parsedBase.hostname;
    } catch {
      baseOrigin = '';
      basePath = '';
      baseHost = '';
    }

    const buildApiPublicUrl = (publicPath: string): string => {
      const normalizedPublicPath = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
      if (!baseOrigin) return normalizedPublicPath;
      if (!basePath) return `${baseOrigin}${normalizedPublicPath}`;
      if (basePath.endsWith('/api')) return `${baseOrigin}${basePath}${normalizedPublicPath}`;
      return `${baseOrigin}${basePath}/api${normalizedPublicPath}`;
    };

    const isWhatsAppMediaHost = (hostname: string): boolean => {
      const host = String(hostname || '').trim().toLowerCase();
      if (!host) return false;
      if (host === 'mmg.whatsapp.net') return true;
      return host.endsWith('.whatsapp.net');
    };

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        // Mantém paridade com o web: mídias WhatsApp externas passam pelo proxy autenticado da API.
        if (isWhatsAppMediaHost(parsed.hostname)) {
          return buildApiPublicUrl(`/public/whatsapp-media?url=${encodeURIComponent(raw)}`);
        }
        // Android pode bloquear cleartext; preferimos HTTPS quando o app usa base HTTPS.
        if (parsed.protocol === 'http:' && baseOrigin.startsWith('https://') && parsed.hostname === baseHost) {
          parsed.protocol = 'https:';
        }
        return parsed.toString();
      } catch {
        return raw;
      }
    }

    const normalizeAsAbsolute = (pathValue: string): string => {
      const normalizedPath = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
      if (!baseOrigin) return normalizedPath;
      return `${baseOrigin}${normalizedPath}`;
    };

    if (/^(data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/public/')) return buildApiPublicUrl(raw);
    if (raw.startsWith('/r-agent2/public/')) return buildApiPublicUrl(raw.replace('/r-agent2', ''));
    if (raw.startsWith('public/')) return buildApiPublicUrl(`/${raw}`);
    if (raw.startsWith('support-media/')) return buildApiPublicUrl(`/public/${raw}`);
    if (raw.startsWith('storage/support-media/')) return buildApiPublicUrl(`/public/${raw.slice('storage/'.length)}`);

    const looksLikeFileName = /^[^/?#\\]+\.[a-z0-9]{2,10}$/i.test(raw);
    if (looksLikeFileName) {
      const tenantSegment = String(selectedTicket?.tenantId || tenantId || 'system').trim() || 'system';
      return buildApiPublicUrl(`/public/support-media/${encodeURIComponent(tenantSegment)}/${encodeURIComponent(raw)}`);
    }

    if (!raw.startsWith('/')) return raw;
    try {
      return new URL(raw, `${base}/`).toString();
    } catch {
      return raw;
    }
  }

  function normalizeMessageMedia(raw: unknown): Pick<SupportMessage, 'messageType' | 'mediaUrl' | 'fileName' | 'mimeType'> {
    const source = (raw || {}) as {
      messageType?: string;
      type?: string;
      mediaUrl?: string;
      fileName?: string;
      mimeType?: string;
      body?: Record<string, unknown>;
    };
    const body = source.body || {};
    const type = String(source.messageType || source.type || '').trim().toLowerCase();
    const mediaType = (type === 'image' || type === 'video' || type === 'audio' || type === 'document')
      ? type
      : null;
    const asMediaUrl = (value: unknown): string => {
      const v = String(value || '').trim();
      if (!v) return '';
      if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
      if (v.startsWith('public/') || v.startsWith('support-media/') || v.startsWith('storage/support-media/')) return v;
      if (/^[^/?#\\]+\.[a-z0-9]{2,10}$/i.test(v)) return v;
      return '';
    };
    const directUrl = String(
      asMediaUrl(source.mediaUrl)
      || asMediaUrl(body.url)
      || asMediaUrl(body.mediaUrl)
      || asMediaUrl(body.media_url)
      || asMediaUrl((body as { image?: { link?: string; id?: string } }).image?.link)
      || asMediaUrl((body as { image?: { link?: string; id?: string } }).image?.id)
      || asMediaUrl((body as { video?: { link?: string; id?: string } }).video?.link)
      || asMediaUrl((body as { video?: { link?: string; id?: string } }).video?.id)
      || asMediaUrl((body as { audio?: { link?: string; id?: string } }).audio?.link)
      || asMediaUrl((body as { audio?: { link?: string; id?: string } }).audio?.id)
      || asMediaUrl((body as { document?: { link?: string; id?: string } }).document?.link)
      || asMediaUrl((body as { document?: { link?: string; id?: string } }).document?.id)
      || asMediaUrl((body as { media_id?: string }).media_id)
      || asMediaUrl((body as { mediaId?: string }).mediaId)
      || ''
    ).trim();
    const fileName = String(
      source.fileName
      || body.fileName
      || body.filename
      || ''
    ).trim() || null;
    const mimeType = String(
      source.mimeType
      || body.mimeType
      || body.mime_type
      || ''
    ).trim() || null;
    const inferredType = mediaType || (directUrl ? inferMediaType(fileName, mimeType) : null);

    return {
      messageType: inferredType || 'text',
      mediaUrl: directUrl || null,
      fileName,
      mimeType,
    };
  }

  function normalizeMessagesForUi(items: SupportMessage[]): SupportMessage[] {
    const list = Array.isArray(items) ? items : [];
    const seen = new Set<string>();
    const result: SupportMessage[] = [];

    for (let idx = 0; idx < list.length; idx += 1) {
      const item = list[idx] || {};
      const externalMessageId = String(item.externalMessageId || item.id || '').trim();
      const signature = externalMessageId
        ? `ext:${externalMessageId}|sender:${String(item.sender || '')}`
        : [
            String(item.id || ''),
            String(item.sender || ''),
            String(item.timestamp || ''),
            String(item.text || ''),
            String(item.mediaUrl || ''),
            String(item.messageType || ''),
          ].join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);

      result.push({
        ...item,
        uiKey: `${String(item.id || 'msg')}:${String(item.timestamp || 'no-ts')}:${idx}`,
      });
    }

    return result;
  }

  async function resolveAgentNamesInMessages(items: SupportMessage[], args: { requestId?: string } = {}): Promise<SupportMessage[]> {
    const list = Array.isArray(items) ? items : [];
    const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    const ids = new Set<string>();
    const isUuid = (value: string): boolean => (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim())
    );

    for (const item of list) {
      if (!item) continue;
      if (typeof item.text === 'string') {
        const matches = item.text.match(uuidRegex);
        if (matches) {
          for (const id of matches) ids.add(id);
        }
      }
      const senderRaw = String(item.sender || '').trim();
      const agentIdRaw = String(item.agentId || '').trim();
      if (isUuid(senderRaw)) ids.add(senderRaw);
      if (isUuid(agentIdRaw)) ids.add(agentIdRaw);
    }

    if (ids.size === 0) return list;
    const resolvedById: Record<string, string> = {};

    await Promise.all(Array.from(ids).map(async (id) => {
      const name = await resolveAgentNameById(id, args);
      resolvedById[id] = name || id;
    }));

    return list.map((item) => {
      if (!item) return item;
      const nextText = typeof item.text === 'string'
        ? item.text.replace(uuidRegex, (id) => resolvedById[id] || id)
        : item.text;
      const senderRaw = String(item.sender || '').trim();
      const agentIdRaw = String(item.agentId || '').trim();
      const senderDisplay = resolvedById[senderRaw] || resolvedById[agentIdRaw] || senderRaw;
      if (nextText === item.text && senderDisplay === senderRaw) return item;
      return {
        ...item,
        text: nextText,
        senderDisplay: senderDisplay || item.senderDisplay || senderRaw,
      };
    });
  }

  async function loadTickets(args: { requestId?: string } = {}): Promise<void> {
    if (!authToken.trim()) return;
    try {
      setTicketsLoading(true);
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const result = await getJson<{ tickets?: SupportTicket[] }>({
        baseUrl,
        path: '/tickets?limit=50&offset=0',
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId: args.requestId,
      });
      const listAll = Array.isArray(result?.tickets) ? result.tickets.map(normalizeSupportTicket) : [];
      const list = listAll.filter((ticket) => String(ticket?.status || '').toLowerCase() !== 'closed');
      const listWithAssignedDisplay = await resolveAssignedToDisplay(list, args);
      setTickets(listWithAssignedDisplay);
      setSelectedTicketId((prev) => {
        if (listWithAssignedDisplay.length === 0) return null;
        if (prev && listWithAssignedDisplay.some((item) => String(item.id) === String(prev))) {
          return prev;
        }
        return String(listWithAssignedDisplay[0].id);
      });
      if (listWithAssignedDisplay.length === 0) {
        setSelectedTicketId(null);
        setMessages([]);
      }
      logFrontend('support_tickets_loaded', {
        requestId: args.requestId || null,
        total: listWithAssignedDisplay.length,
      });
      void hydrateContactNames(listWithAssignedDisplay, { requestId: args.requestId });
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao carregar atendimento');
      setStatus(message);
      logFrontend('support_tickets_failed', { requestId: args.requestId || null, message });
    } finally {
      setTicketsLoading(false);
    }
  }

  async function resolveAssignedToDisplay(items: SupportTicket[], args: { requestId?: string } = {}): Promise<SupportTicket[]> {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = Array.from(
      new Set(
        list
          .map((ticket) => String(ticket?.assignedTo || '').trim())
          .filter((value) => uuidRegex.test(value) && !agentNameCacheRef.current[value])
      )
    );

    if (ids.length > 0) {
      await Promise.all(ids.map(async (id) => {
        await resolveAgentNameById(id, args);
      }));
    }

    return list.map((ticket) => {
      const raw = String(ticket?.assignedTo || '').trim();
      if (!raw) return { ...ticket, assignedToDisplay: '' };
      return {
        ...ticket,
        assignedToDisplay: agentNameCacheRef.current[raw] || raw,
      };
    });
  }

  async function resolveAgentNameById(id: string, args: { requestId?: string } = {}): Promise<string> {
    const raw = String(id || '').trim();
    if (!raw) return '';
    if (agentNameCacheRef.current[raw]) return agentNameCacheRef.current[raw];
    const baseUrl = sanitizeBaseUrl(apiBaseUrl);
    try {
      const result = await getJson<{ agent?: { id?: string; name?: string } }>({
        baseUrl,
        path: `/auth/agents/${encodeURIComponent(raw)}/name`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId: args.requestId,
      });
      const name = String(result?.agent?.name || '').trim();
      agentNameCacheRef.current[raw] = name || raw;
    } catch {
      agentNameCacheRef.current[raw] = raw;
    }
    return agentNameCacheRef.current[raw] || raw;
  }

  async function lookupContactNameByPhone(phone: string, args: { requestId?: string } = {}): Promise<string | null> {
    const phoneKey = String(phone || '').replace(/\D/g, '');
    if (!phoneKey || !authToken.trim()) return null;
    if (Date.now() < crmLookupCooldownUntilRef.current) return null;
    if (crmLookupCacheRef.current[phoneKey]) return crmLookupCacheRef.current[phoneKey];
    if (crmLookupFailedRef.current.has(phoneKey)) return null;
    if (crmLookupInFlightRef.current.has(phoneKey)) return null;
    crmLookupInFlightRef.current.add(phoneKey);

    try {
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const payload = await getJson<{ items?: Array<{ name?: string; phone?: string }>; contacts?: Array<{ name?: string; phone?: string }> }>({
        baseUrl,
        path: `/api/crm/contacts?phone=${encodeURIComponent(phoneKey)}&limit=1&offset=0`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId: args.requestId,
      });
      const items = Array.isArray(payload?.items)
        ? payload.items
        : (Array.isArray(payload?.contacts) ? payload.contacts : []);
      const name = String(items?.[0]?.name || '').trim();
      if (name) {
        crmLookupCacheRef.current[phoneKey] = name;
        crmLookupFailedRef.current.delete(phoneKey);
        return name;
      }
      return null;
    } catch (err) {
      const message = (err as Error).message || String(err);
      const status = Number((err as { status?: number })?.status || 0);
      const normalizedMessage = message.toLowerCase();
      const isTimeout =
        status === 504 ||
        normalizedMessage.includes('504') ||
        normalizedMessage.includes('timeout');
      if (isTimeout) {
        const nextCooldownUntil = Date.now() + CRM_LOOKUP_RETRY_COOLDOWN_MS;
        crmLookupCooldownUntilRef.current = nextCooldownUntil;
        setCrmLookupCooldownUntil(nextCooldownUntil);
      }
      crmLookupFailedRef.current.add(phoneKey);
      logFrontend('crm_contact_lookup_failed', {
        requestId: args.requestId || null,
        phone: phoneKey,
        status: status || null,
        cooldownActive: Date.now() < crmLookupCooldownUntilRef.current,
        message,
      });
      return null;
    } finally {
      crmLookupInFlightRef.current.delete(phoneKey);
    }
  }

  async function hydrateContactNames(items: SupportTicket[], args: { requestId?: string } = {}): Promise<void> {
    const phones = Array.from(
      new Set(
        (items || [])
          .map((t) => String(t?.phoneNumber || '').replace(/\D/g, ''))
          .filter(Boolean)
      )
    );
    if (phones.length === 0) return;
    if (Date.now() < crmLookupCooldownUntilRef.current) return;

    const phonesToLookup = phones.filter(
      (phone) => !crmLookupCacheRef.current[phone] && !crmLookupFailedRef.current.has(phone)
    );
    if (phonesToLookup.length === 0) return;

    const resolved: Array<{ phone: string; name: string | null }> = [];
    for (let idx = 0; idx < phonesToLookup.length; idx += 1) {
      if (Date.now() < crmLookupCooldownUntilRef.current) break;
      const phone = phonesToLookup[idx];
      const name = await lookupContactNameByPhone(phone, args);
      resolved.push({ phone, name });
      if (idx < phonesToLookup.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CRM_LOOKUP_SEQUENCE_DELAY_MS));
      }
    }

    const nameByPhone: Record<string, string> = {};
    for (const row of resolved) {
      if (row?.name) {
        nameByPhone[row.phone] = row.name;
      }
    }
    if (Object.keys(nameByPhone).length === 0) return;

    setTickets((prev) =>
      prev.map((ticket) => {
        const key = String(ticket.phoneNumber || '').replace(/\D/g, '');
        const name = nameByPhone[key];
        if (!name) return ticket;
        return { ...ticket, customerName: name };
      })
    );
  }

  async function loadTicketMessages(ticketId: string, args: { requestId?: string } = {}): Promise<void> {
    if (!authToken.trim() || !ticketId) return;
    try {
      setMessagesLoading(true);
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const result = await getJson<{ messages?: SupportMessage[]; timeline?: TicketTimelineItem[] }>({
        baseUrl,
        path: `/tickets/${encodeURIComponent(ticketId)}/messages`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId: args.requestId,
      });
      const timelineItems = Array.isArray(result?.timeline) ? result.timeline : [];
      const timelineMessagesRaw: SupportMessage[] = timelineItems
        .map((item, idx) => {
          const media = normalizeMessageMedia({
            type: item?.type,
            body: item?.body || undefined,
          });
          const text = String(item?.text || getBodyText(item?.body) || '').trim();
          if (!text && !media.mediaUrl) return null;
          const direction = String(item?.direction || '').toLowerCase();
          const externalMessageId = String(item?.externalMessageId || '').trim();
          const messageType = media.messageType || 'text';
          return {
            id: externalMessageId || `tl-${idx}`,
            externalMessageId: externalMessageId || undefined,
            sender: direction === 'out' ? 'agent' : 'user',
            text: text || summarizeMedia(messageType, media.fileName),
            timestamp: item?.timestamp || undefined,
            messageType,
            mediaUrl: media.mediaUrl || null,
            fileName: media.fileName || null,
            mimeType: media.mimeType || null,
          } as SupportMessage;
        })
        .filter((item): item is SupportMessage => Boolean(item));
      const timelineByExternal = new Map<string, SupportMessage>();
      const timelineWithoutExternal: SupportMessage[] = [];
      for (const item of timelineMessagesRaw) {
        const externalMessageId = String(item.externalMessageId || '').trim();
        if (!externalMessageId) {
          timelineWithoutExternal.push(item);
          continue;
        }
        if (!timelineByExternal.has(externalMessageId)) {
          timelineByExternal.set(externalMessageId, item);
        }
      }
      const timelineMessages: SupportMessage[] = [
        ...timelineWithoutExternal,
        ...Array.from(timelineByExternal.values()),
      ];
      const ticketMessages = (Array.isArray(result?.messages) ? result.messages : []).map((msg) => {
        const media = normalizeMessageMedia(msg);
        const rawText = String(msg?.text || '').trim();
        const messageType = media.messageType || 'text';
        return {
          ...msg,
          text: rawText || (media.mediaUrl ? summarizeMedia(messageType, media.fileName) : rawText),
          messageType,
          mediaUrl: media.mediaUrl || null,
          fileName: media.fileName || null,
          mimeType: media.mimeType || null,
        } as SupportMessage;
      });
      let loadedMessagesRaw = timelineMessages.length > 0 ? timelineMessages : ticketMessages;
      if (timelineMessages.length > 0 && ticketMessages.length > 0) {
        const byAnyId = new Map<string, SupportMessage>();
        for (const msg of ticketMessages) {
          const keys = [
            String(msg.externalMessageId || '').trim(),
            String(msg.id || '').trim(),
            String((msg as SupportMessage & { clientMessageId?: string }).clientMessageId || '').trim(),
          ].filter(Boolean);
          for (const key of keys) {
            if (!byAnyId.has(key)) byAnyId.set(key, msg);
          }
        }
        loadedMessagesRaw = timelineMessages.map((msg) => {
          if (msg.mediaUrl) return msg;
          const keys = [
            String(msg.externalMessageId || '').trim(),
            String(msg.id || '').trim(),
            String((msg as SupportMessage & { clientMessageId?: string }).clientMessageId || '').trim(),
          ].filter(Boolean);
          const matched = keys.map((key) => byAnyId.get(key)).find(Boolean) || null;
          if (!matched || !matched.mediaUrl) return msg;
          return {
            ...msg,
            messageType: matched.messageType || msg.messageType || 'text',
            mediaUrl: matched.mediaUrl || null,
            fileName: matched.fileName || msg.fileName || null,
            mimeType: matched.mimeType || msg.mimeType || null,
            text: String(msg.text || '').trim() || String(matched.text || '').trim(),
          } as SupportMessage;
        });
      }
      const resolvedMessages = await resolveAgentNamesInMessages(loadedMessagesRaw, args);
      const loadedMessages = normalizeMessagesForUi(resolvedMessages);
      setMessages(loadedMessages);
      setVisibleMessagesCount(Math.min(MESSAGE_PAGE_SIZE, loadedMessages.length || MESSAGE_PAGE_SIZE));
      logFrontend('support_messages_loaded', {
        requestId: args.requestId || null,
        ticketId,
        conversationId: selectedTicket?.conversationId || null,
        total: loadedMessages.length,
        timelineCount: timelineMessages.length,
        ticketCount: ticketMessages.length,
      });
    } catch (err) {
      const message = formatApiErrorMessage(err, `Falha ao carregar mensagens do ticket ${ticketId}`);
      setStatus(message);
      logFrontend('support_messages_failed', {
        requestId: args.requestId || null,
        ticketId,
        conversationId: selectedTicket?.conversationId || null,
        message,
      });
    } finally {
      setMessagesLoading(false);
    }
  }

  async function onSendMessage(): Promise<void> {
    if (!authToken.trim() || !selectedTicketId) return;
    const ticket = tickets.find((item) => String(item.id) === String(selectedTicketId));
    const assignedTo = String(ticket?.assignedTo || '').trim();
    const isAssignedToMe = Boolean(
      assignedTo && (assignedTo === agentId || assignedTo === username.trim())
    );
    if (!isAssignedToMe) {
      setStatus('Envio bloqueado: atribua o ticket para você antes de responder.');
      logFrontend('support_message_blocked_not_assigned', {
        ticketId: selectedTicketId,
        assignedTo: assignedTo || null,
        agentId: agentId || null,
        username: username.trim() || null,
      });
      return;
    }
    const mode = String(ticket?.mode || '').trim().toLowerCase();
    if (mode === 'bot' || mode === 'assistant' || mode === 'ai') {
      setStatus('Envio bloqueado: ticket em modo bot. Assuma o atendimento para responder.');
      return;
    }
    if (mode === 'paused') {
      setStatus('Envio bloqueado: ticket pausado. Retome o atendimento para responder.');
      return;
    }
    try {
      setSendingMessage(true);
      const requestId = buildRequestId('ticket-message');
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const content = messageDraft.trim();
      const hasAttachment = Boolean(draftAttachment?.mediaUrl);
      if (messageDraft.trimStart().startsWith('/')) {
        setStatus('Selecione um comando do menu "/" antes de enviar.');
        return;
      }
      if (!content && !hasAttachment) {
        setStatus('Digite uma mensagem ou anexe uma midia.');
        return;
      }
      await postJson({
        baseUrl,
        path: `/tickets/${encodeURIComponent(selectedTicketId)}/message`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId,
        body: {
          message: content,
          ...(hasAttachment
            ? {
                media: {
                  type: draftAttachment?.mediaType || 'document',
                  url: draftAttachment?.mediaUrl || '',
                  fileName: draftAttachment?.fileName || null,
                  mimeType: draftAttachment?.mimeType || null,
                },
              }
            : {}),
        },
      });
      setMessageDraft('');
      setDraftAttachment(null);
      await loadTicketMessages(selectedTicketId, { requestId });
      await loadTickets({ requestId });
      setStatus('Mensagem enviada com sucesso.');
      logFrontend('support_message_sent', { requestId, ticketId: selectedTicketId });
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao enviar mensagem');
      setStatus(message);
      logFrontend('support_message_failed', { ticketId: selectedTicketId, message });
    } finally {
      setSendingMessage(false);
    }
  }

  async function onAttachMedia(): Promise<void> {
    if (!authToken.trim() || !selectedTicketId) return;
    if (!canSendSelectedTicketMessage || sendingMessage || uploadingAttachment) return;
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: '*/*',
      });
      if (pick.canceled || !Array.isArray(pick.assets) || pick.assets.length === 0) return;
      const asset = pick.assets[0];
      const uri = String(asset?.uri || '').trim();
      const fileName = String(asset?.name || 'arquivo').trim() || 'arquivo';
      const mimeType = String(asset?.mimeType || '').trim() || 'application/octet-stream';
      const sizeBytes = Number(asset?.size || 0);
      if (!uri) {
        setStatus('Arquivo invalido.');
        return;
      }
      if (sizeBytes > SUPPORT_MEDIA_MAX_BYTES) {
        setStatus('Arquivo excede o limite de 25MB.');
        return;
      }

      setUploadingAttachment(true);
      const requestId = buildRequestId('ticket-media-upload');
      const formData = new FormData();
      formData.append('file', {
        uri,
        name: fileName,
        type: mimeType,
      } as unknown as Blob);

      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const uploaded = await postFormData<{
        url?: string;
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
        mediaType?: string;
      }>({
        baseUrl,
        path: '/tickets/media/upload',
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId,
        body: formData,
      });
      const uploadedUrl = String(uploaded?.url || '').trim();
      if (!uploadedUrl) {
        setStatus('Falha no upload de midia.');
        return;
      }
      const uploadedMediaType = inferMediaType(
        uploaded?.fileName || fileName,
        uploaded?.mimeType || mimeType
      );
      setDraftAttachment({
        mediaType: uploadedMediaType,
        mediaUrl: uploadedUrl,
        fileName: String(uploaded?.fileName || fileName),
        mimeType: String(uploaded?.mimeType || mimeType),
        sizeBytes: Number(uploaded?.sizeBytes || sizeBytes || 0),
      });
      setStatus('Anexo carregado.');
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao carregar anexo');
      setStatus(message);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function markTicketAsRead(ticketId: string, args: { requestId?: string } = {}): Promise<void> {
    if (!authToken.trim() || !ticketId) return;
    try {
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      await postJson({
        baseUrl,
        path: `/tickets/${encodeURIComponent(ticketId)}/mark-read`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId: args.requestId,
        body: {},
      });
      setTickets((prev) =>
        prev.map((item) => (String(item.id) === ticketId ? { ...item, unreadCount: 0 } : item))
      );
      void clearSystemNotificationBadge();
      logFrontend('support_ticket_mark_read', {
        requestId: args.requestId || null,
        ticketId,
      });
    } catch (err) {
      logFrontend('support_ticket_mark_read_failed', {
        requestId: args.requestId || null,
        ticketId,
        message: (err as Error).message || String(err),
      });
    }
  }

  function onSelectTicket(ticketId: string): void {
    const normalizedTicketId = String(ticketId);
    setSelectedTicketId(normalizedTicketId);
    setIsChatScreen(true);
    setShowOptionsMenu(false);
    setShowDeliveryFailures(false);
    const selected = tickets.find((item) => String(item.id) === normalizedTicketId);
    const shouldMarkRead =
      selected &&
      String(selected.status || '').toLowerCase() === 'in_progress' &&
      getTicketUnreadCount(selected) > 0;
    if (shouldMarkRead) {
      const requestId = buildRequestId('support-open-ticket');
      markTicketAsRead(normalizedTicketId, { requestId });
    }
  }

  async function onAssignSelectedTicketToMe(): Promise<void> {
    if (!authToken.trim() || !selectedTicketId) return;
    try {
      const requestId = buildRequestId('ticket-assign');
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      await postJson({
        baseUrl,
        path: `/tickets/${encodeURIComponent(selectedTicketId)}/assign`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId,
        body: {},
      });
      await loadTickets({ requestId });
      await loadTicketMessages(selectedTicketId, { requestId });
      setStatus(`Ticket #${selectedTicketId} atribuído com sucesso.`);
      logFrontend('support_ticket_assigned', {
        requestId,
        ticketId: selectedTicketId,
      });
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao atribuir ticket');
      setStatus(message);
      logFrontend('support_ticket_assign_failed', {
        ticketId: selectedTicketId,
        message,
      });
    }
  }

  async function onCloseSelectedTicket(): Promise<void> {
    if (!authToken.trim() || !selectedTicketId) return;
    try {
      const requestId = buildRequestId('ticket-close');
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const ticketId = selectedTicketId;
      await postJson({
        baseUrl,
        path: `/tickets/${encodeURIComponent(ticketId)}/close`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId,
        body: {},
      });
      setIsChatScreen(false);
      setShowOptionsMenu(false);
      await loadTickets({ requestId });
      setStatus(`Ticket #${ticketId} fechado com sucesso.`);
      logFrontend('support_ticket_closed', {
        requestId,
        ticketId,
      });
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao fechar ticket');
      setStatus(message);
      logFrontend('support_ticket_close_failed', {
        ticketId: selectedTicketId,
        message,
      });
    }
  }

  async function runSelectedTicketAction(args: {
    pathSuffix: string;
    requestPrefix: string;
    successMessage: string;
    body?: Record<string, unknown>;
  }): Promise<void> {
    if (!authToken.trim() || !selectedTicketId) return;
    try {
      setTicketActionLoading(true);
      const requestId = buildRequestId(args.requestPrefix);
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      await postJson({
        baseUrl,
        path: `/tickets/${encodeURIComponent(selectedTicketId)}${args.pathSuffix}`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId,
        body: args.body || {},
      });
      await loadTickets({ requestId });
      await loadTicketMessages(selectedTicketId, { requestId });
      setStatus(args.successMessage);
      logFrontend('support_ticket_action_success', {
        requestId,
        ticketId: selectedTicketId,
        pathSuffix: args.pathSuffix,
      });
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao executar ação no ticket');
      setStatus(message);
      logFrontend('support_ticket_action_failed', {
        ticketId: selectedTicketId,
        pathSuffix: args.pathSuffix,
        message,
      });
    } finally {
      setTicketActionLoading(false);
    }
  }

  async function onTakeOverSelectedTicket(): Promise<void> {
    await runSelectedTicketAction({
      pathSuffix: '/takeover',
      requestPrefix: 'ticket-takeover',
      successMessage: `Ticket #${selectedTicketId} assumido com sucesso.`,
      body: { reason: 'agent_takeover' },
    });
  }

  async function onReturnSelectedTicketToBot(): Promise<void> {
    await runSelectedTicketAction({
      pathSuffix: '/return-to-bot',
      requestPrefix: 'ticket-return-bot',
      successMessage: `Ticket #${selectedTicketId} devolvido para o bot.`,
      body: { reason: 'user_request' },
    });
  }

  async function onPauseSelectedTicket(): Promise<void> {
    await runSelectedTicketAction({
      pathSuffix: '/pause',
      requestPrefix: 'ticket-pause',
      successMessage: `Ticket #${selectedTicketId} pausado.`,
      body: { reason: 'outside_window' },
    });
  }

  async function onResumeSelectedTicket(): Promise<void> {
    await runSelectedTicketAction({
      pathSuffix: '/resume',
      requestPrefix: 'ticket-resume',
      successMessage: `Ticket #${selectedTicketId} retomado.`,
      body: { reason: 'resume' },
    });
  }

  async function onLoadSelectedTicketDeliveryFailures(): Promise<void> {
    if (!authToken.trim() || !selectedTicketId) return;
    try {
      setDeliveryFailuresLoading(true);
      const requestId = buildRequestId('ticket-delivery-failures');
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      const result = await getJson<TicketDeliveryFailures>({
        baseUrl,
        path: `/tickets/${encodeURIComponent(selectedTicketId)}/delivery-failures`,
        token: authToken.trim(),
        tenantId: tenantId.trim() || undefined,
        requestId,
      });
      const outboundQueue = Array.isArray(result?.outboundQueue) ? result.outboundQueue : [];
      const channelMessages = Array.isArray(result?.channelMessages) ? result.channelMessages : [];
      setDeliveryFailures({
        ...result,
        outboundQueue,
        channelMessages,
      });
      setShowDeliveryFailures(true);
      setStatus(
        `Falhas de entrega carregadas: fila=${outboundQueue.length}, canal=${channelMessages.length}.`
      );
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao carregar falhas de entrega');
      setStatus(message);
    } finally {
      setDeliveryFailuresLoading(false);
    }
  }

  function executeSlashCommand(command: string): boolean {
    const normalized = String(command || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === '/assumir') { void onTakeOverSelectedTicket(); return true; }
    if (normalized === '/devolver') { void onReturnSelectedTicketToBot(); return true; }
    if (normalized === '/pausar') { void onPauseSelectedTicket(); return true; }
    if (normalized === '/retomar') { void onResumeSelectedTicket(); return true; }
    if (normalized === '/falhas') { void onLoadSelectedTicketDeliveryFailures(); return true; }
    if (normalized === '/fechar') { void onCloseSelectedTicket(); return true; }
    if (normalized === '/anexo') { void onAttachMedia(); return true; }
    if (normalized === '/limpar') { setMessageDraft(''); return true; }
    return false;
  }

  useEffect(() => {
    if (!authToken.trim()) return;
    const requestId = buildRequestId('support-bootstrap');
    loadTickets({ requestId });
  }, [authToken, tenantId]);

  useEffect(() => {
    selectedTicketIdRef.current = selectedTicketId;
    setShowDeliveryFailures(false);
    setDraftAttachment(null);
  }, [selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId || !authToken.trim()) return;
    const requestId = buildRequestId('support-open-ticket');
    loadTicketMessages(selectedTicketId, { requestId });
  }, [selectedTicketId, authToken, tenantId]);

  useEffect(() => {
    if (!authToken.trim()) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      setWsAuthenticated(false);
      setWsAuthFailed(false);
      setWsLastEvent(null);
      return;
    }

    const queueReload = (reason: string): void => {
      if (wsReloadTimeoutRef.current) return;
      wsReloadTimeoutRef.current = setTimeout(() => {
        wsReloadTimeoutRef.current = null;
        const requestId = buildRequestId('ws-sync');
        loadTickets({ requestId });
        const currentTicketId = selectedTicketIdRef.current;
        if (currentTicketId) {
          loadTicketMessages(currentTicketId, { requestId });
        }
      }, 250);
      logFrontend('ws_ticket_refresh_queued', { reason });
    };

    const wsUrl = buildWebSocketUrl(apiBaseUrl);
    let isActive = true;

    const connect = (): void => {
      if (!isActive) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setWsAuthenticated(false);
        setWsAuthFailed(false);
        setWsLastEvent('ws_connected');
        ws.send(JSON.stringify({ type: 'auth', token: authToken.trim() }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}'));
          if (payload?.type === 'auth' && payload?.status === 'success') {
            setWsAuthenticated(true);
            setWsAuthFailed(false);
            setWsLastEvent('auth_success');
            ws.send(
              JSON.stringify({
                type: 'subscribe',
                events: [
                  'ticket.created',
                  'ticket.updated',
                  'ticket.assigned',
                  'ticket.closed',
                  'ticket.message.received',
                  'ticket.message.sent',
                ],
              })
            );
            return;
          }
          if (payload?.type === 'auth' && payload?.status !== 'success') {
            setWsAuthenticated(false);
            setWsAuthFailed(true);
            setWsLastEvent('auth_error');
            return;
          }
          if (payload?.type === 'subscribe' && payload?.status === 'success') {
            setWsLastEvent('subscribed');
            return;
          }

          if (payload?.type !== 'event') return;
          const evt = String(payload?.event || '');
          if (
            ![
              'ticket.created',
              'ticket.updated',
              'ticket.assigned',
              'ticket.closed',
              'ticket.message.received',
              'ticket.message.sent',
            ].includes(evt)
          ) {
            return;
          }
          setWsLastEvent(evt);
          queueReload(evt);
        } catch {
          // ignora mensagens inválidas
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        setWsAuthenticated(false);
        setWsAuthFailed(false);
        if (!isActive) return;
        if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current);
        wsReconnectTimeoutRef.current = setTimeout(() => {
          wsReconnectTimeoutRef.current = null;
          connect();
        }, 2000);
      };

      ws.onerror = () => {
        setWsConnected(false);
        setWsAuthenticated(false);
        setWsAuthFailed(false);
      };
    };

    connect();

    return () => {
      isActive = false;
      if (wsReloadTimeoutRef.current) {
        clearTimeout(wsReloadTimeoutRef.current);
        wsReloadTimeoutRef.current = null;
      }
      if (wsReconnectTimeoutRef.current) {
        clearTimeout(wsReconnectTimeoutRef.current);
        wsReconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      setWsAuthenticated(false);
      setWsAuthFailed(false);
    };
  }, [authToken, tenantId, apiBaseUrl]);

  async function onLogin() {
    const startupRequestId = buildRequestId('startup');
    try {
      if (!username.trim() || !password.trim()) {
        setError('Digite username e senha.');
        return;
      }

      setLoading(true);
      setError('');
      const baseUrl = sanitizeBaseUrl(apiBaseUrl);
      logFrontend('login_start', {
        requestId: startupRequestId,
        apiBaseUrl: baseUrl,
        username: username.trim(),
        hasTenantInput: Boolean(String(tenantId || '').trim()),
        loginTenantId: String(tenantId || '').trim() || 'system',
      });
      const auth = await loginWithPassword({
        apiBaseUrl: baseUrl,
        username: username.trim(),
        password: password.trim(),
        tenantId: String(tenantId || '').trim() || 'system',
        requestId: startupRequestId,
      });
      const resolvedTenantId = String(auth.agent?.tenantId || tenantId || '').trim();
      logFrontend('login_success', {
        requestId: startupRequestId,
        username: auth.agent?.username || username.trim(),
        role: auth.agent?.role || null,
        tenantIdFromApi: auth.agent?.tenantId || null,
        resolvedTenantId,
        tokenPreview: `${auth.token.slice(0, 10)}...`,
      });
      if (!resolvedTenantId) {
        throw new Error('Tenant ID obrigatório para iniciar o app.');
      }

      setStatus('Login OK. Registrando push...');
      logFrontend('push_register_start', {
        requestId: startupRequestId,
        apiBaseUrl: baseUrl,
        tenantId: resolvedTenantId,
      });
      const reg = await registerNativePush({
        apiBaseUrl: baseUrl,
        authToken: auth.token,
        tenantId: resolvedTenantId,
        appVersion: APP_VERSION,
        requestId: startupRequestId,
      });

      setAuthToken(auth.token);
      setAgentId(String(auth.agent?.id || '').trim());
      setTenantId(resolvedTenantId);
      setIsChatScreen(false);
      setShowOptionsMenu(false);
      setRegisteredPush(reg);
      await clearSystemNotificationBadge();
      try {
        await saveStoredSession({
          token: auth.token,
          tenantId: resolvedTenantId,
          agentId: String(auth.agent?.id || '').trim() || undefined,
          username: auth.agent?.username || username.trim(),
        });
      } catch {
        // no-op
      }
      setStatus(`App iniciado. Push registrado com sucesso (${reg.platform}).`);
      logFrontend('push_register_success', {
        requestId: startupRequestId,
        platform: reg.platform,
        tokenPreview: `${String(reg.token || '').slice(0, 10)}...`,
        tenantId: resolvedTenantId,
      });
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao fazer login');
      setError(message);
      setAuthToken('');
      setAgentId('');
      setRegisteredPush(null);
      setWsConnected(false);
      setWsAuthenticated(false);
      setWsAuthFailed(false);
      setWsLastEvent(null);
      try {
        await clearStoredSession();
      } catch {
        // no-op
      }
      setStatus(`Falha ao iniciar app em ${sanitizeBaseUrl(apiBaseUrl)}: ${message}`);
      logFrontend('startup_failed', {
        requestId: startupRequestId,
        apiBaseUrl: sanitizeBaseUrl(apiBaseUrl),
        username: username.trim(),
        tenantId: String(tenantId || '').trim() || null,
        message,
      });
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    try {
      if (authToken.trim() && registeredPush) {
        const baseUrl = sanitizeBaseUrl(apiBaseUrl);
        const logoutRequestId = buildRequestId('logout');
        logFrontend('logout_start', {
          requestId: logoutRequestId,
          apiBaseUrl: baseUrl,
          tenantId: String(tenantId || '').trim() || null,
          platform: registeredPush.platform,
        });
        await unregisterNativePush({
          apiBaseUrl: baseUrl,
          authToken: authToken.trim(),
          tenantId: tenantId.trim() || undefined,
          platform: registeredPush.platform,
          token: registeredPush.token,
          requestId: logoutRequestId,
        });
        logFrontend('logout_push_unregistered', {
          requestId: logoutRequestId,
          platform: registeredPush.platform,
        });
      }
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Falha ao remover push no logout');
      setStatus(message);
      logFrontend('logout_failed', { message });
    } finally {
      setAuthToken('');
      setRegisteredPush(null);
      setPassword('');
      setTickets([]);
      setSelectedTicketId(null);
      setIsChatScreen(false);
      setShowOptionsMenu(false);
      setMessages([]);
      setShowDeliveryFailures(false);
      setDeliveryFailures({ outboundQueue: [], channelMessages: [] });
      setWsConnected(false);
      setWsAuthenticated(false);
      setWsAuthFailed(false);
      setWsLastEvent(null);
      setVisibleMessagesCount(MESSAGE_PAGE_SIZE);
      messageScrollOffsetRef.current = 0;
      messageContentHeightRef.current = 0;
      pendingScrollRestoreRef.current = null;
      loadingMoreMessagesRef.current = false;
      setMessagesLoadingMore(false);
      setMessageDraft('');
      setDraftAttachment(null);
      setUploadingAttachment(false);
      setError('');
      setStatus('Sessão encerrada.');
      try {
        await clearStoredSession();
      } catch {
        // no-op
      }
      logFrontend('logout_done');
    }
  }

  const showLogin = !authToken && !sessionBootstrapping;
  const selectedTicket = tickets.find((t) => String(t.id) === selectedTicketId);
  const totalUnreadCount = tickets.reduce((sum, ticket) => sum + getTicketUnreadCount(ticket), 0);
  const selectedAssignedTo = String(selectedTicket?.assignedTo || '').trim();
  const selectedAssignedToDisplay = String(selectedTicket?.assignedToDisplay || '').trim();
  const selectedAssignedToMe = isTicketAssignedToCurrentAgent(selectedTicket);
  const selectedTicketMode = String(selectedTicket?.mode || '').trim().toLowerCase();
  const selectedTicketStatus = String(selectedTicket?.status || '').trim().toLowerCase();
  const selectedTicketPaused = selectedTicketMode === 'paused';
  const selectedTicketBot = selectedTicketMode === 'bot' || selectedTicketMode === 'assistant' || selectedTicketMode === 'ai';
  const selectedTicketWaiting = selectedTicketStatus === 'waiting';
  const canSendSelectedTicketMessage = Boolean(selectedTicketId && selectedAssignedToMe && !selectedTicketPaused && !selectedTicketBot);
  const isActionBusy = Boolean(ticketActionLoading || sendingMessage || uploadingAttachment);
  const slashMode = messageDraft.trimStart().startsWith('/');
  const slashQuery = slashMode ? messageDraft.trimStart().slice(1).trim().toLowerCase() : '';
  const slashCommandItems = useMemo<SlashCommandItem[]>(() => {
    const hasSelected = Boolean(selectedTicketId);
    const canActOnTicket = hasSelected && selectedAssignedToMe;
    const isInProgress = String(selectedTicket?.status || '').toLowerCase() === 'in_progress';
    const mode = String(selectedTicket?.mode || '').toLowerCase();

    const list: SlashCommandItem[] = [];
    if (isInProgress && mode === 'bot') {
      list.push({
        id: 'assumir',
        title: '/assumir',
        description: 'Assumir atendimento (modo humano)',
        enabled: canActOnTicket && !ticketActionLoading,
        action: () => { void onTakeOverSelectedTicket(); },
      });
    }
    if (isInProgress && mode === 'human') {
      list.push(
        {
          id: 'devolver',
          title: '/devolver',
          description: 'Devolver atendimento para o bot',
          enabled: canActOnTicket && !ticketActionLoading,
          action: () => { void onReturnSelectedTicketToBot(); },
        },
        {
          id: 'pausar',
          title: '/pausar',
          description: 'Pausar atendimento',
          enabled: canActOnTicket && !ticketActionLoading,
          action: () => { void onPauseSelectedTicket(); },
        }
      );
    }
    if (isInProgress && mode === 'paused') {
      list.push(
        {
          id: 'retomar',
          title: '/retomar',
          description: 'Retomar atendimento humano',
          enabled: canActOnTicket && !ticketActionLoading,
          action: () => { void onResumeSelectedTicket(); },
        },
        {
          id: 'devolver',
          title: '/devolver',
          description: 'Devolver atendimento para o bot',
          enabled: canActOnTicket && !ticketActionLoading,
          action: () => { void onReturnSelectedTicketToBot(); },
        }
      );
    }

    list.push(
      {
        id: 'falhas',
        title: '/falhas',
        description: 'Abrir falhas de entrega',
        enabled: hasSelected && !deliveryFailuresLoading,
        action: () => { void onLoadSelectedTicketDeliveryFailures(); },
      },
      {
        id: 'fechar',
        title: '/fechar',
        description: 'Fechar chamado atual',
        enabled: hasSelected && !ticketActionLoading,
        action: () => { void onCloseSelectedTicket(); },
      },
      {
        id: 'anexo',
        title: '/anexo',
        description: 'Selecionar midia ou arquivo',
        enabled: canSendSelectedTicketMessage && !sendingMessage && !uploadingAttachment,
        action: () => { void onAttachMedia(); },
      },
      {
        id: 'limpar',
        title: '/limpar',
        description: 'Limpar mensagem digitada',
        enabled: true,
        action: () => { setMessageDraft(''); },
      }
    );

    return list;
  }, [
    selectedTicketId,
    selectedAssignedToMe,
    selectedTicket?.status,
    selectedTicket?.mode,
    ticketActionLoading,
    deliveryFailuresLoading,
    canSendSelectedTicketMessage,
    sendingMessage,
    uploadingAttachment,
  ]);
  const visibleSlashCommands = useMemo<SlashCommandItem[]>(() => {
    if (!slashMode) return [];
    if (!slashQuery) return slashCommandItems;
    return slashCommandItems.filter((item) => item.title.slice(1).startsWith(slashQuery));
  }, [slashMode, slashQuery, slashCommandItems]);
  const hasDraftContent = Boolean((slashMode ? '' : messageDraft).trim() || draftAttachment?.mediaUrl);
  const visibleMessages = messages.slice(Math.max(0, messages.length - visibleMessagesCount));
  const hiddenMessagesCount = Math.max(0, messages.length - visibleMessages.length);
  const supportPanelMinHeight = Math.max(520, Math.floor(viewportHeight * 0.8));
  const messagesViewportHeight = Math.max(320, Math.floor(viewportHeight * 0.52));

  function onMessagesScroll(yOffset: number): void {
    messageScrollOffsetRef.current = yOffset;
    if (yOffset > MESSAGE_LOAD_MORE_TOP_THRESHOLD) return;
    if (hiddenMessagesCount <= 0) return;
    if (loadingMoreMessagesRef.current) return;

    loadingMoreMessagesRef.current = true;
    setMessagesLoadingMore(true);
    pendingScrollRestoreRef.current = {
      prevOffset: messageScrollOffsetRef.current,
      prevHeight: messageContentHeightRef.current,
    };
    setVisibleMessagesCount((prev) => Math.min(prev + MESSAGE_PAGE_SIZE, messages.length));
  }

  function onMessagesContentSizeChange(_: number, height: number): void {
    messageContentHeightRef.current = height;
    const pending = pendingScrollRestoreRef.current;
    if (!pending) return;

    const delta = height - pending.prevHeight;
    const target = Math.max(0, pending.prevOffset + Math.max(0, delta));
    messageScrollRef.current?.scrollTo({ y: target, animated: false });

    pendingScrollRestoreRef.current = null;
    loadingMoreMessagesRef.current = false;
    setMessagesLoadingMore(false);
  }

  useEffect(() => {
    if (!selectedTicketId || messages.length === 0) return;
    if (messagesLoading || messagesLoadingMore || loadingMoreMessagesRef.current) return;
    messageScrollRef.current?.scrollToEnd({ animated: true });
  }, [selectedTicketId, messages, messagesLoading, messagesLoadingMore]);

  useEffect(() => {
    if (tickets.length === 0) {
      setIsChatScreen(false);
    }
  }, [tickets.length]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showOptionsMenu) {
        setShowOptionsMenu(false);
        return true;
      }
      if (showDeliveryFailures) {
        setShowDeliveryFailures(false);
        return true;
      }
      if (isChatScreen) {
        setIsChatScreen(false);
        return true;
      }
      return false;
    });

    return () => {
      subscription.remove();
    };
  }, [showOptionsMenu, showDeliveryFailures, isChatScreen]);

  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardInset(Math.max(0, Number(event?.endCoordinates?.height || 0)));
    });
    const onHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardInset(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  async function openMediaLink(mediaUrl?: string | null): Promise<void> {
    const resolved = resolveMediaUrl(mediaUrl);
    if (!resolved) return;
    try {
      await Linking.openURL(resolved);
    } catch {
      setStatus('Nao foi possivel abrir a midia.');
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bgPrimary }]}>
      <View style={styles.backgroundLayer} pointerEvents="none">
        <View style={[styles.bubbleLarge, { backgroundColor: theme.bubbleA }]} />
        <View style={[styles.bubbleSmall, { backgroundColor: theme.bubbleB }]} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 24 + (isChatScreen ? Math.floor(keyboardInset * 0.35) : 0) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {sessionBootstrapping && !authToken ? (
          <View
            style={[
              styles.loginCard,
              {
                backgroundColor: theme.panel,
                borderColor: theme.borderDefault,
                shadowColor: theme.shadow,
              },
            ]}
          >
            <Text style={[styles.title, { color: theme.textPrimary }]}>Restaurando sessão...</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Aguarde enquanto validamos seu login.
            </Text>
          </View>
        ) : showLogin ? (
          <View
            style={[
              styles.loginCard,
              {
                backgroundColor: theme.panel,
                borderColor: theme.borderDefault,
                shadowColor: theme.shadow,
              },
            ]}
          >
            <View style={styles.logoWrap}>
              <View style={[styles.logoBadge, { backgroundColor: theme.accentLight }]}>
                <Image source={RESULTS_LOGO} style={styles.logoImage} resizeMode="contain" />
              </View>
              <Text style={[styles.title, { color: theme.textPrimary }]}>Login de Agente</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Acesse o sistema de atendimento</Text>
            </View>

            {error ? (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: `${theme.statusError}1A`,
                    borderColor: `${theme.statusError}55`,
                  },
                ]}
              >
                <Text style={[styles.errorText, { color: theme.statusError }]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>Username</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Digite seu username"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.bgPrimary,
                    color: theme.textPrimary,
                    borderColor: focusedField === 'username' ? theme.accentPrimary : theme.borderDefault,
                  },
                ]}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>Senha</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Digite sua senha"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                secureTextEntry
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.bgPrimary,
                    color: theme.textPrimary,
                    borderColor: focusedField === 'password' ? theme.accentPrimary : theme.borderDefault,
                  },
                ]}
              />
            </View>

            <Pressable
              disabled={Boolean(startupBlockedReason) || loading || !username.trim() || !password.trim()}
              onPress={onLogin}
              style={({ pressed }) => [
                styles.loginButton,
                {
                  backgroundColor: startupBlockedReason || loading || !username.trim() || !password.trim() ? theme.borderHover : theme.accentPrimary,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text style={styles.loginButtonText}>{loading ? 'Iniciando...' : 'Entrar'}</Text>
            </Pressable>

            <View style={[styles.hintBox, { backgroundColor: theme.bgTertiary, borderColor: theme.borderDefault }]}> 
              <Text style={[styles.hintTitle, { color: theme.textPrimary }]}>Acesso seguro</Text>
              <Text style={[styles.hintText, { color: theme.textSecondary }]}>Use suas credenciais de agente.</Text>
            </View>

            <View style={[styles.metaBlock, { borderColor: theme.borderDefault }]}> 
              <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Tenant ID (obrigatório para super-admin)</Text>
              <TextInput
                value={tenantId}
                onChangeText={setTenantId}
                placeholder="system"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  styles.apiInput,
                  {
                    backgroundColor: theme.bgPrimary,
                    color: theme.textPrimary,
                    borderColor: theme.borderDefault,
                  },
                ]}
              />
              {__DEV__ ? (
                <>
                  <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>API base URL</Text>
                  <TextInput
                    value={apiBaseUrl}
                    onChangeText={setApiBaseUrl}
                    placeholder={apiResolution.baseUrl}
                    placeholderTextColor={theme.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      styles.apiInput,
                      {
                        backgroundColor: theme.bgPrimary,
                        color: theme.textPrimary,
                        borderColor: theme.borderDefault,
                      },
                    ]}
                  />
                  <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Detecção API</Text>
                  <Text style={[styles.metaValue, { color: theme.textPrimary }]}>{getApiSourceLabel(apiResolution.source)}</Text>
                  {apiResolution.detectedHost ? (
                    <Text style={[styles.metaValue, { color: theme.textSecondary }]}>host detectado: {apiResolution.detectedHost}</Text>
                  ) : null}
                </>
              ) : null}
              {routePreview ? (
                <>
                  <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Rota ao tocar notificação</Text>
                  <Text style={[styles.metaValue, { color: theme.textPrimary }]}>{routePreview}</Text>
                </>
              ) : null}
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.pushCard,
              {
                backgroundColor: theme.panel,
                borderColor: theme.borderDefault,
                minHeight: supportPanelMinHeight,
              },
            ]}
          >
            <View style={styles.waTopBar}>
              <View style={styles.waTopHeaderRow}>
                <View style={styles.waTopLeft}>
                  {isChatScreen && selectedTicket?.customerPhoto ? (
                    <Image
                      source={{ uri: selectedTicket.customerPhoto }}
                      style={styles.waAvatar}
                      defaultSource={require('./assets/home_results_29.png')}
                    />
                  ) : (
                    <View style={styles.waAvatar}>
                      <Text style={styles.waAvatarText}>
                        {(isChatScreen ? getTicketTitle(selectedTicket) : 'Conversas').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.waTopTextWrap}>
                    <View style={styles.waTopTitleRow}>
                      <Text style={styles.waTopTitle} numberOfLines={1}>
                        {isChatScreen ? getTicketTitle(selectedTicket) : 'Conversas'}
                      </Text>
                      {!isChatScreen && totalUnreadCount > 0 ? (
                        <View style={styles.headerCountBadgeWa}>
                          <Text style={styles.headerCountBadgeTextWa}>{formatBadgeCount(totalUnreadCount)}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.waTopSubtitle} numberOfLines={1}>
                      {isChatScreen
                        ? `${getTicketPhoneLabel(selectedTicket) || '—'} • ${selectedAssignedTo ? `Atribuído: ${selectedAssignedToDisplay || selectedAssignedTo}` : 'Não atribuído'}`
                        : `tenant: ${tenantId || 'n/a'}`}
                    </Text>
                  </View>
                </View>
                <Pressable
                  disabled={isActionBusy}
                  onPress={() => setShowOptionsMenu((prev) => !prev)}
                  style={({ pressed }) => [styles.moreButtonWa, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={styles.moreButtonWaText}>⋮</Text>
                </Pressable>
              </View>
              <View style={styles.waTopActions}>
                <View
                  style={[
                    isChatScreen ? styles.wsStatusDotOnly : styles.refreshButtonWa,
                    { backgroundColor: isChatScreen ? 'transparent' : wsStatus.color },
                  ]}
                >
                  {isChatScreen ? (
                    <View style={[styles.wsDotOnlyCircle, { backgroundColor: wsStatus.color }]} />
                  ) : (
                    <>
                      <View style={styles.wsDotWa} />
                      <Text style={styles.refreshButtonWaText}>{wsStatus.label}</Text>
                    </>
                  )}
                </View>
                {isChatScreen && selectedTicketId ? (
                  <Text style={styles.waTopSubtitle} numberOfLines={1}>
                    {`Ticket #${selectedTicketId}`}
                  </Text>
                ) : null}
                {isChatScreen ? (
                  <View style={styles.sectionBadgeWa}>
                    <Text style={styles.sectionBadgeTextWa}>{messages.length}</Text>
                  </View>
                ) : null}
                {isChatScreen && selectedTicketWaiting && !selectedAssignedTo ? (
                  <Pressable
                    disabled={!selectedTicketId || isActionBusy}
                    onPress={onAssignSelectedTicketToMe}
                    style={({ pressed }) => [
                      styles.assignButtonWa,
                      {
                        opacity: pressed ? 0.85 : 1,
                        backgroundColor: !selectedTicketId || isActionBusy ? '#3f4e57' : BRAND_RED_SOFT,
                      },
                    ]}
                  >
                    <Text style={styles.assignButtonWaText}>Atribuir</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {showOptionsMenu ? (
              <View style={styles.optionsMenuWa}>
                <Pressable
                  disabled={isActionBusy}
                  onPress={() => {
                    setShowOptionsMenu(false);
                    loadTickets({ requestId: buildRequestId('support-manual-refresh') });
                  }}
                  style={styles.optionsMenuItemWa}
                >
                  <Text style={styles.optionsMenuItemTextWa}>Atualizar conversas</Text>
                </Pressable>
                <Pressable
                  disabled={isActionBusy}
                  onPress={() => {
                    setShowOptionsMenu(false);
                    setThemeName((prev) => (prev === 'dark' ? 'light' : 'dark'));
                  }}
                  style={styles.optionsMenuItemWa}
                >
                  <Text style={styles.optionsMenuItemTextWa}>
                    Tema: {themeName === 'dark' ? 'Claro' : 'Escuro'}
                  </Text>
                </Pressable>
                {isChatScreen ? (
                  <Pressable
                    disabled={!selectedTicketId || selectedAssignedToMe || isActionBusy}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      onAssignSelectedTicketToMe();
                    }}
                    style={styles.optionsMenuItemWa}
                  >
                    <Text
                      style={[
                        styles.optionsMenuItemTextWa,
                        !selectedTicketId || selectedAssignedToMe || isActionBusy ? styles.optionsMenuItemDisabledWa : null,
                      ]}
                    >
                      {selectedAssignedToMe ? 'Ticket já atribuído' : 'Atribuir para mim'}
                    </Text>
                  </Pressable>
                ) : null}
                {isChatScreen ? (
                  <Pressable
                    disabled={!selectedTicketId || !selectedAssignedToMe || isActionBusy}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      if (selectedTicketPaused) {
                        onResumeSelectedTicket();
                        return;
                      }
                      if (selectedTicketBot) {
                        onTakeOverSelectedTicket();
                        return;
                      }
                      onReturnSelectedTicketToBot();
                    }}
                    style={styles.optionsMenuItemWa}
                  >
                    <Text
                      style={[
                        styles.optionsMenuItemTextWa,
                        (!selectedTicketId || !selectedAssignedToMe || isActionBusy) ? styles.optionsMenuItemDisabledWa : null,
                      ]}
                    >
                      {selectedTicketPaused ? 'Retomar atendimento' : selectedTicketBot ? 'Assumir atendimento' : 'Devolver para bot'}
                    </Text>
                  </Pressable>
                ) : null}
                {isChatScreen ? (
                  <Pressable
                    disabled={!selectedTicketId || !selectedAssignedToMe || selectedTicketPaused || isActionBusy}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      onPauseSelectedTicket();
                    }}
                    style={styles.optionsMenuItemWa}
                  >
                    <Text
                      style={[
                        styles.optionsMenuItemTextWa,
                        (!selectedTicketId || !selectedAssignedToMe || selectedTicketPaused || isActionBusy) ? styles.optionsMenuItemDisabledWa : null,
                      ]}
                    >
                      Pausar atendimento
                    </Text>
                  </Pressable>
                ) : null}
                {isChatScreen ? (
                  <Pressable
                    disabled={!selectedTicketId || deliveryFailuresLoading || isActionBusy}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      onLoadSelectedTicketDeliveryFailures();
                    }}
                    style={styles.optionsMenuItemWa}
                  >
                    <Text
                      style={[
                        styles.optionsMenuItemTextWa,
                        (!selectedTicketId || deliveryFailuresLoading || isActionBusy) ? styles.optionsMenuItemDisabledWa : null,
                      ]}
                    >
                      {deliveryFailuresLoading ? 'Carregando falhas...' : 'Ver falhas de entrega'}
                    </Text>
                  </Pressable>
                ) : null}
                {isChatScreen ? (
                  <Pressable
                    onPress={() => {
                      setShowOptionsMenu(false);
                      setIsChatScreen(false);
                    }}
                    style={styles.optionsMenuItemWa}
                  >
                    <Text style={styles.optionsMenuItemTextWa}>Voltar para conversas</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => {
                    setShowOptionsMenu(false);
                    onLogout();
                  }}
                  style={styles.optionsMenuItemWa}
                >
                  <Text style={[styles.optionsMenuItemTextWa, styles.optionsMenuDangerWa]}>Sair</Text>
                </Pressable>
              </View>
            ) : null}

            {!isChatScreen ? (
              <>
                <View style={styles.sectionTitleRowWa}>
                  <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>Conversas</Text>
                  <View style={styles.sectionBadgeGroupWa}>
                    <View style={styles.sectionBadgeWa}>
                      <Text style={styles.sectionBadgeTextWa}>{tickets.length}</Text>
                    </View>
                    {totalUnreadCount > 0 ? (
                      <View style={[styles.sectionBadgeWa, styles.sectionBadgeUnreadWa]}>
                        <Text style={[styles.sectionBadgeTextWa, styles.sectionBadgeUnreadTextWa]}>
                          {formatBadgeCount(totalUnreadCount)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {ticketsLoading ? (
                  <Text style={[styles.metaValue, { color: theme.textSecondary }]}>Carregando tickets...</Text>
                ) : tickets.length === 0 ? (
                  <Text style={[styles.metaValue, { color: theme.textSecondary }]}>Nenhum ticket aberto.</Text>
                ) : (
                  <View style={styles.ticketList}>
                    {crmLookupCooldownUntil > Date.now() ? (
                      <View style={styles.crmWarningBadgeWa}>
                        <Text style={styles.crmWarningBadgeTextWa}>
                          Nomes do CRM temporariamente indisponíveis (timeout). Exibindo telefone enquanto reconecta.
                        </Text>
                      </View>
                    ) : null}
                    {tickets.map((ticket) => {
                      const active = selectedTicketId === String(ticket.id);
                      const statusStyle = getTicketStatusStyle(ticket);
                      return (
                        <Pressable
                          key={String(ticket.id)}
                          onPress={() => onSelectTicket(String(ticket.id))}
                          style={[
                            styles.ticketItem,
                            {
                              borderColor: active ? BRAND_RED_SOFT : theme.borderDefault,
                              backgroundColor: active ? 'rgba(229,115,115,0.14)' : theme.bgPrimary,
                            },
                          ]}
                        >
                          <View style={styles.ticketContactRowWa}>
                            <Text style={[styles.ticketContactNameWa, { color: theme.textPrimary }]} numberOfLines={1}>
                              {getTicketContactName(ticket)}
                            </Text>
                            <Text style={[styles.ticketContactPhoneWa, { color: theme.textSecondary }]} numberOfLines={1}>
                              {getTicketPhoneLabel(ticket) || '—'}
                            </Text>
                          </View>
                          <View style={styles.ticketIdRowWa}>
                            <Text style={[styles.ticketId, { color: theme.textSecondary }]} numberOfLines={2}>
                              #{String(ticket.id || '')}
                            </Text>
                            <View style={styles.ticketModeBadgeWa}>
                              <Text style={styles.ticketModeBadgeTextWa}>{formatTicketMode(ticket.mode)}</Text>
                            </View>
                          </View>
                          <View style={styles.ticketTopRowWa}>
                            <View style={styles.ticketStatusGroupWa}>
                              <View
                                style={[
                                  styles.ticketStatusBadgeWa,
                                  {
                                    backgroundColor: statusStyle.backgroundColor,
                                    borderColor: statusStyle.borderColor,
                                  },
                                ]}
                              >
                                <Text style={[styles.ticketStatusBadgeTextWa, { color: statusStyle.color }]}>
                                  {formatTicketStatusLabel(ticket)}
                                </Text>
                              </View>
                              <Text style={[styles.ticketMeta, { color: theme.textTertiary }]}>
                                {formatTime(ticket.updatedAt)}
                              </Text>
                            </View>
                            <View>
                              {getTicketUnreadCount(ticket) > 0 ? (
                                <View style={styles.ticketUnreadBadgeWa}>
                                  <Text style={styles.ticketUnreadBadgeTextWa}>
                                    {formatBadgeCount(getTicketUnreadCount(ticket))}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          <Text style={[styles.ticketMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                            {getTicketPreview(ticket)}
                          </Text>
                          <Text style={[styles.ticketMeta, { color: theme.textTertiary }]} numberOfLines={1}>
                            {ticket.assignedTo ? `👤 ${ticket.assignedToDisplay || ticket.assignedTo}` : 'Não atribuído'} • {ticket.queue || 'Sem fila'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            ) : (
              <>
                {selectedTicketPaused ? (
                  <View style={styles.pausedInfoBoxWa}>
                    <Text style={styles.pausedInfoTitleWa}>Atendimento pausado</Text>
                    <Text style={styles.pausedInfoTextWa}>
                      Motivo: {String(selectedTicket?.pauseReason || 'não informado')}
                    </Text>
                  </View>
                ) : null}
                {showDeliveryFailures ? (
                  <View style={styles.deliveryFailuresBoxWa}>
                    <Text style={styles.deliveryFailuresTitleWa}>Falhas de entrega</Text>
                    <Text style={styles.deliveryFailuresTextWa}>
                      Fila outbound: {Array.isArray(deliveryFailures.outboundQueue) ? deliveryFailures.outboundQueue.length : 0}
                    </Text>
                    <Text style={styles.deliveryFailuresTextWa}>
                      Mensagens de canal: {Array.isArray(deliveryFailures.channelMessages) ? deliveryFailures.channelMessages.length : 0}
                    </Text>
                  </View>
                ) : null}

                <View style={[styles.messagesBoxWa, { minHeight: messagesViewportHeight, maxHeight: messagesViewportHeight }]}>
                  {messagesLoading ? (
                    <Text style={[styles.metaValue, { color: theme.textSecondary }]}>Carregando mensagens...</Text>
                  ) : messages.length === 0 ? (
                    <Text style={[styles.metaValue, { color: theme.textSecondary }]}>Sem mensagens para este ticket.</Text>
                  ) : (
                    <ScrollView
                      ref={messageScrollRef}
                      style={styles.messagesScroll}
                      onScroll={(event) => onMessagesScroll(event.nativeEvent.contentOffset.y)}
                      onContentSizeChange={onMessagesContentSizeChange}
                      scrollEventThrottle={16}
                      nestedScrollEnabled
                    >
                      {hiddenMessagesCount > 0 ? (
                        <Text style={styles.loadMoreHintWa}>
                          {messagesLoadingMore
                            ? 'Carregando mensagens antigas...'
                            : `Role para cima para carregar mais (${hiddenMessagesCount} restantes)`}
                        </Text>
                      ) : null}
                      {visibleMessages.map((msg, idx) => (
                        <View
                          key={msg.uiKey || `${msg.id ? String(msg.id) : 'msg'}:${idx}`}
                          style={[
                            styles.messageRowWa,
                            isOutgoingMessage(msg.sender) ? styles.messageRowOutgoingWa : styles.messageRowIncomingWa,
                          ]}
                        >
                          <View
                            style={[
                              styles.messageBubbleWa,
                              isOutgoingMessage(msg.sender) ? styles.messageBubbleOutgoingWa : styles.messageBubbleIncomingWa,
                            ]}
                          >
                            <Text style={styles.messageBodyWa}>{msg.text || ''}</Text>
                            {msg.mediaUrl ? (
                              <View style={styles.messageMediaWrapWa}>
                                {msg.messageType === 'image' ? (
                                  <Pressable onPress={() => { void openMediaLink(msg.mediaUrl); }}>
                                    <Image
                                      source={{ uri: resolveMediaUrl(msg.mediaUrl) }}
                                      style={styles.messageImageWa}
                                      resizeMode="cover"
                                    />
                                  </Pressable>
                                ) : null}
                                {msg.messageType === 'video' ? (
                                  <Video
                                    source={{ uri: resolveMediaUrl(msg.mediaUrl) }}
                                    style={styles.messageVideoWa}
                                    useNativeControls
                                    resizeMode="cover"
                                    isLooping={false}
                                  />
                                ) : null}
                                {msg.messageType === 'audio' ? (
                                  <Video
                                    source={{ uri: resolveMediaUrl(msg.mediaUrl) }}
                                    style={styles.messageAudioWa}
                                    useNativeControls
                                    resizeMode="contain"
                                    isLooping={false}
                                  />
                                ) : null}
                                <Pressable
                                  onPress={() => { void openMediaLink(msg.mediaUrl); }}
                                  style={({ pressed }) => [
                                    styles.messageMediaLinkWa,
                                    { opacity: pressed ? 0.85 : 1 },
                                  ]}
                                >
                                  <Ionicons
                                    name={msg.messageType === 'audio' ? 'musical-notes-outline' : msg.messageType === 'video' ? 'videocam-outline' : 'document-text-outline'}
                                    size={14}
                                    color="#ffffff"
                                  />
                                  <Text style={styles.messageMediaLinkTextWa}>
                                    {msg.fileName || 'Abrir anexo'}
                                  </Text>
                                </Pressable>
                              </View>
                            ) : null}
                            <Text style={styles.messageMetaWa}>
                              {(msg.senderDisplay || msg.sender || 'sistema')} • {formatDateTime(msg.timestamp)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {draftAttachment ? (
                  <View style={styles.attachmentPreviewWa}>
                    <View style={styles.attachmentPreviewHeadWa}>
                      <Ionicons name="attach-outline" size={14} color="#ffffff" />
                      <Text style={styles.attachmentPreviewTitleWa}>{draftAttachment.fileName}</Text>
                    </View>
                    <Text style={styles.attachmentPreviewMetaWa}>
                      {draftAttachment.mediaType} • {Math.max(1, Math.ceil((draftAttachment.sizeBytes || 0) / 1024))} KB
                    </Text>
                    <Pressable
                      onPress={() => setDraftAttachment(null)}
                      style={({ pressed }) => [
                        styles.attachmentRemoveWa,
                        { opacity: pressed ? 0.85 : 1 },
                      ]}
                    >
                      <Text style={styles.attachmentRemoveTextWa}>Remover</Text>
                    </Pressable>
                  </View>
                ) : null}

                {slashMode ? (
                  <View style={styles.slashMenuWa}>
                    {visibleSlashCommands.length === 0 ? (
                      <Text style={styles.slashMenuEmptyWa}>Nenhum comando encontrado</Text>
                    ) : (
                      visibleSlashCommands.map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => {
                            setMessageDraft('');
                            if (!item.enabled) return;
                            const handled = executeSlashCommand(item.title);
                            if (!handled) item.action();
                          }}
                          disabled={!item.enabled}
                          style={({ pressed }) => [
                            styles.slashMenuItemWa,
                            !item.enabled ? styles.slashMenuItemDisabledWa : null,
                            pressed ? styles.slashMenuItemPressedWa : null,
                          ]}
                        >
                          <Text style={styles.slashMenuTitleWa}>{item.title}</Text>
                          <Text style={styles.slashMenuDescWa}>{item.description}</Text>
                        </Pressable>
                      ))
                    )}
                  </View>
                ) : null}

                <View style={styles.composerWa}>
                  <Pressable
                    onPress={onAttachMedia}
                    disabled={!canSendSelectedTicketMessage || sendingMessage || uploadingAttachment}
                    style={({ pressed }) => [
                      styles.composerAttachWa,
                      {
                        backgroundColor:
                          !canSendSelectedTicketMessage || sendingMessage || uploadingAttachment
                            ? '#51616b'
                            : '#2A3942',
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                  >
                    {uploadingAttachment ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="attach" size={18} color="#ffffff" />
                    )}
                  </Pressable>
                  <TextInput
                    style={styles.composerInputWa}
                    placeholder="Digite / para abrir comandos e respostas rápidas."
                    placeholderTextColor="#9CA3AF"
                    value={messageDraft}
                    onChangeText={setMessageDraft}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={canSendSelectedTicketMessage && !sendingMessage}
                  />
                  <View style={styles.composerCountBadgeWa}>
                    <Text style={styles.composerCountBadgeTextWa}>{messageDraft.trim().length}</Text>
                  </View>
                  <Pressable
                    onPress={onSendMessage}
                    disabled={!canSendSelectedTicketMessage || !hasDraftContent || sendingMessage}
                    style={({ pressed }) => [
                      styles.composerSendWa,
                      {
                        backgroundColor:
                          !canSendSelectedTicketMessage || !hasDraftContent || sendingMessage
                            ? '#7a7f83'
                            : BRAND_RED_SOFT,
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                  >
                    {sendingMessage ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="send" size={18} color="#ffffff" />
                    )}
                  </Pressable>
                </View>
              </>
            )}

          </View>
        )}

        {!showLogin && !isChatScreen ? (
          <View style={[styles.statusCard, { backgroundColor: theme.panel, borderColor: theme.borderDefault }]}>
            <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Status</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>{status}</Text>
            <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>WebSocket</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>{wsStatus.label}</Text>
            <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Último evento WS</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>{wsLastEvent || 'nenhum'}</Text>
            <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Rota ao tocar notificação</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>{routePreview || 'Nenhuma notificação clicada ainda'}</Text>
          </View>
        ) : null}

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bubbleLarge: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    left: -80,
    top: 120,
  },
  bubbleSmall: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    right: -90,
    bottom: 90,
  },
  container: {
    minHeight: '100%',
    paddingHorizontal: 20,
    paddingVertical: 24,
    justifyContent: 'flex-start',
    gap: 16,
  },
  themeSwitch: {
    alignSelf: 'flex-end',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  themeSwitchText: {
    fontSize: 13,
    fontWeight: '600',
  },
  loginCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    elevation: 8,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoBadge: {
    width: 120,
    height: 120,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
  },
  fieldBlock: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  loginButton: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  hintBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  hintTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  hintText: {
    fontSize: 12,
    marginBottom: 2,
  },
  metaBlock: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 4,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  metaValue: {
    fontSize: 12,
  },
  apiInput: {
    marginTop: 4,
    marginBottom: 4,
    paddingVertical: 10,
    fontSize: 13,
  },
  pushCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    gap: 10,
  },
  waTopBar: {
    backgroundColor: '#8B1A1A',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 8,
  },
  waTopHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  waTopTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  waTopTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  waAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: BRAND_RED_MAIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waAvatarText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  waTopTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  waTopSubtitle: {
    color: '#d6f5ee',
    fontSize: 11,
  },
  headerCountBadgeWa: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: BRAND_RED_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCountBadgeTextWa: {
    color: '#0B141A',
    fontSize: 10,
    fontWeight: '800',
  },
  refreshButtonWa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: BRAND_RED_MAIN,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  wsStatusDotOnly: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
  },
  wsDotOnlyCircle: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  wsDotWa: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  refreshButtonWaText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  assignButtonWa: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  assignButtonWaText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  closeButtonWa: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  closeButtonWaText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  backButtonWa: {
    borderRadius: 8,
    backgroundColor: '#3f4e57',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  backButtonWaText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  moreButtonWa: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1F2C34',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButtonWaText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: -2,
  },
  optionsMenuWa: {
    alignSelf: 'flex-end',
    marginTop: -2,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f3b42',
    backgroundColor: '#1f2c34',
    minWidth: 220,
    overflow: 'hidden',
  },
  optionsMenuItemWa: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2f3b42',
  },
  optionsMenuItemTextWa: {
    color: '#E9EDEF',
    fontSize: 13,
    fontWeight: '600',
  },
  optionsMenuItemDisabledWa: {
    color: '#7c8b93',
  },
  optionsMenuDangerWa: {
    color: BRAND_RED_SOFT,
  },
  ticketList: {
    gap: 8,
    marginBottom: 8,
  },
  crmWarningBadgeWa: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b71c1c',
    backgroundColor: '#4d1a1a',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  crmWarningBadgeTextWa: {
    color: '#FFAB91',
    fontSize: 11,
    fontWeight: '600',
  },
  sectionTitleRowWa: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionBadgeGroupWa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionBadgeWa: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2A3942',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  sectionBadgeTextWa: {
    color: '#E9EDEF',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionBadgeUnreadWa: {
    backgroundColor: BRAND_RED_SOFT,
  },
  sectionBadgeUnreadTextWa: {
    color: '#0B141A',
  },
  ticketTopRowWa: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketStatusGroupWa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketStatusBadgeWa: {
    backgroundColor: '#103529',
    borderWidth: 1,
    borderColor: '#1f7a5f',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  ticketStatusBadgeTextWa: {
    color: '#7DE7BE',
    fontSize: 10,
    fontWeight: '700',
  },
  ticketUnreadBadgeWa: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    backgroundColor: BRAND_RED_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  ticketUnreadBadgeTextWa: {
    color: '#0B141A',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  ticketItem: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  ticketContactRowWa: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  ticketContactNameWa: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  ticketContactPhoneWa: {
    fontSize: 12,
    textAlign: 'right',
    maxWidth: '45%',
  },
  ticketIdRowWa: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
  ticketId: {
    fontSize: 11,
  },
  ticketModeBadgeWa: {
    backgroundColor: '#202C33',
    borderWidth: 1,
    borderColor: '#2f3b42',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  ticketModeBadgeTextWa: {
    color: '#AEBAC1',
    fontSize: 10,
    fontWeight: '700',
  },
  ticketMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  messagesBox: {
    borderWidth: 0,
    borderRadius: 10,
    padding: 0,
  },
  messagesBoxWa: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111B21',
  },
  pausedInfoBoxWa: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7C2D12',
    backgroundColor: '#431407',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
    marginBottom: 6,
  },
  pausedInfoTitleWa: {
    color: '#FDBA74',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  pausedInfoTextWa: {
    color: '#FFEDD5',
    fontSize: 11,
  },
  deliveryFailuresBoxWa: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#450A0A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
    marginBottom: 6,
  },
  deliveryFailuresTitleWa: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  deliveryFailuresTextWa: {
    color: '#FECACA',
    fontSize: 11,
  },
  messagesScroll: {
    flex: 1,
  },
  messageItem: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#4B5563',
  },
  messageRowWa: {
    marginBottom: 8,
    flexDirection: 'row',
  },
  messageRowIncomingWa: {
    justifyContent: 'flex-start',
  },
  messageRowOutgoingWa: {
    justifyContent: 'flex-end',
  },
  messageBubbleWa: {
    maxWidth: '85%',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  messageBubbleIncomingWa: {
    backgroundColor: '#202C33',
    borderTopLeftRadius: 4,
  },
  messageBubbleOutgoingWa: {
    backgroundColor: '#6B1A1A',
    borderTopRightRadius: 4,
  },
  messageBodyWa: {
    color: '#E9EDEF',
    fontSize: 13,
  },
  messageMediaWrapWa: {
    marginTop: 8,
    gap: 8,
  },
  messageImageWa: {
    width: 180,
    height: 180,
    borderRadius: 10,
    backgroundColor: '#0B141A',
  },
  messageVideoWa: {
    width: 220,
    height: 160,
    borderRadius: 10,
    backgroundColor: '#0B141A',
  },
  messageAudioWa: {
    width: 220,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#0B141A',
  },
  messageMediaLinkWa: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3d1616',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  messageMediaLinkTextWa: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  messageMetaWa: {
    color: '#AEBAC1',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  messageSender: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  messageBody: {
    fontSize: 13,
  },
  messageTime: {
    fontSize: 11,
    marginTop: 2,
  },
  loadMoreHint: {
    fontSize: 12,
    marginBottom: 10,
  },
  loadMoreHintWa: {
    color: '#8696A0',
    textAlign: 'center',
    fontSize: 11,
    marginBottom: 8,
  },
  composerWa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#202C33',
    borderRadius: 12,
    padding: 6,
    marginTop: 4,
  },
  attachmentPreviewWa: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f3b42',
    backgroundColor: '#1f2c34',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 4,
  },
  attachmentPreviewHeadWa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachmentPreviewTitleWa: {
    color: '#E9EDEF',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  attachmentPreviewMetaWa: {
    color: '#AEBAC1',
    fontSize: 11,
  },
  attachmentRemoveWa: {
    alignSelf: 'flex-start',
    backgroundColor: '#6B1A1A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attachmentRemoveTextWa: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  slashMenuWa: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f3b42',
    backgroundColor: '#1f2c34',
    marginBottom: 8,
    overflow: 'hidden',
  },
  slashMenuItemWa: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2f3b42',
    gap: 2,
  },
  slashMenuItemDisabledWa: {
    opacity: 0.45,
  },
  slashMenuItemPressedWa: {
    backgroundColor: '#2A3942',
  },
  slashMenuTitleWa: {
    color: '#E9EDEF',
    fontSize: 12,
    fontWeight: '700',
  },
  slashMenuDescWa: {
    color: '#AEBAC1',
    fontSize: 11,
  },
  slashMenuEmptyWa: {
    color: '#AEBAC1',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  composerAttachWa: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInputWa: {
    flex: 1,
    backgroundColor: '#2A3942',
    color: '#E9EDEF',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  composerSendWa: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerCountBadgeWa: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2A3942',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  composerCountBadgeTextWa: {
    color: '#AEBAC1',
    fontSize: 11,
    fontWeight: '700',
  },
  composerSendTextWa: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  actionButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statusCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
});
