import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from './Dialog';
import {
  assignTicket,
  closeTicket,
  sendTicketMessage,
  getTicketMessages,
  markTicketAsRead,
} from '../api/tickets';
import { useToast } from './Toast';
import { useConfirmDialog } from './ConfirmDialog';
import { Button } from '../styles/Button';
import { useTheme } from '../styles/themeContext';
import { useWebSocket } from '../hooks/useWebSocket';
import logger from '../utils/logger';

/**
 * Modal de ticket inspirado no WhatsApp
 * Exibe conversa completa do ticket com suporte a tema claro/escuro
 */
export function TicketModal({ isOpen, onClose, ticket, onTicketUpdate }) {
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { theme, themeName } = useTheme();
  const [ticketMessages, setTicketMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [currentTicket, setCurrentTicket] = useState(ticket);

  const showToastRef = React.useRef(showToast);
  const loadMessagesRef = React.useRef();
  const currentTicketRef = React.useRef(currentTicket);

  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  React.useEffect(() => {
    currentTicketRef.current = currentTicket;
  }, [currentTicket]);

  // WebSocket para atualizações em tempo real
  const handleWebSocketEvent = useCallback((event, data) => {
    // Só processa eventos do ticket atual
    if (!currentTicketRef.current || data.ticketId !== currentTicketRef.current.id) {
      return;
    }

    logger.debug('[TicketModal] Evento WebSocket recebido', event, data);

    switch (event) {
      case 'ticket.message.received':
      case 'ticket.message.sent':
        // Nova mensagem - recarrega mensagens
        if (loadMessagesRef.current && currentTicketRef.current?.id) {
          loadMessagesRef.current(currentTicketRef.current.id);
        }
        break;

      case 'ticket.updated':
        // Ticket atualizado - recarrega mensagens e atualiza ticket
        if (loadMessagesRef.current && currentTicketRef.current?.id) {
          loadMessagesRef.current(currentTicketRef.current.id);
        }
        // Atualiza ticket local se houver dados
        if (data.status || data.assignedTo) {
          setCurrentTicket(prev => prev ? { ...prev, ...data } : null);
          if (onTicketUpdate) {
            onTicketUpdate({ ...currentTicketRef.current, ...data });
          }
        }
        break;

      case 'ticket.closed':
        // Ticket fechado - atualiza estado
        setCurrentTicket(prev => prev ? { ...prev, status: 'closed' } : null);
        if (onTicketUpdate) {
          onTicketUpdate({ ...currentTicketRef.current, status: 'closed' });
        }
        showToastRef.current('Ticket fechado', 'info', 2000);
        break;

      default:
        logger.debug('[TicketModal] Evento WebSocket não tratado', event);
    }
  }, [onTicketUpdate]);

  const { connected: wsConnected, authenticated: wsAuthenticated } = useWebSocket({
    enabled: isOpen && autoRefresh && !!currentTicket?.id,
    onEvent: handleWebSocketEvent,
    subscribeEvents: [
      'ticket.message.received',
      'ticket.message.sent',
      'ticket.updated',
      'ticket.closed',
    ],
  });

  // Atualiza ticket quando prop muda
  useEffect(() => {
    if (ticket) {
      setCurrentTicket(ticket);
    }
  }, [ticket]);

  // Carrega mensagens do ticket
  const loadTicketMessages = useCallback(async (ticketId) => {
    if (!ticketId) {
      setTicketMessages([]);
      return;
    }

    try {
      const result = await getTicketMessages(ticketId);
      setTicketMessages(result.messages || []);
      
      // Marca como lidas se ticket está atribuído e em progresso
      if (currentTicketRef.current && currentTicketRef.current.status === 'in_progress' && currentTicketRef.current.unreadCount > 0) {
        await markTicketAsRead(ticketId);
        // Atualiza ticket local
        setCurrentTicket(prev => prev ? { ...prev, unreadCount: 0 } : null);
        // Notifica componente pai
        if (onTicketUpdate) {
          onTicketUpdate({ ...currentTicketRef.current, unreadCount: 0 });
        }
      }
    } catch (error) {
      // Se for 404, o ticket não existe mais - fecha o modal silenciosamente
      if (error.status === 404 || (error.body && error.body.error === 'ticket_not_found')) {
        // Notifica componente pai para remover o ticket da lista
        if (onTicketUpdate && currentTicketRef.current) {
          // Passa null para indicar que o ticket deve ser removido
          onTicketUpdate(null);
        }
        if (onClose) {
          onClose();
        }
        return;
      }
      // Para outros erros, loga normalmente
      logger.error('Erro ao carregar mensagens', error);
    }
  }, [onTicketUpdate, onClose]);

  React.useEffect(() => {
    loadMessagesRef.current = loadTicketMessages;
  }, [loadTicketMessages]);

  // Carrega mensagens quando o modal abre ou ticket muda
  useEffect(() => {
    if (isOpen && currentTicket?.id) {
      loadTicketMessages(currentTicket.id);
    } else {
      setTicketMessages([]);
    }
  }, [isOpen, currentTicket?.id, loadTicketMessages]);

  // Polling removido - apenas WebSocket é usado para atualizações em tempo real
  // Se o WebSocket não estiver conectado, as atualizações só ocorrerão quando:
  // 1. O modal for aberto e carregar mensagens iniciais
  // 2. O WebSocket se reconectar e enviar eventos
  // 3. O usuário interagir com o ticket (enviar mensagem, etc.)
  useEffect(() => {
    if (!isOpen) return;
    
    logger.debug('[TicketModal] Modal aberto. Atualizações via WebSocket apenas.', {
      wsConnected,
      wsAuthenticated,
      autoRefresh,
      ticketId: currentTicket?.id,
    });
  }, [isOpen, wsConnected, wsAuthenticated, autoRefresh, currentTicket?.id]);

  // Atribui ticket para atendente
  const handleAssign = async () => {
    if (!currentTicket || !assignedTo.trim()) {
      showToast('Informe o nome do atendente', 'warning');
      return;
    }

    try {
      await assignTicket(currentTicket.id, assignedTo.trim());
      showToastRef.current('Ticket atribuído com sucesso', 'success');
      setAssignedTo('');
      
      // Atualiza ticket local
      const updatedTicket = { ...currentTicket, status: 'in_progress', assignedTo: assignedTo.trim() };
      setCurrentTicket(updatedTicket);
      
      // Notifica componente pai
      if (onTicketUpdate) {
        onTicketUpdate(updatedTicket);
      }
      
      // Recarrega mensagens
      await loadTicketMessages(currentTicket.id);
    } catch (error) {
      logger.error('Erro ao atribuir ticket', error);
      showToast('Erro ao atribuir ticket', 'error');
    }
  };

  // Fecha ticket
  const handleClose = async () => {
    if (!currentTicket) return;

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
      await closeTicket(currentTicket.id);
      showToastRef.current('Ticket fechado com sucesso', 'success');
      
      // Atualiza ticket local
      const updatedTicket = { ...currentTicket, status: 'closed' };
      setCurrentTicket(updatedTicket);
      
      // Notifica componente pai
      if (onTicketUpdate) {
        onTicketUpdate(updatedTicket);
      }
    } catch (error) {
      logger.error('Erro ao fechar ticket', error);
      showToast('Erro ao fechar ticket', 'error');
    }
  };

  // Envia mensagem do atendente
  const handleSendMessage = async () => {
    if (!currentTicket || !messageText.trim()) {
      showToast('Digite uma mensagem', 'warning');
      return;
    }

    try {
      await sendTicketMessage(currentTicket.id, messageText.trim());
      showToastRef.current('Mensagem enviada com sucesso', 'success');
      setMessageText('');
      
      // Recarrega mensagens para mostrar a nova mensagem
      await loadTicketMessages(currentTicket.id);
      
      // Notifica componente pai para atualizar lista
      if (onTicketUpdate) {
        onTicketUpdate(currentTicket);
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

  if (!isOpen || !currentTicket) return null;

  // Cores adaptadas ao tema
  const chatBgColor = themeName === 'dark' 
    ? '#0b2b26' // Verde escuro para tema escuro
    : '#e5ddd5'; // Bege claro para tema claro
  
  const chatBgPattern = themeName === 'dark'
    ? 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255, 255, 255, 0.01) 10px, rgba(255, 255, 255, 0.01) 20px)'
    : 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0, 0, 0, 0.02) 10px, rgba(0, 0, 0, 0.02) 20px)';
  
  const headerBgColor = themeName === 'dark'
    ? '#075e54' // Verde WhatsApp escuro
    : '#075e54'; // Verde WhatsApp (mesmo para ambos)
  
  const messageSentBg = themeName === 'dark'
    ? '#056162' // Verde mais escuro para mensagens enviadas no tema escuro
    : '#dcf8c6'; // Verde claro padrão WhatsApp
  
  const messageReceivedBg = themeName === 'dark'
    ? theme.colors.bg.elevated // Usa cor do tema para mensagens recebidas no tema escuro
    : '#ffffff'; // Branco padrão WhatsApp
  
  const inputAreaBg = themeName === 'dark'
    ? theme.colors.bg.tertiary
    : '#f0f0f0';

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={`Ticket #${currentTicket.id.slice(0, 12)}`}
        size="full"
        resizable={true}
        draggable={true}
        dynamicSize={{ width: 900, isCollapsed: false }}
      >
        <div className="ticket-modal-container">
          {/* Controles superiores */}
          <div className="ticket-modal-controls">
            {wsConnected && wsAuthenticated ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span 
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#25D366',
                    animation: 'pulse 2s infinite'
                  }}
                  title="WebSocket conectado - Atualizações em tempo real ativas"
                />
                <span style={{ fontSize: '14px', color: '#666' }}>
                  Atualização em tempo real
                </span>
              </div>
            ) : (
              <label className="ticket-modal-checkbox">
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
                if (loadMessagesRef.current && currentTicket.id) {
                  loadMessagesRef.current(currentTicket.id);
                }
              }} 
              disabled={loading}
              style={{ fontSize: '0.9em', padding: '6px 12px' }}
            >
              {loading ? 'Carregando...' : 'Atualizar'}
            </Button>
          </div>

          {/* Área de Chat WhatsApp */}
          <div className="ticket-modal-chat-area" style={{ 
            backgroundColor: chatBgColor,
            backgroundImage: chatBgPattern 
          }}>
            {/* Cabeçalho do chat */}
            <div className="ticket-modal-chat-header" style={{ backgroundColor: headerBgColor }}>
              <div className="ticket-modal-chat-header-info">
                <div className="ticket-modal-chat-header-title">
                  {formatPhoneNumber(currentTicket.phoneNumber)}
                  {currentTicket.unreadCount > 0 && (
                    <span className="ticket-modal-chat-header-badge">
                      {currentTicket.unreadCount} nova(s)
                    </span>
                  )}
                </div>
                <div className="ticket-modal-chat-header-subtitle">
                  {currentTicket.queue} • {formatDate(currentTicket.createdAt)}
                </div>
              </div>
              <div className="ticket-modal-chat-header-status">
                <span className={`ticket-modal-status ${getStatusClass(currentTicket.status)}`}>
                  {currentTicket.status === 'waiting'
                    ? 'Aguardando'
                    : currentTicket.status === 'in_progress'
                      ? 'Em atendimento'
                      : 'Fechado'}
                </span>
              </div>
            </div>

            {/* Área de mensagens */}
            {currentTicket.status === 'in_progress' && (
              <div className="ticket-modal-messages-area">
                <div className="ticket-modal-messages-list">
                  {ticketMessages.length === 0 ? (
                    <div className="ticket-modal-messages-empty">
                      Nenhuma mensagem ainda
                    </div>
                  ) : (
                    ticketMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`ticket-modal-message ${msg.sender === 'user' ? 'sent' : 'received'}`}
                      >
                        <div 
                          className="ticket-modal-message-content"
                          style={{
                            backgroundColor: msg.sender === 'user' ? messageSentBg : messageReceivedBg,
                            color: themeName === 'dark' 
                              ? theme.colors.text.primary 
                              : msg.sender === 'user' 
                                ? '#000'
                                : '#000'
                          }}
                        >
                          {msg.text}
                        </div>
                        <div className="ticket-modal-message-time">
                          {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                          {msg.sender === 'agent' && msg.agentId && (
                            <span className="ticket-modal-message-sender"> • {msg.agentId}</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Área de ações */}
            <div 
              className="ticket-modal-actions-area"
              style={{ backgroundColor: inputAreaBg }}
            >
              {currentTicket.status === 'waiting' && (
                <div className="ticket-modal-assign-form">
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    placeholder="Nome do atendente"
                    className="ticket-modal-input"
                    style={{
                      backgroundColor: theme.colors.bg.secondary,
                      color: theme.colors.text.primary,
                      borderColor: theme.colors.border.default
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleAssign();
                      }
                    }}
                  />
                  <Button onClick={handleAssign} className="ticket-modal-button-primary">
                    Atribuir Ticket
                  </Button>
                </div>
              )}

              {currentTicket.status === 'in_progress' && (
                <div className="ticket-modal-message-form">
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    rows={3}
                    className="ticket-modal-textarea"
                    style={{
                      backgroundColor: theme.colors.bg.secondary,
                      color: theme.colors.text.primary,
                      borderColor: theme.colors.border.default
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <Button onClick={handleSendMessage} className="ticket-modal-button-primary">
                    Enviar
                  </Button>
                </div>
              )}

              <Button
                onClick={handleClose}
                className="ticket-modal-button-danger"
                style={{
                  backgroundColor: theme.colors.status.error,
                }}
              >
                Fechar Ticket
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
}

