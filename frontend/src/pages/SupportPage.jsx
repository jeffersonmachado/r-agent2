import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listQueueTickets,
  assignTicket,
  closeTicket,
  sendTicketMessage,
} from '../api/tickets';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';

/**
 * Página de atendimento para gerenciar tickets e filas.
 * Estilo inspirado no WhatsApp.
 */
export function SupportPage() {
  const { showToast, ToastContainer } = useToast();
  const [queues, setQueues] = useState([]);
  const [selectedQueue, setSelectedQueue] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Usa useRef para manter referências estáveis
  const showToastRef = React.useRef(showToast);
  const loadQueuesRef = React.useRef();
  const loadTicketsRef = React.useRef();
  const selectedQueueRef = React.useRef(selectedQueue);

  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  React.useEffect(() => {
    selectedQueueRef.current = selectedQueue;
  }, [selectedQueue]);

  // Carrega filas disponíveis
  const loadQueues = useCallback(async () => {
    try {
      const queuesList = await listQueues();
      setQueues(queuesList);
      // Só seleciona a primeira fila se não houver nenhuma selecionada
      if (queuesList.length > 0 && !selectedQueueRef.current) {
        setSelectedQueue(queuesList[0]);
      }
    } catch (error) {
      logger.error('Erro ao carregar filas', error);
      showToastRef.current('Erro ao carregar filas', 'error');
    }
  }, []); // Sem dependências - usa refs

  // Atualiza ref quando loadQueues muda
  React.useEffect(() => {
    loadQueuesRef.current = loadQueues;
  }, [loadQueues]);

  // Carrega tickets da fila selecionada
  const loadTickets = useCallback(async () => {
    const queue = selectedQueueRef.current;
    if (!queue) return;

    setLoading(true);
    try {
      const ticketsList = await listQueueTickets(queue, { status: 'waiting' });
      setTickets(ticketsList);
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      showToastRef.current('Erro ao carregar tickets', 'error');
    } finally {
      setLoading(false);
    }
  }, []); // Sem dependências - usa ref

  // Atualiza ref quando loadTickets muda
  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  // Carrega dados iniciais - apenas uma vez no mount
  useEffect(() => {
    loadQueues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Apenas no mount inicial

  // Carrega tickets quando a fila muda
  useEffect(() => {
    if (selectedQueue) {
      loadTickets();
    }
  }, [selectedQueue, loadTickets]);

  // Auto-refresh a cada 5 segundos - usa refs para evitar recriação do intervalo
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Usa ref para evitar dependências que mudam constantemente
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh]); // Apenas autoRefresh como dependência

  // Atribui ticket para atendente
  const handleAssign = async () => {
    if (!selectedTicket || !assignedTo.trim()) {
      showToast('Informe o nome do atendente', 'warning');
      return;
    }

    try {
      await assignTicket(selectedTicket.id, assignedTo.trim());
      showToastRef.current('Ticket atribuído com sucesso', 'success');
      setSelectedTicket(null);
      setAssignedTo('');
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    } catch (error) {
      logger.error('Erro ao atribuir ticket', error);
      showToast('Erro ao atribuir ticket', 'error');
    }
  };

  // Fecha ticket
  const handleClose = async (ticketId) => {
    if (!confirm('Deseja realmente fechar este ticket?')) {
      return;
    }

    try {
      await closeTicket(ticketId);
      showToastRef.current('Ticket fechado com sucesso', 'success');
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket(null);
      }
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    } catch (error) {
      logger.error('Erro ao fechar ticket', error);
      showToast('Erro ao fechar ticket', 'error');
    }
  };

  // Envia mensagem do atendente
  const handleSendMessage = async () => {
    if (!selectedTicket || !messageText.trim()) {
      showToast('Digite uma mensagem', 'warning');
      return;
    }

    try {
      await sendTicketMessage(selectedTicket.id, messageText.trim());
      showToastRef.current('Mensagem enviada com sucesso', 'success');
      setMessageText('');
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
    } catch (error) {
      logger.error('Erro ao enviar mensagem', error);
      showToast('Erro ao enviar mensagem', 'error');
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

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>Atendimento - Sistema de Filas</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <NavigationLink to="/editor" className="btn-base">
              <span className="icon">📝</span>
              <span>Editor</span>
            </NavigationLink>
            <NavigationLink to="/maintenance" className="btn-base">
              <span className="icon">🔧</span>
              <span>Manutenção</span>
            </NavigationLink>
            <NavigationLink to="/config" className="btn-base">
              <span className="icon">⚙️</span>
              <span>Configuração</span>
            </NavigationLink>
          </div>
        </div>
        <div className="support-controls">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-atualizar (5s)</span>
          </label>
          <Button 
            onClick={() => {
              if (loadTicketsRef.current) {
                loadTicketsRef.current();
              }
            }} 
            disabled={loading}
          >
            {loading ? 'Carregando...' : 'Atualizar'}
          </Button>
        </div>
      </div>

      <div className="support-grid">
        {/* Painel de Filas */}
        <div className="support-queues-panel">
          <h2>Filas</h2>
          {queues.length === 0 ? (
            <p className="support-queues-empty">Nenhuma fila disponível</p>
          ) : (
            <div className="support-queues-list">
              {queues.map((queue) => (
                <button
                  key={queue}
                  onClick={() => setSelectedQueue(queue)}
                  className={`support-queue-button ${selectedQueue === queue ? 'active' : ''}`}
                >
                  {queue}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lista de Tickets */}
        <div className="support-tickets-panel">
          <h2>Tickets - {selectedQueue || 'Selecione uma fila'}</h2>
          {loading ? (
            <p>Carregando...</p>
          ) : tickets.length === 0 ? (
            <p className="support-tickets-empty">Nenhum ticket aguardando</p>
          ) : (
            <div className="support-tickets-list">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  onClick={() => setSelectedTicket(ticket)}
                  className={`support-ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                >
                  <div className="support-ticket-header">
                    <span className="support-ticket-id">#{ticket.id.slice(0, 12)}</span>
                    <span className={`support-ticket-status ${getStatusClass(ticket.status)}`}>
                      {ticket.status === 'waiting'
                        ? 'Aguardando'
                        : ticket.status === 'in_progress'
                          ? 'Em atendimento'
                          : 'Fechado'}
                    </span>
                  </div>
                  <div className="support-ticket-phone">
                    📞 {formatPhoneNumber(ticket.phoneNumber)}
                  </div>
                  {ticket.lastUserMessage && (
                    <div className="support-ticket-message">
                      <strong>Última mensagem:</strong> {ticket.lastUserMessage}
                    </div>
                  )}
                  <div className="support-ticket-meta">
                    Criado: {formatDate(ticket.createdAt)}
                  </div>
                  {ticket.assignedTo && (
                    <div className="support-ticket-assigned">
                      Atendente: {ticket.assignedTo}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel de Detalhes e Ações */}
        <div className="support-details-panel">
          {selectedTicket ? (
            <>
              <div>
                <h3 className="support-details-title">Ticket #{selectedTicket.id.slice(0, 12)}</h3>
                <div className="support-details-info">
                  <div>Fila: <strong>{selectedTicket.queue}</strong></div>
                  <div>Telefone: <strong>{formatPhoneNumber(selectedTicket.phoneNumber)}</strong></div>
                  <div>Status: <strong>{selectedTicket.status}</strong></div>
                  <div>Criado: {formatDate(selectedTicket.createdAt)}</div>
                </div>
              </div>

              {selectedTicket.status === 'waiting' && (
                <div className="support-form-group">
                  <label className="support-form-label">Atribuir para:</label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    placeholder="Nome do atendente"
                    className="support-form-input"
                  />
                  <Button onClick={handleAssign} className="support-button-full">
                    Atribuir Ticket
                  </Button>
                </div>
              )}

              {selectedTicket.status === 'in_progress' && (
                <div className="support-form-group">
                  <label className="support-form-label">Enviar mensagem:</label>
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    rows={4}
                    className="support-form-textarea"
                  />
                  <Button onClick={handleSendMessage} className="support-button-full">
                    Enviar Mensagem
                  </Button>
                </div>
              )}

              <Button
                onClick={() => handleClose(selectedTicket.id)}
                className="support-button-danger"
              >
                Fechar Ticket
              </Button>
            </>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um ticket para ver detalhes e ações</p>
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}
