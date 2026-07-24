import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from './Dialog';
import {
  listQueueTickets,
  assignTicket,
  closeTicket,
  sendTicketMessage,
  getTicketMessages,
  markTicketAsRead,
} from '../api/tickets';
import { useToast } from './Toast';
import { useConfirmDialog } from './ConfirmDialog';
import { Button } from '../styles/Button';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useWebSocketStatus } from '../utils/webSocketStatusConfig';
import { useLatestRef } from '../hooks/useLatestRef';
import { useModalDataLifecycle } from '../hooks/useModalDataLifecycle';
import { getAgentNameById } from '../api/auth';
import logger from '../utils/logger';

/**
 * Modal de fila com layout inspirado no WhatsApp
 * Lista de tickets à esquerda, área de mensagens/detalhes à direita
 */
export function QueueModal({ isOpen, onClose, queueName, queues }) {
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const showToastRef = useLatestRef(showToast);
  const loadTicketsRef = React.useRef();
  const selectedTicketRef = useLatestRef(selectedTicket);
  const loadTicketMessagesRef = React.useRef();

  // WebSocket para atualizações em tempo real
  const handleWebSocketEvent = useCallback((event, data) => {
    logger.debug('[QueueModal] Evento WebSocket recebido', event, data);
    
    switch (event) {
      case 'ticket.created':
        // Novo ticket criado na fila - recarrega lista
        if (loadTicketsRef.current) {
          loadTicketsRef.current();
        }
        break;
        
      case 'ticket.assigned':
        // Ticket atribuído - atualiza lista
        if (loadTicketsRef.current) {
          loadTicketsRef.current();
        }
        break;
        
      case 'ticket.updated':
        // Ticket atualizado - recarrega lista e mensagens se for o ticket selecionado
        if (loadTicketsRef.current) {
          loadTicketsRef.current();
        }
        if (selectedTicketRef.current?.id === data.ticketId) {
          if (loadTicketMessagesRef.current) {
            loadTicketMessagesRef.current(data.ticketId);
          }
        }
        break;
        
      case 'ticket.closed':
        // Ticket fechado - remove da lista se estiver selecionado
        if (selectedTicketRef.current?.id === data.ticketId) {
          setSelectedTicket(null);
        }
        if (loadTicketsRef.current) {
          loadTicketsRef.current();
        }
        break;
        
      case 'ticket.message.received':
      case 'ticket.message.sent':
        // Nova mensagem - atualiza mensagens se for o ticket selecionado
        if (selectedTicketRef.current?.id === data.ticketId) {
          if (loadTicketMessagesRef.current) {
            loadTicketMessagesRef.current(data.ticketId);
          }
        } else {
          // Atualiza contador de não lidas na lista
          if (loadTicketsRef.current) {
            loadTicketsRef.current();
          }
        }
        break;
        
      default:
        logger.debug('[QueueModal] Evento WebSocket não tratado', event);
    }
  }, []);

  const { connected: wsConnected, authenticated: wsAuthenticated, authFailed } = useWebSocketContext({
    enabled: isOpen && autoRefresh && !!queueName,
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

  const wsStatus = useWebSocketStatus({
    connected: wsConnected,
    authenticated: wsAuthenticated,
    authFailed,
  });

  const resolveAssignedToDisplay = useCallback(async (ticketList = []) => {
    const list = Array.isArray(ticketList) ? ticketList : [];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = Array.from(new Set(
      list
        .map((ticket) => String(ticket?.assignedTo || '').trim())
        .filter((value) => uuidRegex.test(value))
    ));

    const resolvedById = {};
    await Promise.all(ids.map(async (id) => {
      try {
        const resp = await getAgentNameById(id);
        const name = String(resp?.agent?.name || '').trim();
        resolvedById[id] = name || id;
      } catch {
        resolvedById[id] = id;
      }
    }));

    return list.map((ticket) => {
      const raw = String(ticket?.assignedTo || '').trim();
      return {
        ...ticket,
        assignedToDisplay: resolvedById[raw] || raw,
      };
    });
  }, []);

  // Carrega tickets da fila
  const loadTickets = useCallback(async () => {
    if (!queueName) return;

    setLoading(true);
    try {
      const ticketsList = await listQueueTickets(queueName, { status: 'waiting' });
      const ticketsWithDisplay = await resolveAssignedToDisplay(ticketsList);
      setTickets(ticketsWithDisplay);
      
      // Atualiza ticket selecionado se ainda existir na lista
      if (selectedTicketRef.current?.id) {
        const updatedTicket = ticketsWithDisplay.find(t => t.id === selectedTicketRef.current.id);
        if (updatedTicket) {
          setSelectedTicket(updatedTicket);
        }
      }
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      showToastRef.current('Erro ao carregar tickets', 'error');
    } finally {
      setLoading(false);
    }
  }, [queueName, resolveAssignedToDisplay]);

  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  // Carrega tickets quando o modal abre ou a fila muda
  useModalDataLifecycle({
    isOpen,
    canLoad: !!queueName,
    load: loadTickets,
  });

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
      const ticket = tickets.find(t => t.id === ticketId);
      if (ticket && ticket.status === 'in_progress' && ticket.unreadCount > 0) {
        await markTicketAsRead(ticketId);
        // Atualiza ticket local
        if (selectedTicketRef.current?.id === ticketId) {
          setSelectedTicket({ ...selectedTicketRef.current, unreadCount: 0 });
        }
      }
    } catch (error) {
      logger.error('Erro ao carregar mensagens', error);
    }
  }, [tickets]);

  React.useEffect(() => {
    loadTicketMessagesRef.current = loadTicketMessages;
  }, [loadTicketMessages]);

  // Carrega mensagens quando ticket é selecionado
  useModalDataLifecycle({
    isOpen: true,
    canLoad: !!selectedTicket,
    load: () => loadTicketMessages(selectedTicket.id),
    reset: () => setTicketMessages([]),
  });

  // Polling removido - apenas WebSocket é usado para atualizações em tempo real
  // Se o WebSocket não estiver conectado, as atualizações só ocorrerão quando:
  // 1. O modal for aberto e carregar dados iniciais
  // 2. O WebSocket se reconectar e enviar eventos
  // 3. O usuário clicar no botão "Atualizar" (se houver)
  useEffect(() => {
    if (!isOpen) return;
    
    logger.debug('[QueueModal] Modal aberto. Atualizações via WebSocket apenas.', {
      wsConnected,
      wsAuthenticated,
      autoRefresh,
    });
  }, [isOpen, wsConnected, wsAuthenticated, autoRefresh]);

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

  if (!isOpen) return null;

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={`Fila: ${queueName || 'N/A'}`}
        size="full"
        resizable={true}
        draggable={true}
        dynamicSize={{ width: 1200, isCollapsed: false }}
      >
        <div className="queue-modal-container">
          {/* Controles superiores */}
          <div className="queue-modal-controls">
            {wsStatus.phase === 'ready' ? (
              <div className="flex items-center gap-2">
                <span 
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#25D366'
                  }}
                  title={wsStatus.title}
                />
                <span style={{ fontSize: '14px', color: '#666' }}>
                  Atualização em tempo real
                </span>
              </div>
            ) : (
              <label className="queue-modal-checkbox">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                <span>Auto-atualizar (5s)</span>
              </label>
            )}
            <Button 
              onClick={() => {
                if (loadTicketsRef.current) {
                  loadTicketsRef.current();
                }
              }} 
              disabled={loading}
              style={{ fontSize: '0.9em', padding: '6px 12px' }}
            >
              {loading ? 'Carregando...' : 'Atualizar'}
            </Button>
          </div>

          {/* Layout WhatsApp: Lista de tickets à esquerda, área de mensagens à direita */}
          <div className="queue-modal-layout">
            {/* Painel esquerdo - Lista de Tickets */}
            <div className="queue-modal-tickets-list">
              <div className="queue-modal-tickets-header">
                <h3>Tickets ({tickets.length})</h3>
              </div>
              <div className="queue-modal-tickets-content">
                {loading ? (
                  <div className="queue-modal-loading">Carregando...</div>
                ) : tickets.length === 0 ? (
                  <div className="queue-modal-empty">Nenhum ticket aguardando</div>
                ) : (
                  tickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      onClick={() => setSelectedTicket(ticket)}
                      className={`queue-modal-ticket-item ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                    >
                      <div className="queue-modal-ticket-item-header">
                        <span className="queue-modal-ticket-item-id">#{ticket.id}</span>
                        {ticket.unreadCount > 0 && (
                          <span className="queue-modal-ticket-item-badge">{ticket.unreadCount}</span>
                        )}
                      </div>
                      <div className="queue-modal-ticket-item-phone">
                        📞 {formatPhoneNumber(ticket.phoneNumber)}
                      </div>
                      {ticket.lastUserMessage && (
                        <div className="queue-modal-ticket-item-message">
                          {ticket.lastUserMessage.length > 50 
                            ? ticket.lastUserMessage.substring(0, 50) + '...'
                            : ticket.lastUserMessage}
                        </div>
                      )}
                      <div className="queue-modal-ticket-item-time">
                        {new Date(ticket.createdAt).toLocaleTimeString('pt-BR', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </div>
                      {ticket.assignedTo && (
                        <div className="queue-modal-ticket-item-assigned">
                          👤 {ticket.assignedToDisplay || ticket.assignedTo}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Painel direito - Detalhes e Mensagens */}
            <div className="queue-modal-chat-area">
              {selectedTicket ? (
                <>
                  {/* Cabeçalho do chat */}
                  <div className="queue-modal-chat-header">
                    <div className="queue-modal-chat-header-info">
                      <div className="queue-modal-chat-header-title">
                        Ticket #{selectedTicket.id}
                        {selectedTicket.unreadCount > 0 && (
                          <span className="queue-modal-chat-header-badge">
                            {selectedTicket.unreadCount} nova(s)
                          </span>
                        )}
                      </div>
                      <div className="queue-modal-chat-header-subtitle">
                        {formatPhoneNumber(selectedTicket.phoneNumber)} • {selectedTicket.queue}
                      </div>
                    </div>
                    <div className="queue-modal-chat-header-status">
                      <span className={`queue-modal-status ${getStatusClass(selectedTicket.status)}`}>
                        {selectedTicket.status === 'waiting'
                          ? 'Aguardando'
                          : selectedTicket.status === 'in_progress'
                            ? 'Em atendimento'
                            : 'Fechado'}
                      </span>
                    </div>
                  </div>

                  {/* Área de mensagens */}
                  {selectedTicket.status === 'in_progress' && (
                    <div className="queue-modal-messages-area">
                      <div className="queue-modal-messages-list">
                        {ticketMessages.length === 0 ? (
                          <div className="queue-modal-messages-empty">
                            Nenhuma mensagem ainda
                          </div>
                        ) : (
                          ticketMessages.map((msg) => (
                            <div
                              key={msg.id}
                              className={`queue-modal-message ${msg.sender === 'user' ? 'sent' : 'received'}`}
                            >
                              <div className="queue-modal-message-content">
                                {msg.text}
                              </div>
                              <div className="queue-modal-message-time">
                                {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Área de ações */}
                  <div className="queue-modal-actions-area">
                    {selectedTicket.status === 'waiting' && (
                      <div className="queue-modal-assign-form">
                        <input
                          type="text"
                          value={assignedTo}
                          onChange={(e) => setAssignedTo(e.target.value)}
                          placeholder="Nome do atendente"
                          className="queue-modal-input"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleAssign();
                            }
                          }}
                        />
                        <Button onClick={handleAssign} className="queue-modal-button-primary">
                          Atribuir Ticket
                        </Button>
                      </div>
                    )}

                    {selectedTicket.status === 'in_progress' && (
                      <div className="queue-modal-message-form">
                        <textarea
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          placeholder="Digite sua mensagem..."
                          rows={3}
                          className="queue-modal-textarea"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />
                        <Button onClick={handleSendMessage} className="queue-modal-button-primary">
                          Enviar
                        </Button>
                      </div>
                    )}

                    <Button
                      onClick={() => handleClose(selectedTicket.id)}
                      className="queue-modal-button-danger"
                    >
                      Fechar Ticket
                    </Button>
                  </div>
                </>
              ) : (
                <div className="queue-modal-chat-empty">
                  <div className="queue-modal-chat-empty-icon">💬</div>
                  <div className="queue-modal-chat-empty-text">
                    Selecione um ticket para ver detalhes e mensagens
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Dialog>
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
}

