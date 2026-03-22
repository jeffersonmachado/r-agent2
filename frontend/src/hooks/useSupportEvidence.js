import { useCallback, useEffect, useMemo, useState } from 'react';
import { contextualSearchEvidence } from '../api/evidence';
import logger from '../utils/logger';

async function copyToClipboard(text) {
  const content = String(text || '').trim();
  if (!content) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {}
  return false;
}

function formatEvidenceLabel(value) {
  if (!value) return 'n/a';
  return String(value).replace(/_/g, ' ');
}

function buildEvidenceSuggestedReply(evidence, formatDate) {
  if (!evidence) return '';
  const occurredAt = evidence.occurred_at ? formatDate(evidence.occurred_at) : 'data anterior';
  const sourceLabel = formatEvidenceLabel(evidence.source_type || evidence.sourceType || 'origem anterior');
  if ((evidence.confidence || 0) < 0.72 || evidence.strength === 'weak') {
    return `Encontramos um indício anterior em ${occurredAt}, através de ${sourceLabel}. Posso conferir o contexto completo antes de responder de forma definitiva.\n\nTrecho de apoio: ${evidence.excerpt || evidence.summary || ''}`.trim();
  }
  return `Identificamos que essa informação já foi comunicada anteriormente em ${occurredAt}, através de ${sourceLabel}. Posso reenviar o trecho ou documento relacionado.\n\nTrecho de apoio: ${evidence.excerpt || evidence.summary || ''}`.trim();
}

export function useSupportEvidence({
  selectedTicket,
  tickets,
  setSelectedTicket,
  setMessageText,
  showToast,
  formatDate,
}) {
  const [history, setHistory] = useState({ identity: null, evidence: null, timeline: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedTicket?.id) {
      setHistory({ identity: null, evidence: null, timeline: [] });
      return;
    }

    const context = {
      ticketId: selectedTicket.id,
      conversationId: selectedTicket.conversationId || null,
      phone: selectedTicket.phoneNumber || null,
    };

    setLoading(true);
    contextualSearchEvidence({
      context,
      query: selectedTicket.lastUserMessage || '',
      options: { limit: 5, includeWeak: false, includeTimeline: true, persistFallback: true },
    })
      .then((searchResp) => {
        setHistory({
          identity: searchResp?.identity || null,
          timeline: searchResp?.timeline || [],
          evidence: searchResp?.ok ? searchResp : null,
        });
      })
      .catch((error) => {
        logger.error('Erro ao carregar Evidence Engine', error);
        setHistory({ identity: null, evidence: null, timeline: [] });
      })
      .finally(() => setLoading(false));
  }, [selectedTicket?.id, selectedTicket?.conversationId, selectedTicket?.phoneNumber, selectedTicket?.lastUserMessage]);

  const suggestedReply = useMemo(() => (
    history.evidence?.best ? buildEvidenceSuggestedReply(history.evidence.best, formatDate) : ''
  ), [history.evidence?.best, formatDate]);

  const handleCopyEvidence = useCallback(async (evidence) => {
    const text = [
      evidence?.summary || '',
      evidence?.excerpt || '',
      evidence?.source_ref?.ticketId ? `ticket=${evidence.source_ref.ticketId}` : '',
      evidence?.source_ref?.conversationId ? `conversation=${evidence.source_ref.conversationId}` : '',
    ].filter(Boolean).join('\n');
    const copied = await copyToClipboard(text);
    showToast(copied ? 'Evidência copiada' : 'Não foi possível copiar a evidência', copied ? 'success' : 'error');
  }, [showToast]);

  const handleUseEvidenceAsReply = useCallback((evidence) => {
    const suggestion = buildEvidenceSuggestedReply(evidence, formatDate);
    setMessageText((prev) => {
      if (!prev) return suggestion;
      if (prev.includes(suggestion)) return prev;
      return `${prev}\n\n${suggestion}`.trim();
    });
    showToast('Sugestão adicionada ao composer', 'success');
  }, [formatDate, setMessageText, showToast]);

  const handleOpenEvidenceSource = useCallback((evidence) => {
    const origin = evidence?.origin_locator || null;
    const ticketId = origin?.ticketId || evidence?.source_ref?.ticketId || evidence?.ticketId || null;
    if (ticketId) {
      const ticket = tickets.find((item) => item.id === ticketId);
      if (ticket) {
        setSelectedTicket(ticket);
        showToast(origin?.canOpenDirectly ? 'Origem aberta diretamente no ticket relacionado' : 'Origem aberta no melhor contexto disponível', 'info');
        return;
      }
    }

    const conversationId = origin?.conversationId || evidence?.source_ref?.conversationId || evidence?.conversationId || null;
    if (conversationId) {
      if (selectedTicket?.conversationId === conversationId) {
        showToast(origin?.channelMessageId ? `Origem localizada na conversa atual (${origin.channelMessageId})` : 'Origem localizada na conversa atual', 'info');
        return;
      }
      const relatedTicket = tickets.find((item) => item.conversationId === conversationId);
      if (relatedTicket) {
        setSelectedTicket(relatedTicket);
        showToast(origin?.canOpenDirectly ? 'Origem aberta pela conversa relacionada' : 'Origem aberta no contexto mais próximo da conversa', 'info');
        return;
      }
    }

    const sourceText = [
      origin?.sourceType ? `source_type=${origin.sourceType}` : '',
      origin?.sourceId ? `source_id=${origin.sourceId}` : '',
      ticketId ? `ticket=${ticketId}` : '',
      conversationId ? `conversation=${conversationId}` : '',
      origin?.locator ? `locator=${origin.locator}` : '',
    ].filter(Boolean).join('\n');
    copyToClipboard(sourceText);
    showToast('Origem copiada com o melhor locator disponível', 'info');
  }, [selectedTicket?.conversationId, setSelectedTicket, showToast, tickets]);

  const handleOpenTimelineItem = useCallback((item) => {
    if (!item) return;
    handleOpenEvidenceSource({
      source_type: item.sourceType || item.source,
      source_id: item.id,
      source_ref: {
        ticketId: item.ticketId || null,
        conversationId: item.conversationId || null,
        source: item.source || null,
      },
      ticketId: item.ticketId || null,
      conversationId: item.conversationId || null,
    });
  }, [handleOpenEvidenceSource]);

  return {
    evidenceHistory: history,
    evidenceLoading: loading,
    suggestedReply,
    handleCopyEvidence,
    handleUseEvidenceAsReply,
    handleOpenEvidenceSource,
    handleOpenTimelineItem,
  };
}
