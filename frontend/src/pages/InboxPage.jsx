import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getTicketShortLabel } from '../utils/ticketDisplay';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { listQueues, getTicketMessages } from '../api/tickets';
import { usePhoneMasking } from '../hooks/usePhoneMasking';
import { MaskedPhone } from '../components/MaskedPhone';
import {
  listInboxConversations,
  assignInboxConversation,
  transferInboxConversation,
  addInboxNote,
} from '../api/inbox';
import logger from '../utils/logger';

export function InboxPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { enabled: phoneMaskingEnabled } = usePhoneMasking();

  const storageKey = 'inboxFilters';

  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open');
  const [queueFilter, setQueueFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [slaMaxMinutes, setSlaMaxMinutes] = useState('');
  const [prioritizeSla, setPrioritizeSla] = useState(false);
  const [assignInput, setAssignInput] = useState('');
  const [transferQueue, setTransferQueue] = useState('');
  const [transferAssigned, setTransferAssigned] = useState('');
  const [noteText, setNoteText] = useState('');

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

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listInboxConversations({
        status: statusFilter === 'open' ? undefined : statusFilter,
        queue: queueFilter || undefined,
        assignedTo: assignedFilter || undefined,
        limit: 500,
        offset: 0,
      });
      const list = Array.isArray(data?.tickets) ? data.tickets : [];
      setTickets(list);
      if (selectedTicket) {
        const updated = list.find((t) => t.id === selectedTicket.id) || selectedTicket;
        setSelectedTicket(updated);
      }
    } catch (err) {
      logger.error('[Inbox] Erro ao carregar conversas', err);
      showToast('Erro ao carregar conversas do inbox', 'error');
    } finally {
      setLoading(false);
    }
  }, [assignedFilter, queueFilter, showToast, statusFilter]);

  const loadMessages = useCallback(async (ticketId) => {
    if (!ticketId) {
      setMessages([]);
      return;
    }
    try {
      const data = await getTicketMessages(ticketId);
      if (Array.isArray(data)) {
        setMessages(data);
      } else if (Array.isArray(data?.messages)) {
        setMessages(data.messages);
      } else {
        setMessages([]);
      }
    } catch (err) {
      logger.error('[Inbox] Erro ao carregar mensagens', err);
      // Não adicionar showToast em dependency - usar diretamente
      try {
        showToast('Erro ao carregar mensagens do ticket', 'error');
      } catch (toastErr) {
        console.error('Erro ao exibir toast:', toastErr);
      }
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadQueues();
      loadTickets();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadTickets();
    }
  }, [assignedFilter, authLoading, isAuthenticated, queueFilter, statusFilter]);

  useEffect(() => {
    if (selectedTicket?.id) {
      loadMessages(selectedTicket.id);
    } else {
      setMessages([]);
    }
  }, [loadMessages, selectedTicket]);

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

  const handleSelectTicket = (ticket) => {
    setSelectedTicket(ticket);
    setAssignInput('');
    setTransferQueue('');
    setTransferAssigned('');
    setNoteText('');
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

    if (channelFilter) {
      list = list.filter((t) => String(t.channelType || '').toLowerCase() === channelFilter);
    }

    if (slaMaxMinutes.trim()) {
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
  }, [channelFilter, getSlaMinutes, slaMaxMinutes, tagFilter, tickets]);

  const displayedTickets = useMemo(() => {
    if (!prioritizeSla) return filteredTickets;
    return [...filteredTickets].sort((a, b) => {
      const aExceeded = isSlaExceeded(a) ? 1 : 0;
      const bExceeded = isSlaExceeded(b) ? 1 : 0;
      if (aExceeded !== bExceeded) return bExceeded - aExceeded;
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [filteredTickets, prioritizeSla]);

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

  const handleTransfer = async () => {
    if (!selectedTicket) return;
    if (!transferQueue) {
      showToast('Informe a fila para transferir', 'warning');
      return;
    }
    try {
      const updated = await transferInboxConversation(selectedTicket.id, {
        queue: transferQueue,
        assignedTo: transferAssigned ? transferAssigned : null,
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
      const updated = await addInboxNote(selectedTicket.id, noteText);
      setSelectedTicket(updated);
      setNoteText('');
      await loadMessages(selectedTicket.id);
      showToast('Nota adicionada', 'success');
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao adicionar nota';
      showToast(message, 'error');
    }
  };

  const formatDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  };

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
    <div className="support-page">
      <div className="support-header">
        <h1>📥 Inbox</h1>
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
            </select>
          </label>
          <label>
            SLA máx (min)
            <input
              className="support-form-input"
              value={slaMaxMinutes}
              onChange={(e) => setSlaMaxMinutes(e.target.value)}
              placeholder="ex: 30"
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={prioritizeSla}
              onChange={(e) => setPrioritizeSla(e.target.checked)}
            />
            Priorizar SLA estourado
          </label>
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

      <div className="support-grid">
        <div className="support-tickets-panel">
          <div className="support-tickets-list" role="list">
            {displayedTickets.length === 0 && (
              <p className="support-tickets-empty">Nenhum ticket disponível</p>
            )}
            {displayedTickets.map((ticket) => (
              <div
                key={ticket.id}
                role="listitem"
                className={`support-ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                onClick={() => handleSelectTicket(ticket)}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectTicket(ticket)}
                tabIndex={0}
              >
                <div className="support-ticket-header">
                  <span className="support-ticket-id">#{getTicketShortLabel(ticket)}</span>
                  <span className={`support-ticket-status ${ticket.status || ''}`}>{ticket.status}</span>
                </div>
                <div className="support-ticket-message">
                  <strong>Fila:</strong> {ticket.queue || '-'}
                </div>
                {ticket.phoneNumber && (
                  <div className="support-ticket-message">
                    <strong>Telefone:</strong> <MaskedPhone phone={ticket.phoneNumber} mask={phoneMaskingEnabled} />
                  </div>
                )}
                <div className="support-ticket-message">
                  <strong>Atendente:</strong> {ticket.assignedTo || '—'}
                </div>
                {ticket.lastUserMessage && (
                  <div className="support-ticket-message">
                    <strong>Última:</strong> {ticket.lastUserMessage}
                  </div>
                )}
                {isSlaExceeded(ticket) && (
                  <div className="support-ticket-message" style={{ color: 'var(--color-status-error)', fontWeight: 600 }}>
                    SLA estourado
                  </div>
                )}
                <div className="support-ticket-meta">
                  <span>Criado: {formatDate(ticket.createdAt)}</span>
                  <span style={{ color: isSlaExceeded(ticket) ? 'var(--color-status-error)' : 'inherit' }}>
                    SLA: {formatSla(ticket)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="support-details-panel">
          {selectedTicket ? (
            <div className="support-details-content">
              <div className="support-details-header">
                <h3 className="support-details-title">Ticket #{getTicketShortLabel(selectedTicket)}</h3>
                <div style={{ color: 'var(--color-text-tertiary)' }}>
                  Status: {selectedTicket.status || '-'} · Fila: {selectedTicket.queue || '-'}
                </div>
              </div>

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
                  <input
                    className="support-form-input"
                    value={transferAssigned}
                    onChange={(e) => setTransferAssigned(e.target.value)}
                    placeholder="Atendente (opcional)"
                  />
                  <Button onClick={handleTransfer} className="support-button-full">Transferir</Button>
                </div>
              </div>

              <div className="support-details-section">
                <div className="support-form-group">
                  <label className="support-form-label">Notas internas</label>
                  <textarea
                    className="support-form-textarea"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Escreva uma nota interna"
                    rows={3}
                  />
                  <Button onClick={handleAddNote} className="support-button-full">Salvar nota</Button>
                </div>
              </div>

              <div className="support-details-section">
                <div className="support-details-subtitle">Mensagens</div>
                <div className="support-details-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {messages.length === 0 && (
                    <div style={{ color: 'var(--color-text-tertiary)' }}>Sem mensagens</div>
                  )}
                  {messages.map((msg) => (
                    <div key={msg.id || msg.timestamp} style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {msg.sender === 'note' ? `Nota • ${msg.authorName || agent?.username || 'system'}` : msg.sender}
                        {' · '}{formatDate(msg.timestamp)}
                      </div>
                      <div style={{ color: msg.sender === 'note' ? 'var(--color-status-warning)' : 'var(--color-text-primary)' }}>
                        {msg.text || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um ticket para visualizar detalhes.</p>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
