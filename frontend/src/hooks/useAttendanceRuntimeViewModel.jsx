import { useMemo } from 'react';
import {
  buildSupportAuditSummary,
  buildSupportEventSummary,
  formatSupportAuditAction,
  formatSupportEventType,
} from '../components/support/supportHumanization';

function normalizeMode(mode) {
  const value = String(mode || 'bot').toLowerCase();
  if (value === 'human') return 'Humano';
  if (value === 'paused') return 'Hibrido';
  return 'Bot';
}

function extractTicketReason(ticket) {
  return (
    ticket?.pauseReason
    || ticket?.context?.closeReasonName
    || ticket?.reason
    || ticket?.context?.reason
    || 'agendamento'
  );
}

function parseAiSummary(summaryText) {
  const text = String(summaryText || '').trim();
  if (!text) return { intent: 'agendamento', confidence: '0.72', nextBestAction: 'Confirmar horario preferencial do contato' };

  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);
  return {
    intent: firstLine ? firstLine.slice(0, 64) : 'agendamento',
    confidence: '0.78',
    nextBestAction: 'Confirmar dados e avancar para proposta de horario',
  };
}

export function useAttendanceRuntimeViewModel({
  state,
  ticketContext,
  evidence,
}) {
  return useMemo(() => {
    const tickets = Array.isArray(state?.ticketsView) ? state.ticketsView : [];
    const selectedTicket = state?.selectedTicket || null;
    const selectedReason = extractTicketReason(selectedTicket);

    const metrics = {
      inbox: {
        Todos: tickets.length,
        Hoje: tickets.filter((ticket) => {
          const dt = new Date(ticket?.createdAt || ticket?.updatedAt || Date.now());
          const now = new Date();
          return dt.toDateString() === now.toDateString();
        }).length,
        Prioridade: tickets.filter((ticket) => String(ticket?.priority || '').toLowerCase() === 'high').length,
        'Sem resposta': tickets.filter((ticket) => Number(ticket?.unreadCount || 0) > 0).length,
        Pendente: tickets.filter((ticket) => String(ticket?.status || '').toLowerCase() === 'waiting').length,
        Fechado: 0,
      },
      status: {
        Novos: tickets.filter((ticket) => String(ticket?.status || '').toLowerCase() === 'waiting').length,
        Aberto: tickets.filter((ticket) => String(ticket?.status || '').toLowerCase() === 'in_progress').length,
        Prioridade: tickets.filter((ticket) => String(ticket?.priority || '').toLowerCase() === 'high').length,
        Resolvido: tickets.filter((ticket) => String(ticket?.status || '').toLowerCase() === 'resolved').length,
        Fechado: tickets.filter((ticket) => String(ticket?.status || '').toLowerCase() === 'closed').length,
      },
      categories: {
        Agendamento: tickets.filter((ticket) => /agenda/i.test(extractTicketReason(ticket))).length,
        Pilates: tickets.filter((ticket) => /pilates/i.test(extractTicketReason(ticket))).length,
        'Bale': tickets.filter((ticket) => /bale/i.test(extractTicketReason(ticket))).length,
        Treino: tickets.filter((ticket) => /treino/i.test(extractTicketReason(ticket))).length,
      },
    };

    const aiFromSummary = parseAiSummary(ticketContext?.aiSummary?.text || ticketContext?.aiSummary || '');

    const runtimeTimeline = [];
    const events = Array.isArray(ticketContext?.ticketEvents) ? ticketContext.ticketEvents : [];
    const audit = Array.isArray(ticketContext?.ticketAuditLogs) ? ticketContext.ticketAuditLogs : [];

    events.slice(0, 10).forEach((item, index) => {
      const summary = buildSupportEventSummary(item);
      runtimeTimeline.push({
        id: `event-${item?.id || index}`,
        type: formatSupportEventType(item?.type || 'evento'),
        timestamp: item?.createdAt || item?.timestamp || new Date().toISOString(),
        description: summary.summary || String(item?.summary || item?.type || 'Evento operacional do ticket.'),
      });
    });

    audit.slice(0, 8).forEach((item, index) => {
      const summary = buildSupportAuditSummary(item);
      runtimeTimeline.push({
        id: `audit-${index}`,
        type: formatSupportAuditAction(item?.action || 'auditoria'),
        timestamp: item?.timestamp || item?.createdAt || new Date().toISOString(),
        description: summary.summary || String(item?.summary || item?.action || 'Atualizacao de auditoria do ticket.'),
      });
    });

    const timeline = runtimeTimeline;

    const selectedIndex = selectedTicket
      ? Math.max(tickets.findIndex((ticket) => ticket.id === selectedTicket.id), 0) + 1
      : 0;

    return {
      metrics,
      selectedTicket: selectedTicket ? {
        id: selectedTicket.id,
        date: selectedTicket.createdAt,
        contact: selectedTicket.contactName || selectedTicket.phoneNumber || '-',
        channel: selectedTicket.channelType || 'whatsapp',
        queue: selectedTicket.queue || 'default',
        status: selectedTicket.status || '-',
        reason: selectedReason,
      } : null,
      customer: {
        name: selectedTicket?.contactName || 'Nao identificado',
        socialName: selectedTicket?.context?.metadata?.socialName || '-',
        document: selectedTicket?.context?.metadata?.document || '-',
      },
      ai: {
        intent: aiFromSummary.intent,
        confidence: aiFromSummary.confidence,
        nextBestAction: aiFromSummary.nextBestAction,
      },
      journey: {
        name: selectedTicket?.context?.metadata?.journeyName || 'Jornada de atendimento',
        stage: selectedTicket?.context?.metadata?.journeyStage || 'Qualificacao',
        nextStage: selectedTicket?.context?.metadata?.nextJourneyStage || 'Fechamento',
      },
      execution: {
        mode: normalizeMode(selectedTicket?.mode),
        flow: selectedTicket?.context?.metadata?.flowName || 'Fluxo padrao RAP',
        step: selectedTicket?.context?.metadata?.flowStep || 'Coleta de contexto',
      },
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        hash: ticket.conversationId || ticket.id,
        status: ticket.status,
        time: ticket.updatedAt || ticket.createdAt,
        owner: ticket.assignedTo || 'Sem responsavel',
        queue: ticket.queue || 'default',
        badge: normalizeMode(ticket.mode),
      })),
      messages: Array.isArray(ticketContext?.timelineMessages) ? ticketContext.timelineMessages : [],
      timeline,
      paginationLabel: selectedIndex > 0 ? `${selectedIndex} de ${Math.max(tickets.length, selectedIndex)}` : `0 de ${tickets.length}`,
      evidence,
    };
  }, [state, ticketContext, evidence]);
}
