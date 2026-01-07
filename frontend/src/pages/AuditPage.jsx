/**
 * Página de auditoria de ações dos agentes.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import * as authApi from '../api/auth';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';
import { ConversationHistoryModal } from '../components/ConversationHistoryModal';

export function AuditPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    action: '',
    resource: '',
    username: '',
    limit: 100,
    offset: 0,
  });
  const [total, setTotal] = useState(0);
  const [activeTab, setActiveTab] = useState('logs'); // 'logs' ou 'conversations'
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);

  const canViewAudit = currentAgent?.role === 'admin' || currentAgent?.role === 'supervisor';

  const loadConversations = async () => {
    try {
      setConversationsLoading(true);
      const result = await authApi.listConversations();
      logger.debug('Conversas carregadas:', { count: result?.conversations?.length || 0, result });
      setConversations(result?.conversations || []);
    } catch (err) {
      logger.error('Erro ao carregar conversas', err);
      showToast('Erro ao carregar conversas', 'error');
      setConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  };

  const handleViewConversation = async (sessionId) => {
    try {
      const conversation = await authApi.getConversation(sessionId);
      setSelectedConversation(conversation);
    } catch (err) {
      logger.error('Erro ao carregar conversa', err);
      showToast('Erro ao carregar conversa', 'error');
    }
  };

  useEffect(() => {
    if (canViewAudit && isAuthenticated) {
      loadLogs();
      loadStats();
    }
  }, [canViewAudit, isAuthenticated, filters]);

  useEffect(() => {
    if (canViewAudit && isAuthenticated && activeTab === 'conversations') {
      loadConversations();
    }
  }, [canViewAudit, isAuthenticated, activeTab]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const result = await authApi.queryAuditLogs(filters);
      setLogs(result.logs || []);
      setTotal(result.total || 0);
    } catch (err) {
      logger.error('Erro ao carregar logs', err);
      showToast('Erro ao carregar logs de auditoria', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const result = await authApi.getAuditStats();
      setStats(result);
    } catch (err) {
      logger.error('Erro ao carregar estatísticas', err);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  };

  const getActionLabel = (action) => {
    const labels = {
      login: 'Login',
      logout: 'Logout',
      agent_create: 'Criar Agente',
      agent_update: 'Atualizar Agente',
      agent_delete: 'Remover Agente',
      ticket_assign: 'Atribuir Ticket',
      ticket_close: 'Fechar Ticket',
      ticket_message: 'Enviar Mensagem',
    };
    return labels[action] || action;
  };

  const getResourceLabel = (resource) => {
    const labels = {
      auth: 'Autenticação',
      agent: 'Agente',
      ticket: 'Ticket',
      queue: 'Fila',
    };
    return labels[resource] || resource;
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
          <p className="text-text-secondary">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  if (!canViewAudit) {
    return (
      <div className="support-page">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-text-primary mb-4">🚫 Acesso Negado</h1>
            <p className="text-text-secondary mb-6">Você não tem permissão para visualizar logs de auditoria.</p>
            <NavigationLink to="/support">
              <Button>Voltar</Button>
            </NavigationLink>
          </div>
        </div>
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🔍 Auditoria</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Visualize e monitore todas as ações realizadas no sistema
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border-default mb-6">
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'logs'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Logs de Ações
        </button>
        <button
          onClick={() => setActiveTab('conversations')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'conversations'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Conversas
        </button>
      </div>

        {/* Estatísticas */}
        {stats && activeTab === 'logs' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-3xl font-bold text-text-primary mb-2">
                {stats.totalActions || 0}
              </div>
              <div className="text-text-secondary text-sm">Total de Ações</div>
            </div>
          </div>
        )}

        {/* Conteúdo baseado na aba ativa */}
        {activeTab === 'logs' ? (
          <>
            {/* Filtros */}
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
              <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                <span>🔍</span>
                <span>Filtros</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Username
                  </label>
                  <input
                    type="text"
                    value={filters.username}
                    onChange={(e) => setFilters({ ...filters, username: e.target.value, offset: 0 })}
                    placeholder="Filtrar por username"
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Ação
                  </label>
                  <select
                    value={filters.action}
                    onChange={(e) => setFilters({ ...filters, action: e.target.value, offset: 0 })}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                  >
                    <option value="">Todas</option>
                    <option value="login">Login</option>
                    <option value="logout">Logout</option>
                    <option value="agent_create">Criar Agente</option>
                    <option value="agent_update">Atualizar Agente</option>
                    <option value="agent_delete">Remover Agente</option>
                    <option value="ticket_assign">Atribuir Ticket</option>
                    <option value="ticket_close">Fechar Ticket</option>
                    <option value="ticket_message">Enviar Mensagem</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Recurso
                  </label>
                  <select
                    value={filters.resource}
                    onChange={(e) => setFilters({ ...filters, resource: e.target.value, offset: 0 })}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                  >
                    <option value="">Todos</option>
                    <option value="auth">Autenticação</option>
                    <option value="agent">Agente</option>
                    <option value="ticket">Ticket</option>
                    <option value="queue">Fila</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Tabela de Logs */}
            <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
                    <p className="text-text-secondary">Carregando logs...</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-bg-secondary border-b border-border-default">
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Data/Hora
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Agente
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Ação
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Recurso
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            ID do Recurso
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            IP
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log, index) => (
                          <tr key={`${log.id}-${index}`} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {formatDate(log.timestamp)}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">{log.username}</td>
                            <td className="px-4 py-3 text-sm text-text-primary">{getActionLabel(log.action)}</td>
                            <td className="px-4 py-3 text-sm text-text-primary">{getResourceLabel(log.resource)}</td>
                            <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                              {log.resourceId || '-'}
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                              {log.ipAddress}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {logs.length === 0 && (
                    <div className="py-20 text-center text-text-secondary">
                      Nenhum log encontrado
                    </div>
                  )}

                  {total > filters.limit && (
                    <div className="px-6 py-4 border-t border-border-default flex flex-col sm:flex-row justify-between items-center gap-4 bg-bg-secondary">
                      <div className="text-sm text-text-secondary">
                        Mostrando {filters.offset + 1} - {Math.min(filters.offset + filters.limit, total)} de {total}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={filters.offset === 0}
                          onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}
                        >
                          ← Anterior
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={filters.offset + filters.limit >= total}
                          onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })}
                        >
                          Próximo →
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          /* Seção de Conversas */
            <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg">
              {conversationsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
                    <p className="text-text-secondary">Carregando conversas...</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-bg-secondary border-b border-border-default">
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Session ID
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Fluxo
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Início
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Última Atividade
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Mensagens
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Handoff
                          </th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {conversations.map((conv) => (
                          <tr key={conv.sessionId} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                            <td className="px-4 py-3 text-sm text-text-primary font-mono">
                              {conv.sessionId}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {conv.flowId || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-secondary">
                              {conv.startTime ? formatDate(conv.startTime) : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-secondary">
                              {conv.lastActivity ? formatDate(conv.lastActivity) : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {conv.messageCount}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {conv.hasHandoff ? '✅ Sim' : '❌ Não'}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewConversation(conv.sessionId)}
                              >
                                Ver Histórico
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {conversations.length === 0 && (
                    <div className="py-20 text-center">
                      <div className="text-text-secondary mb-2">
                        <p className="text-lg font-medium mb-2">Nenhuma conversa encontrada</p>
                        <p className="text-sm">
                          As conversas são armazenadas em memória e aparecerão aqui quando houver interações ativas com os fluxos.
                        </p>
                        <p className="text-sm mt-2">
                          Nota: As conversas são limpas automaticamente após 24 horas de inatividade.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
        )}

      {/* Modal de Histórico de Conversa */}
      {selectedConversation && (
        <ConversationHistoryModal
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
        />
      )}

      <ToastContainer />
    </div>
  );
}

