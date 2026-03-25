import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTicketMessages,
  markTicketAsRead,
  getTicketAiSummary,
  generateTicketAiSummary,
} from '../api/tickets';
import { getConversationMessages } from '../api/conversations';
import { getAllTags } from '../api/segmentation';
import { queryAuditLogs } from '../api/audit';
import logger from '../utils/logger';

function safeGetBodyText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body.text === 'string') return body.text;
  if (typeof body.caption === 'string') return body.caption;
  if (body.text && typeof body.text === 'object' && typeof body.text.body === 'string') return body.text.body;
  if (body.image && typeof body.image === 'object' && typeof body.image.caption === 'string') return body.image.caption;
  if (body.document && typeof body.document === 'object' && typeof body.document.caption === 'string') return body.document.caption;
  if (body.video && typeof body.video === 'object' && typeof body.video.caption === 'string') return body.video.caption;
  return '';
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

export function useSupportTicketContext({
  selectedTicket,
  setSelectedTicket,
  setTickets,
  showToast,
}) {
  const [ticketMessages, setTicketMessages] = useState([]);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [timelineMessages, setTimelineMessages] = useState([]);
  const [ticketEvents, setTicketEvents] = useState([]);
  const [ticketAuditLogs, setTicketAuditLogs] = useState([]);
  const [ticketAuditLoading, setTicketAuditLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [knownTags, setKnownTags] = useState([]);
  const messagesContainerRef = useRef(null);
  const loadTicketMessagesRef = useRef();
  const autoSummaryRequestedRef = useRef(new Set());

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

      setTickets((prevTickets) => {
        const ticket = prevTickets.find((t) => t.id === ticketId);
        if (ticket && ticket.status === 'in_progress' && ticket.unreadCount > 0) {
          markTicketAsRead(ticketId).catch((err) => {
            logger.error('Erro ao marcar ticket como lido', err);
          });
          const updatedTickets = prevTickets.map((t) => (
            t.id === ticketId ? { ...t, unreadCount: 0 } : t
          ));
          setSelectedTicket((prevSelected) => (
            prevSelected?.id === ticketId ? { ...prevSelected, unreadCount: 0 } : prevSelected
          ));
          return updatedTickets;
        }
        return prevTickets;
      });
    } catch (error) {
      if (error.status === 404 || (error.body && error.body.error === 'ticket_not_found')) {
        setTickets((prevTickets) => prevTickets.filter((t) => t.id !== ticketId));
        setSelectedTicket(null);
        setTicketMessages([]);
        return;
      }
      logger.error('Erro ao carregar mensagens', error);
    }
  }, [setSelectedTicket, setTickets]);

  useEffect(() => {
    loadTicketMessagesRef.current = loadTicketMessages;
  }, [loadTicketMessages]);

  useEffect(() => {
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

  useEffect(() => {
    getAllTags()
      .then((resp) => setKnownTags((resp?.tags || []).map((t) => t.tag || t).filter(Boolean)))
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

  const handleGenerateAiSummary = useCallback(async ({ silent = false } = {}) => {
    if (!selectedTicket?.id) return;
    setAiSummaryLoading(true);
    try {
      const resp = await generateTicketAiSummary(selectedTicket.id);
      setAiSummary(resp?.summary || null);
    } catch (err) {
      logger.error('Erro ao gerar resumo IA', err);
      if (!silent) showToast('Erro ao gerar resumo IA', 'error');
    } finally {
      setAiSummaryLoading(false);
    }
  }, [selectedTicket?.id, showToast]);

  useEffect(() => {
    const ticketId = selectedTicket?.id;
    if (!ticketId) return;
    if (aiSummaryLoading) return;
    if (aiSummary) {
      autoSummaryRequestedRef.current.add(ticketId);
      return;
    }
    if (autoSummaryRequestedRef.current.has(ticketId)) return;

    autoSummaryRequestedRef.current.add(ticketId);
    handleGenerateAiSummary({ silent: true });
  }, [selectedTicket?.id, aiSummary, aiSummaryLoading, handleGenerateAiSummary]);

  useEffect(() => {
    if (selectedTicket) {
      loadTicketMessages(selectedTicket.id, selectedTicket.conversationId);
    } else {
      setTicketMessages([]);
      setConversationMessages([]);
      setTimelineMessages([]);
    }
  }, [loadTicketMessages, selectedTicket?.id, selectedTicket?.conversationId]);

  useEffect(() => {
    if (messagesContainerRef.current && timelineMessages.length > 0) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [timelineMessages]);

  const extractedEntities = useMemo(() => {
    const texts = [];
    for (const m of (Array.isArray(timelineMessages) ? timelineMessages : [])) {
      if (!m) continue;
      if (typeof m.text === 'string' && m.text.trim()) texts.push(m.text);
      const bodyText = m?.channel?.body?.text;
      if (typeof bodyText === 'string' && bodyText.trim()) texts.push(bodyText);
    }
    const blob = texts.join('\n');
    if (!blob) return { emails: [], cpfs: [], cnpjs: [], phones: [], urls: [] };

    const emails = Array.from(new Set((blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((s) => s.toLowerCase()))).slice(0, 10);
    const urls = Array.from(new Set((blob.match(/https?:\/\/[^\s)]+/gi) || []))).slice(0, 10);
    const cpfs = Array.from(new Set((blob.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || []).map((s) => s.replace(/\D/g, '')))).slice(0, 10);
    const cnpjs = Array.from(new Set((blob.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || []).map((s) => s.replace(/\D/g, '')))).slice(0, 10);
    const phones = Array.from(new Set((blob.match(/\b\+?55\s*\(?\d{2}\)?\s*\d{4,5}-?\d{4}\b/g) || []).map((s) => s.replace(/\s+/g, ' ').trim()))).slice(0, 10);

    return { emails, cpfs, cnpjs, phones, urls };
  }, [timelineMessages]);

  return {
    ticketMessages,
    conversationMessages,
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
    summarizeChannelMessage,
    safeGetBodyText,
  };
}
