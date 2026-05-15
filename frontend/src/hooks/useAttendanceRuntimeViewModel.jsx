import { useMemo } from 'react';
import {
  buildSupportAuditSummary,
  buildSupportEventSummary,
  formatSupportAuditAction,
  formatSupportEventType,
  formatSupportReason,
} from '../components/support/supportHumanization';
import { resolveContactName } from '../utils/contactName';

function normalizeMode(mode) {
  const value = String(mode || 'bot').toLowerCase();
  if (value === 'human') return 'Humano';
  if (value === 'paused') return 'Híbrido';
  return 'Bot';
}

function formatQueueName(queue) {
  const raw = String(queue || '').trim();
  if (!raw || raw.toLowerCase() === 'default') return 'Padrão';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return phone || '-';
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const num = digits.slice(4);
    const part1 = num.length === 9 ? num.slice(0, 5) : num.slice(0, 4);
    const part2 = num.slice(-4);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return phone;
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
  if (!text) return { intent: '-', confidence: '-', nextBestAction: '-' };

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const intentLine = lines.find((l) => /inten[çc][ãa]o/i.test(l));
  let intent = '-';
  if (intentLine) {
    const afterColon = intentLine.split(':').slice(1).join(':').trim();
    if (afterColon) intent = afterColon.slice(0, 80);
  }

  const nextLine = lines.find((l) => /pr[oó]xim|suger|recomend/i.test(l));
  let nextBestAction = '-';
  if (nextLine) {
    const afterColon = nextLine.split(':').slice(1).join(':').trim();
    if (afterColon) nextBestAction = afterColon.slice(0, 120);
  }

  return { intent, confidence: '-', nextBestAction };
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
        contact: resolveContactName(selectedTicket) || formatPhone(selectedTicket.phoneNumber) || '-',
        channel: selectedTicket.channelType || 'whatsapp',
        queue: formatQueueName(selectedTicket.queue),
        status: selectedTicket.status || '-',
        reason: formatSupportReason(selectedReason) || selectedReason || '-',
      } : null,
      customer: {
        name: resolveContactName(selectedTicket) || 'Não identificado',
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
        stage: selectedTicket?.context?.metadata?.journeyStage || 'Qualificação',
        nextStage: selectedTicket?.context?.metadata?.nextJourneyStage || 'Fechamento',
      },
      execution: {
        mode: normalizeMode(selectedTicket?.mode),
        flow: selectedTicket?.context?.metadata?.flowName || 'Fluxo padrão RAP',
        step: selectedTicket?.context?.metadata?.flowStep || 'Coleta de contexto',
      },
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        hash: ticket.conversationId || ticket.id,
        status: ticket.status,
        time: ticket.updatedAt || ticket.createdAt,
        owner: ticket.assignedTo || 'Sem responsável',
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
