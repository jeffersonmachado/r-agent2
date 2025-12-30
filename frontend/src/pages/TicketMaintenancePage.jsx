import React, { useState, useEffect, useCallback } from 'react';
import { listAllTickets, listQueues, getQueueMetrics, createQueue, deleteQueue, getQueueInfo } from '../api/tickets';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';

/**
 * Página de manutenção de tickets com estatísticas, filtros e ações de limpeza.
 */
export function TicketMaintenancePage() {
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [metrics, setMetrics] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 100, // Limite padrão de 100 tickets por página
  });
  const [totalTickets, setTotalTickets] = useState(0); // Separado para evitar re-renderizações
  const [filters, setFilters] = useState({
    status: '',
    queue: '',
    search: '',
  });
  const [showQueueManager, setShowQueueManager] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [queueToDelete, setQueueToDelete] = useState(null);
  const [queueInfo, setQueueInfo] = useState({});

  // Usa useRef para manter referências estáveis
  const showToastRef = React.useRef(showToast);
  const loadMetricsRef = React.useRef();
  const loadTicketsRef = React.useRef();
  
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Carrega métricas do sistema
  const loadMetrics = useCallback(async () => {
    try {
      const data = await getQueueMetrics();
      logger.info('Métricas carregadas', { 
        totalTickets: data?.totalTickets,
        ticketsByStatus: data?.ticketsByStatus,
        ticketsByQueue: data?.ticketsByQueue,
        hasData: !!data,
        fullData: data
      });
      setMetrics(data);
    } catch (error) {
      logger.error('Erro ao carregar métricas', error);
      showToastRef.current('Erro ao carregar métricas', 'error');
      // Define métricas vazias em caso de erro para evitar valores undefined
      setMetrics({
        totalTickets: 0,
        ticketsByStatus: { waiting: 0, in_progress: 0, closed: 0 },
        ticketsByQueue: {},
        oldClosedTickets: { olderThan7Days: 0, olderThan30Days: 0 },
        memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
      });
    }
  }, []); // Sem dependências - usa ref

  // Atualiza ref quando loadMetrics muda
  React.useEffect(() => {
    loadMetricsRef.current = loadMetrics;
  }, [loadMetrics]);

  // Carrega filas disponíveis
  const loadQueues = useCallback(async () => {
    try {
      const queuesList = await listQueues();
      setQueues(queuesList);
    } catch (error) {
      logger.error('Erro ao carregar filas', error);
      showToastRef.current('Erro ao carregar filas', 'error');
    }
  }, []); // Sem dependências - usa ref

  // Carrega tickets com filtros e paginação
  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      // Se há filtro de busca, busca todos os tickets primeiro (sem paginação)
      // para poder aplicar o filtro corretamente e calcular o total
      const needsFullList = !!filters.search;
      
      const options = {
        limit: needsFullList ? 10000 : pagination.limit, // Máximo permitido pelo backend
        offset: needsFullList ? 0 : (pagination.page - 1) * pagination.limit,
      };
      if (filters.status) options.status = filters.status;
      if (filters.queue) options.queue = filters.queue;

      const result = await listAllTickets(options);

      logger.info('Tickets carregados', {
        total: result.total,
        ticketsCount: result.tickets?.length || 0,
        limit: result.limit,
        offset: result.offset,
        firstTicket: result.tickets?.[0],
      });

      // Aplica filtro de busca (por ID, telefone ou mensagem) no lado do cliente
      let filteredTickets = result.tickets || [];
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        filteredTickets = filteredTickets.filter(
          (ticket) =>
            ticket.id.toLowerCase().includes(searchLower) ||
            ticket.phoneNumber?.toLowerCase().includes(searchLower) ||
            ticket.lastUserMessage?.toLowerCase().includes(searchLower) ||
            ticket.sessionId?.toLowerCase().includes(searchLower)
        );
      }

      // Se há filtro de busca, aplica paginação no frontend após filtrar
      let finalTickets = filteredTickets;
      let finalTotal = filteredTickets.length;
      
      if (filters.search) {
        const startIndex = (pagination.page - 1) * pagination.limit;
        const endIndex = startIndex + pagination.limit;
        finalTickets = filteredTickets.slice(startIndex, endIndex);
        finalTotal = filteredTickets.length; // Total após filtro de busca
      } else {
        finalTotal = result.total || 0; // Total do backend (já paginado)
      }

      setTickets(finalTickets);
      setTotalTickets(finalTotal);
    } catch (error) {
      logger.error('Erro ao carregar tickets', error);
      showToastRef.current('Erro ao carregar tickets', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.queue, filters.search, pagination.page, pagination.limit]);

  // Atualiza ref quando loadTickets muda
  React.useEffect(() => {
    loadTicketsRef.current = loadTickets;
  }, [loadTickets]);

  // Carrega dados iniciais - apenas uma vez no mount
  useEffect(() => {
    loadMetrics();
    loadQueues();
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Apenas no mount inicial

  // Recarrega tickets quando filtros ou paginação mudam
  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Auto-refresh de métricas - usa refs para evitar recriação do intervalo
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Usa refs para evitar dependências que mudam constantemente
      if (loadMetricsRef.current) loadMetricsRef.current();
      if (loadTicketsRef.current) loadTicketsRef.current();
    }, 10000); // 10 segundos

    return () => clearInterval(interval);
  }, [autoRefresh]); // Apenas autoRefresh como dependência

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  };

  const formatPhoneNumber = (phone) => {
    if (!phone) return '-';
    if (phone.length === 13 && phone.startsWith('55')) {
      const ddd = phone.slice(2, 4);
      const part1 = phone.slice(4, 9);
      const part2 = phone.slice(9);
      return `+55 (${ddd}) ${part1}-${part2}`;
    }
    return phone;
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getStatusClass = (status) => {
    if (status === 'waiting') return 'waiting';
    if (status === 'in_progress') return 'in_progress';
    return 'closed';
  };

  const getStatusLabel = (status) => {
    if (status === 'waiting') return 'Aguardando';
    if (status === 'in_progress') return 'Em Atendimento';
    return 'Fechado';
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    // Reset para primeira página quando filtros mudam
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleRefresh = () => {
    loadMetrics();
    loadTickets();
    showToast('Dados atualizados', 'success');
  };

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handleLimitChange = (newLimit) => {
    setPagination((prev) => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const handleCreateQueue = async () => {
    if (!newQueueName.trim()) {
      showToastRef.current('Digite um nome para a fila', 'warning');
      return;
    }

    try {
      const result = await createQueue(newQueueName.trim());
      if (result.success) {
        showToastRef.current(result.message, 'success');
        setNewQueueName('');
        await loadQueues();
        await loadMetrics();
      }
    } catch (error) {
      logger.error('Erro ao criar fila', error);
      const errorMessage = error.message || error.error?.message || 'Erro ao criar fila';
      showToastRef.current(errorMessage, 'error');
    }
  };

  const handleDeleteQueue = async (queueName, force = false) => {
    if (!force) {
      const confirmed = await confirm({
        title: 'Excluir Fila',
        message: `Deseja realmente excluir a fila "${queueName}"?\n\nA fila só pode ser excluída se não tiver tickets ativos.`,
        confirmLabel: 'Excluir',
        cancelLabel: 'Cancelar',
        variant: 'warning',
      });

      if (!confirmed) {
        return;
      }
    } else {
      const confirmed = await confirm({
        title: '⚠️ ATENÇÃO: Excluir Fila com Tickets',
        message: `A fila "${queueName}" possui tickets ativos.\n\nDeseja realmente excluir a fila? Todos os tickets ativos serão fechados.`,
        confirmLabel: 'Excluir Mesmo Assim',
        cancelLabel: 'Cancelar',
        variant: 'danger',
      });

      if (!confirmed) {
        return;
      }
    }

    try {
      const result = await deleteQueue(queueName, force);
      if (result.success) {
        showToastRef.current(result.message, 'success');
        setQueueToDelete(null);
        await loadQueues();
        await loadTickets();
        await loadMetrics();
      }
    } catch (error) {
      logger.error('Erro ao excluir fila', error);
      const errorMessage = error.message || error.error?.message || 'Erro ao excluir fila';
      if (errorMessage.includes('ticket(s) ativo(s)') || errorMessage.includes('activeTickets')) {
        setQueueToDelete({ name: queueName, hasActiveTickets: true });
      }
      showToastRef.current(errorMessage, 'error');
    }
  };

  const loadQueueInfo = useCallback(async (queueName) => {
    try {
      const info = await getQueueInfo(queueName);
      setQueueInfo((prev) => ({ ...prev, [queueName]: info }));
    } catch (error) {
      logger.error('Erro ao carregar informações da fila', error);
    }
  }, []);

  const totalPages = Math.ceil(totalTickets / pagination.limit);
  const startIndex = (pagination.page - 1) * pagination.limit + 1;
  const endIndex = Math.min(pagination.page * pagination.limit, totalTickets);

  return (
    <div className="maintenance-page">
      <div className="maintenance-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🔧 Manutenção de Tickets</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <NavigationLink to="/support" className="btn-base">
              <span className="icon">💬</span>
              <span>Atendimento</span>
            </NavigationLink>
            <NavigationLink to="/editor" className="btn-base">
              <span className="icon">📝</span>
              <span>Editor</span>
            </NavigationLink>
            <NavigationLink to="/config" className="btn-base">
              <span className="icon">⚙️</span>
              <span>Configuração</span>
            </NavigationLink>
          </div>
        </div>
        <div className="maintenance-controls">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-atualizar (10s)</span>
          </label>
          <Button onClick={handleRefresh} disabled={loading}>
            {loading ? 'Carregando...' : '🔄 Atualizar'}
          </Button>
        </div>
      </div>

      {/* Container principal com layout flexível */}
      <div className="maintenance-content-wrapper">
        {/* Painel de Métricas */}
        {metrics && (
          <div className="maintenance-metrics">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h2>📊 Estatísticas do Sistema</h2>
            {(filters.status || filters.queue || filters.search) && (
              <span style={{ 
                fontSize: '0.85em', 
                color: '#666', 
                fontStyle: 'italic',
                padding: '4px 8px',
                backgroundColor: '#f0f0f0',
                borderRadius: '4px'
              }}>
                ℹ️ Métricas mostram todos os tickets (filtros não aplicados)
              </span>
            )}
          </div>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Total de Tickets</div>
              <div className="metric-value">{metrics.totalTickets ?? 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Aguardando</div>
              <div className="metric-value waiting">{metrics.ticketsByStatus?.waiting ?? 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Em Atendimento</div>
              <div className="metric-value in_progress">{metrics.ticketsByStatus?.in_progress ?? 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Fechados</div>
              <div className="metric-value closed">{metrics.ticketsByStatus?.closed ?? 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Fechados &gt; 7 dias</div>
              <div className="metric-value warning">
                {metrics.oldClosedTickets?.olderThan7Days ?? 0}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Fechados &gt; 30 dias</div>
              <div className="metric-value danger">
                {metrics.oldClosedTickets?.olderThan30Days ?? 0}
              </div>
            </div>
          </div>

          <div className="metrics-details">
            <div className="metrics-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3>Tickets por Fila</h3>
                <Button
                  onClick={() => {
                    const newValue = !showQueueManager;
                    setShowQueueManager(newValue);
                    if (newValue) {
                      // Carrega informações de todas as filas quando abre o gerenciador
                      queues.forEach((q) => {
                        loadQueueInfo(q);
                      });
                    }
                  }}
                  variant="secondary"
                  style={{ fontSize: '0.9em', padding: '6px 12px' }}
                >
                  {showQueueManager ? '✕ Fechar' : '⚙️ Gerenciar Filas'}
                </Button>
              </div>
              <div className="queue-stats">
                {Object.entries(metrics.ticketsByQueue || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([queue, count]) => {
                    const info = queueInfo[queue] || {};
                    const activeCount = info.activeTickets || 0;
                    return (
                      <div key={queue} className="queue-stat-item" title={`${activeCount} ativo(s), ${info.closedTickets || 0} fechado(s)`}>
                        <span className="queue-name">{queue}</span>
                        <span className="queue-count">
                          {count}
                          {activeCount > 0 && (
                            <span style={{ 
                              marginLeft: '5px', 
                              fontSize: '0.85em', 
                              color: '#e74c3c',
                              fontWeight: 'bold'
                            }}>
                              ({activeCount} ativo{activeCount > 1 ? 's' : ''})
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                {(!metrics.ticketsByQueue || Object.keys(metrics.ticketsByQueue).length === 0) && (
                  <p className="empty-message">Nenhuma fila encontrada</p>
                )}
              </div>

              {/* Gerenciador de Filas */}
              {showQueueManager && (
                <div className="queue-manager">
                  <h4>Gerenciar Filas</h4>
                  
                  <div style={{ 
                    padding: '10px', 
                    marginBottom: '15px', 
                    backgroundColor: '#f0f8ff', 
                    borderRadius: '4px',
                    fontSize: '0.9em',
                    border: '1px solid #b3d9ff'
                  }}>
                    <strong>ℹ️ Sobre Filas e Fallback:</strong>
                    <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                      <li>Filas são usadas pelo modo <strong>Ticket</strong> (assíncrono)</li>
                      <li>Modo <strong>Human</strong> (síncrono) não usa filas</li>
                      <li>Configure FallbackNodes com <code>escalationMode: "ticket"</code> e <code>queue</code> apropriada</li>
                    </ul>
                  </div>
                  
                  {/* Criar Nova Fila */}
                  <div className="queue-manager-form">
                    <label>Criar Nova Fila:</label>
                    <div className="queue-manager-input-group">
                      <input
                        type="text"
                        className="queue-manager-input"
                        value={newQueueName}
                        onChange={(e) => setNewQueueName(e.target.value)}
                        placeholder="Nome da fila (ex: suporte_n1, vendas, financeiro)"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handleCreateQueue();
                          }
                        }}
                      />
                      <Button onClick={handleCreateQueue} variant="primary" size="md">
                        ➕ Criar
                      </Button>
                    </div>
                    <small className="queue-manager-hint">
                      Use apenas letras, números, hífens e underscores. Exemplos: suporte_n1, vendas, financeiro, urgente
                    </small>
                  </div>

                  {/* Lista de Filas */}
                  <div>
                    <label className="queue-manager-form">Filas Existentes:</label>
                    {queues.length === 0 ? (
                      <p className="empty-message">Nenhuma fila cadastrada</p>
                    ) : (
                      <div className="queue-manager-list">
                        {queues.map((queue) => {
                          const info = queueInfo[queue] || {};
                          const hasActiveTickets = info.activeTickets > 0;
                          return (
                            <div key={queue} className="queue-manager-item">
                              <div className="queue-manager-item-info">
                                <div className="queue-manager-item-name">{queue}</div>
                                {info.exists && (
                                  <div className="queue-manager-item-details">
                                    {info.activeTickets || 0} ativo(s), {info.closedTickets || 0} fechado(s)
                                    {hasActiveTickets && (
                                      <span className="queue-manager-item-warning">
                                        ⚠️ Possui tickets ativos
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="queue-manager-actions">
                                {queueToDelete?.name === queue && queueToDelete.hasActiveTickets ? (
                                  <>
                                    <Button
                                      onClick={() => handleDeleteQueue(queue, true)}
                                      variant="danger"
                                      size="sm"
                                    >
                                      🗑️ Forçar Exclusão
                                    </Button>
                                    <Button
                                      onClick={() => setQueueToDelete(null)}
                                      variant="secondary"
                                      size="sm"
                                    >
                                      Cancelar
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    onClick={() => handleDeleteQueue(queue, false)}
                                    variant="danger"
                                    size="sm"
                                    disabled={hasActiveTickets && !queueToDelete}
                                    title={hasActiveTickets ? 'A fila possui tickets ativos' : 'Excluir fila'}
                                  >
                                    🗑️ Excluir
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="metrics-section">
              <h3>Uso de Memória</h3>
              <div className="memory-stats">
                <div className="memory-item">
                  <span>RSS:</span>
                  <span>{formatBytes(metrics.memoryUsage?.rss ?? 0)}</span>
                </div>
                <div className="memory-item">
                  <span>Heap Total:</span>
                  <span>{formatBytes(metrics.memoryUsage?.heapTotal ?? 0)}</span>
                </div>
                <div className="memory-item">
                  <span>Heap Usado:</span>
                  <span>{formatBytes(metrics.memoryUsage?.heapUsed ?? 0)}</span>
                </div>
                <div className="memory-item">
                  <span>External:</span>
                  <span>{formatBytes(metrics.memoryUsage?.external ?? 0)}</span>
                </div>
              </div>
            </div>

            {metrics.oldestTicket && (
              <div className="metrics-section">
                <h3>Ticket Mais Antigo</h3>
                <div className="ticket-info">
                  <div>ID: {metrics.oldestTicket.id?.slice(0, 20) ?? 'N/A'}...</div>
                  <div>Idade: {metrics.oldestTicket.ageDays ?? 0} dias</div>
                  <div>Criado: {formatDate(metrics.oldestTicket.createdAt)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Filtros e Lista de Tickets */}
        <div className="maintenance-tickets">
        <h2>📋 Lista de Tickets</h2>

        <div className="maintenance-filters">
          <div className="filter-group">
            <label>Status:</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
            >
              <option value="">Todos</option>
              <option value="waiting">Aguardando</option>
              <option value="in_progress">Em Atendimento</option>
              <option value="closed">Fechados</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Fila:</label>
            <select
              value={filters.queue}
              onChange={(e) => handleFilterChange('queue', e.target.value)}
            >
              <option value="">Todas</option>
              {queues.map((queue) => (
                <option key={queue} value={queue}>
                  {queue}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group filter-search">
            <label>Buscar:</label>
            <input
              type="text"
              placeholder="ID, telefone, mensagem..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
            />
          </div>

          <div className="filter-group">
            <Button
              onClick={() => {
                setFilters({ status: '', queue: '', search: '' });
              }}
              variant="secondary"
            >
              Limpar Filtros
            </Button>
          </div>
        </div>

        <div className="tickets-summary">
          <p>
            Mostrando <strong>{startIndex}</strong> a <strong>{endIndex}</strong> de <strong>{totalTickets}</strong> ticket(s)
            {filters.status && ` com status "${getStatusLabel(filters.status)}"`}
            {filters.queue && ` na fila "${filters.queue}"`}
            {filters.search && ` contendo "${filters.search}"`}
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              Itens por página:
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
                style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="loading-message">Carregando tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="empty-message">Nenhum ticket encontrado</div>
        ) : (
          <div className="tickets-table-container">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Fila</th>
                  <th>Status</th>
                  <th>Telefone</th>
                  <th>Última Mensagem</th>
                  <th>Atendente</th>
                  <th>Criado</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="ticket-id-cell">
                      <code>{ticket.id.slice(0, 16)}...</code>
                    </td>
                    <td>{ticket.queue}</td>
                    <td>
                      <span className={`status-badge ${getStatusClass(ticket.status)}`}>
                        {getStatusLabel(ticket.status)}
                      </span>
                    </td>
                    <td>{formatPhoneNumber(ticket.phoneNumber)}</td>
                    <td className="message-cell">
                      {ticket.lastUserMessage ? (
                        <span title={ticket.lastUserMessage}>
                          {ticket.lastUserMessage.length > 50
                            ? ticket.lastUserMessage.slice(0, 50) + '...'
                            : ticket.lastUserMessage}
                        </span>
                      ) : (
                        <span className="empty-text">-</span>
                      )}
                    </td>
                    <td>{ticket.assignedTo || <span className="empty-text">-</span>}</td>
                    <td className="date-cell">{formatDate(ticket.createdAt)}</td>
                    <td className="date-cell">{formatDate(ticket.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Controles de Paginação */}
        {!loading && totalTickets > 0 && totalPages > 1 && (
          <div className="pagination-controls" style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            gap: '10px', 
            marginTop: '20px',
            padding: '15px',
            borderTop: '1px solid #ddd'
          }}>
            <Button
              onClick={() => handlePageChange(1)}
              disabled={pagination.page === 1}
              variant="secondary"
            >
              « Primeira
            </Button>
            <Button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              variant="secondary"
            >
              ‹ Anterior
            </Button>
            <span style={{ padding: '0 15px' }}>
              Página <strong>{pagination.page}</strong> de <strong>{totalPages}</strong>
            </span>
            <Button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              variant="secondary"
            >
              Próxima ›
            </Button>
            <Button
              onClick={() => handlePageChange(totalPages)}
              disabled={pagination.page >= totalPages}
              variant="secondary"
            >
              Última »
            </Button>
          </div>
        )}
      </div>
      </div>

      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}

