import React, { useState, useEffect, useCallback } from 'react';
import {
  listQueues,
  listAllTickets,
  assignTicket,
  closeTicket,
  sendTicketMessage,
  getTicketMessages,
  markTicketAsRead,
  createTicket,
} from '../api/tickets';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';

/**
 * Página de atendimento para gerenciar tickets.
 * Mostra apenas tickets do usuário logado ou sem atribuição.
 * Estilo inspirado no WhatsApp.
 */
export function SupportPage() {
  const { agent, logout, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }
  const [queues, setQueues] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [newConversationPhone, setNewConversationPhone] = useState('');
  const [newConversationMessage, setNewConversationMessage] = useState('');
  const [newConversationQueue, setNewConversationQueue] = useState('');

  // Usa useRef para manter referências estáveis
  const showToastRef = React.useRef(showToast);
  const loadTicketsRef = React.useRef();

  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Carrega filas disponíveis (apenas para o modal de nova conversa)
  const loadQueues = useCallback(async () => {
    try {
      const queuesList = await listQueues();
      setQueues(queuesList);
    } catch (error) {
      logger.error('Erro ao carregar filas', error);
      // Não mostra erro para o usuário, pois filas não são mais essenciais
    }
  }, []);

  // Flag para evitar requisições duplicadas
  const isLoadingTicketsRef = React.useRef(false);
  // Timestamp do último erro mostrado para evitar spam de toasts
  const lastErrorToastTimeRef = React.useRef(0);
  const ERROR_TOAST_COOLDOWN = 30000; // 30 segundos entre erros

  // Carrega tickets do usuário ou sem atribuição
  const loadTickets = useCallback(async () => {
    // Evita requisições duplicadas
    if (isLoadingTicketsRef.current) {
      return;
    }
    
    isLoadingTicketsRef.current = true;
    setLoading(true);
    try {
      // Carrega tickets waiting e in_progress
      // A API já filtra automaticamente: agents só veem seus tickets ou sem atribuição
      const [waitingResult, inProgressResult] = await Promise.all([
        listAllTickets({ status: 'waiting', limit: 1000 }),
        listAllTickets({ status: 'in_progress', limit: 1000 }),
      ]);
      
      // Combina os tickets e remove duplicatas
      const allTickets = [...(waitingResult.tickets || []), ...(inProgressResult.tickets || [])];
      const uniqueTickets = Array.from(
        new Map(allTickets.map(ticket => [ticket.id, ticket])).values()
      );
      
      // Ordena por data de criação (mais recentes primeiro)
      uniqueTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      setTickets(uniqueTickets);
      
      // Verifica se o ticket selecionado ainda existe na nova lista
      // Se não existir mais, limpa a seleção e as mensagens
      setSelectedTicket(prevSelected => {
        if (!prevSelected) return null;
        const updatedTicket = uniqueTickets.find(t => t.id === prevSelected.id);
        // Se não encontrou na lista, o ticket foi removido ou mudou de status
        if (!updatedTicket) {
          setTicketMessages([]);
          return null;
        }
        // Atualiza com os dados mais recentes do ticket
        return updatedTicket;
      });
      
      // Reseta o contador de erro em caso de sucesso
      lastErrorToastTimeRef.current = 0;
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      
      // Só mostra toast se passou tempo suficiente desde o último erro
      const now = Date.now();
      if (now - lastErrorToastTimeRef.current > ERROR_TOAST_COOLDOWN) {
        lastErrorToastTimeRef.current = now;
        // Toast de erro com duração menor para não ficar muito tempo na tela
        showToastRef.current('Erro ao carregar tickets', 'error', 5000);
      }
    } finally {
      setLoading(false);
      isLoadingTicketsRef.current = false;
    }
  }, []); // Sem dependências - usa refs e state setters funcionais

  // Atualiza ref quando loadTickets muda
  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  // Flag para garantir que os dados iniciais sejam carregados apenas uma vez
  const hasLoadedInitialDataRef = React.useRef(false);

  // Carrega dados iniciais - apenas uma vez no mount
  useEffect(() => {
    // Evita carregar múltiplas vezes (especialmente com StrictMode)
    if (hasLoadedInitialDataRef.current) {
      return;
    }
    
    hasLoadedInitialDataRef.current = true;
    loadQueues();
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Apenas no mount inicial

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
      
      // Preenche automaticamente o campo de atribuição se o ticket estiver waiting
      if (selectedTicket.status === 'waiting' && !assignedTo) {
        const defaultAssignee = agent?.username || agent?.id || '';
        if (defaultAssignee) {
          setAssignedTo(defaultAssignee);
        }
      }
    } else {
      setTicketMessages([]);
      setAssignedTo(''); // Limpa o campo quando nenhum ticket está selecionado
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
    if (!selectedTicket) {
      showToast('Selecione um ticket primeiro', 'warning');
      return;
    }

    // Usa o valor do campo ou o valor padrão do agente
    const assigneeName = assignedTo.trim() || agent?.username || agent?.id || '';
    
    if (!assigneeName) {
      showToast('Informe o nome do atendente', 'warning');
      return;
    }

    try {
      await assignTicket(selectedTicket.id, assigneeName);
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
          <h1>Atendimento</h1>
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
          <Button 
            onClick={() => {
              setNewConversationQueue(queues.length > 0 ? queues[0] : '');
              setShowNewConversationModal(true);
            }}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Iniciar Conversa
          </Button>
        </div>
      </div>

      <div className="support-grid">
        {/* Lista de Tickets */}
        <div className="support-tickets-panel">
          <h2>Meus Tickets</h2>
          {loading ? (
            <p>Carregando...</p>
          ) : tickets.length === 0 ? (
            <p className="support-tickets-empty">Nenhum ticket disponível</p>
          ) : (
            <div className="support-tickets-list">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  onClick={() => {
                    setSelectedTicket(ticket);
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
                      value={assignedTo || (agent?.username || agent?.id || '')}
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

      {/* Modal para Iniciar Nova Conversa */}
      {showNewConversationModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '8px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            <h2 style={{ marginTop: 0 }}>Iniciar Nova Conversa</h2>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Número de Telefone *
              </label>
              <input
                type="text"
                value={newConversationPhone}
                onChange={(e) => setNewConversationPhone(e.target.value)}
                placeholder="+5511999999999 ou 5511999999999"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
              <small style={{ color: '#666', fontSize: '12px' }}>
                Formato: +5511999999999 ou 5511999999999
              </small>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Fila *
              </label>
              <select
                value={newConversationQueue}
                onChange={(e) => setNewConversationQueue(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <option value="">Selecione uma fila</option>
                {queues.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Mensagem Inicial (opcional)
              </label>
              <textarea
                value={newConversationMessage}
                onChange={(e) => setNewConversationMessage(e.target.value)}
                placeholder="Olá! Como posso ajudá-lo hoje?"
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => {
                  setShowNewConversationModal(false);
                  setNewConversationPhone('');
                  setNewConversationMessage('');
                  setNewConversationQueue('');
                }}
                style={{ backgroundColor: '#6c757d' }}
              >
                Cancelar
              </Button>
              <Button
                onClick={async () => {
                  if (!newConversationPhone.trim()) {
                    showToast('Número de telefone é obrigatório', 'warning');
                    return;
                  }
                  if (!newConversationQueue.trim()) {
                    showToast('Fila é obrigatória', 'warning');
                    return;
                  }

                  try {
                    const ticket = await createTicket({
                      phoneNumber: newConversationPhone.trim(),
                      queue: newConversationQueue.trim(),
                      initialMessage: newConversationMessage.trim() || undefined,
                    });

                    showToast('Conversa iniciada com sucesso!', 'success');
                    setShowNewConversationModal(false);
                    setNewConversationPhone('');
                    setNewConversationMessage('');
                    setNewConversationQueue('');

                    // Recarrega tickets
                    if (loadTicketsRef.current) {
                      loadTicketsRef.current();
                    }

                    // Seleciona o ticket criado
                    setSelectedTicket(ticket);
                  } catch (error) {
                    logger.error('Erro ao iniciar conversa', error);
                    const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao iniciar conversa';
                    showToast(errorMessage, 'error');
                  }
                }}
                style={{ backgroundColor: '#25D366', color: 'white' }}
              >
                Iniciar Conversa
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
