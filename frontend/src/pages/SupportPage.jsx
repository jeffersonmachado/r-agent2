import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listQueueTickets,
  assignTicket,
  closeTicket,
  sendTicketMessage,
  getTicketMessages,
  markTicketAsRead,
} from '../api/tickets';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import { QueueModal } from '../components/QueueModal';
import { TicketModal } from '../components/TicketModal';
import logger from '../utils/logger';

/**
 * Página de atendimento para gerenciar tickets e filas.
 * Estilo inspirado no WhatsApp.
 */
export function SupportPage() {
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [queues, setQueues] = useState([]);
  const [selectedQueue, setSelectedQueue] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [modalQueue, setModalQueue] = useState(null);
  const [modalTicket, setModalTicket] = useState(null);

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
      
      // Verifica se o ticket selecionado ainda existe na nova lista
      // Se não existir mais, limpa a seleção e as mensagens
      setSelectedTicket(prevSelected => {
        if (!prevSelected) return null;
        const updatedTicket = ticketsList.find(t => t.id === prevSelected.id);
        // Se não encontrou na lista, o ticket foi removido ou mudou de status
        if (!updatedTicket) {
          setTicketMessages([]);
          return null;
        }
        // Atualiza com os dados mais recentes do ticket
        return updatedTicket;
      });
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      showToastRef.current('Erro ao carregar tickets', 'error');
    } finally {
      setLoading(false);
    }
  }, []); // Sem dependências - usa refs e state setters funcionais

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

  // Carrega mensagens do ticket selecionado
  const loadTicketMessages = useCallback(async (ticketId) => {
    if (!ticketId) {
      setTicketMessages([]);
      return;
    }

    try {
      const result = await getTicketMessages(ticketId);
      setTicketMessages(result.messages || []);
      
      // Marca como lidas se ticket está atribuído e em progresso
      setTickets(prevTickets => {
        const ticket = prevTickets.find(t => t.id === ticketId);
        if (ticket && ticket.status === 'in_progress' && ticket.unreadCount > 0) {
          markTicketAsRead(ticketId).catch(err => {
            logger.error('Erro ao marcar ticket como lido', err);
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

  // Carrega mensagens quando ticket é selecionado
  useEffect(() => {
    if (selectedTicket) {
      loadTicketMessages(selectedTicket.id);
    } else {
      setTicketMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicket?.id]); // Apenas quando o ID do ticket muda

  // Auto-refresh a cada 5 segundos - usa refs para evitar recriação do intervalo
  const selectedTicketIdRef = React.useRef(null);
  
  React.useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?.id || null;
  }, [selectedTicket?.id]);

  const loadTicketMessagesRef = React.useRef();
  React.useEffect(() => {
    loadTicketMessagesRef.current = loadTicketMessages;
  }, [loadTicketMessages]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Usa ref para evitar dependências que mudam constantemente
      if (loadTicketsRef.current) {
        loadTicketsRef.current();
      }
      
      // Atualiza mensagens do ticket selecionado
      const ticketId = selectedTicketIdRef.current;
      if (ticketId && loadTicketMessagesRef.current) {
        loadTicketMessagesRef.current(ticketId);
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
    const confirmed = await confirm({
      title: 'Fechar Ticket',
      message: 'Deseja realmente fechar este ticket?',
      confirmLabel: 'Fechar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });

    if (!confirmed) {
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
      
      // Recarrega mensagens para mostrar a nova mensagem
      await loadTicketMessages(selectedTicket.id);
      
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
                  onClick={() => {
                    setSelectedQueue(queue);
                    setModalQueue(queue);
                  }}
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
                  onClick={() => {
                    setSelectedTicket(ticket);
                    setModalTicket(ticket);
                  }}
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
                  {ticket.unreadCount > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '10px',
                      right: '10px',
                      background: '#e74c3c',
                      color: 'white',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {ticket.unreadCount}
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
              <div style={{ flexShrink: 0 }}>
                <h3 className="support-details-title">
                  Ticket #{selectedTicket.id.slice(0, 12)}
                  {selectedTicket.unreadCount > 0 && (
                    <span style={{
                      marginLeft: '10px',
                      background: '#e74c3c',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'normal'
                    }}>
                      {selectedTicket.unreadCount} nova(s)
                    </span>
                  )}
                </h3>
                <div className="support-details-info">
                  <div>Fila: <strong>{selectedTicket.queue}</strong></div>
                  <div>Telefone: <strong>{formatPhoneNumber(selectedTicket.phoneNumber)}</strong></div>
                  <div>Status: <strong>{selectedTicket.status}</strong></div>
                  <div>Criado: {formatDate(selectedTicket.createdAt)}</div>
                </div>
              </div>

              {/* Histórico de Mensagens */}
              {selectedTicket.status === 'in_progress' && (
                <div style={{
                  marginTop: '20px',
                  marginBottom: '20px',
                  borderTop: '1px solid #ddd',
                  paddingTop: '20px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0
                }}>
                  <h4 style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>
                    Histórico de Mensagens
                  </h4>
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '10px',
                    backgroundColor: '#f9f9f9',
                    minHeight: 0
                  }}>
                    {ticketMessages.length === 0 ? (
                      <p style={{ color: '#999', fontSize: '12px', textAlign: 'center' }}>
                        Nenhuma mensagem ainda
                      </p>
                    ) : (
                      ticketMessages.map((msg) => (
                        <div
                          key={msg.id}
                          style={{
                            marginBottom: '12px',
                            padding: '8px',
                            borderRadius: '8px',
                            backgroundColor: msg.sender === 'user' ? '#dcf8c6' : '#ffffff',
                            border: msg.sender === 'user' ? 'none' : '1px solid #ddd',
                            textAlign: msg.sender === 'user' ? 'right' : 'left',
                          }}
                        >
                          <div style={{
                            fontSize: '12px',
                            color: '#666',
                            marginBottom: '4px'
                          }}>
                            {msg.sender === 'user' ? '👤 Usuário' : msg.sender === 'agent' ? '👨‍💼 Atendente' : '🤖 Sistema'}
                            {' • '}
                            {formatDate(msg.timestamp)}
                          </div>
                          <div style={{ fontSize: '14px', wordBreak: 'break-word' }}>
                            {msg.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
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
              </div>
            </>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um ticket para ver detalhes e ações</p>
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
      <ConfirmDialog />
      <QueueModal
        isOpen={modalQueue !== null}
        onClose={() => setModalQueue(null)}
        queueName={modalQueue}
        queues={queues}
      />
      <TicketModal
        isOpen={modalTicket !== null}
        onClose={() => setModalTicket(null)}
        ticket={modalTicket}
        onTicketUpdate={(updatedTicket) => {
          // Se updatedTicket é null, remove o ticket da lista
          if (!updatedTicket) {
            if (modalTicket) {
              const ticketIdToRemove = modalTicket.id;
              setTickets(prevTickets => prevTickets.filter(t => t.id !== ticketIdToRemove));
              // Limpa seleção se for o mesmo ticket
              if (selectedTicket?.id === ticketIdToRemove) {
                setSelectedTicket(null);
                setTicketMessages([]);
              }
              // Fecha o modal
              setModalTicket(null);
            }
            return;
          }
          
          // Atualiza ticket na lista local
          setTickets(prevTickets => 
            prevTickets.map(t => t.id === updatedTicket.id ? updatedTicket : t)
          );
          // Atualiza ticket selecionado se for o mesmo
          if (selectedTicket?.id === updatedTicket.id) {
            setSelectedTicket(updatedTicket);
          }
          // Atualiza ticket no modal
          setModalTicket(updatedTicket);
        }}
      />
    </div>
  );
}
