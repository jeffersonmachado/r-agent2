import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/authContext';
import { NavigationLink } from './NavigationLink';
import { Button } from '../styles/Button';
import { getVisibleMenuItems } from '../utils/menuPermissions';
import { listAllTickets } from '../api/tickets';
import { logoutAll } from '../api/auth';
import { useToast } from './Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import websocketMetrics from '../utils/websocketMetrics';
import logger from '../utils/logger';
import { getTenant } from '../api/tenants';

/**
 * Menu de usuário fixo no canto superior direito
 * Contém avatar e dropdown com links de navegação
 * Evoluído com:
 * - RBAC: controle de visibilidade por permissões
 * - Badge de tickets ativos no avatar
 * - Status do agente (online/ocupado/offline)
 */
export function UserMenu() {
  const { agent, logout } = useAuth();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTicketsCount, setActiveTicketsCount] = useState(0);
  const [agentStatus, setAgentStatus] = useState('online'); // online, busy, offline
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [tenantInfo, setTenantInfo] = useState(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target) &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Fecha o dropdown ao pressionar ESC
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  // Função para carregar tickets ativos e atualizar status
  const loadActiveTickets = useCallback(async () => {
    if (!agent) {
      setActiveTicketsCount(0);
      setAgentStatus('offline');
      return;
    }

    try {
      // Busca tickets em atendimento atribuídos ao agente
      const result = await listAllTickets({
        status: 'in_progress',
        limit: 1000,
      });

      // Filtra tickets atribuídos ao agente atual
      const agentTickets = result.tickets?.filter((ticket) => {
        return (
          ticket.assignedTo === agent.id ||
          ticket.assignedTo === agent.username
        );
      }) || [];

      const count = agentTickets.length;
      setActiveTicketsCount(count);

      // Determina status do agente:
      // - busy: tem tickets em atendimento
      // - online: autenticado e sem tickets em atendimento
      if (count > 0) {
        setAgentStatus('busy');
      } else {
        setAgentStatus('online');
      }
    } catch (err) {
      logger.warn('Erro ao carregar tickets ativos', err);
      setAgentStatus('online'); // Assume online em caso de erro
    }
  }, [agent]);

  // Ref para manter referência estável da função
  const loadActiveTicketsRef = useRef(loadActiveTickets);
  useEffect(() => {
    loadActiveTicketsRef.current = loadActiveTickets;
  }, [loadActiveTickets]);

  // WebSocket para atualizações em tempo real
  const handleWebSocketEvent = useCallback((event, data) => {
    logger.debug('[UserMenu] Evento WebSocket recebido', event, data);

    // Registra métrica de evento WebSocket
    websocketMetrics.recordWebSocketEvent(event);

    // Só processa eventos relacionados a tickets do agente atual
    const isRelevantEvent = 
      data.assignedTo === agent?.id || 
      data.assignedTo === agent?.username ||
      data.ticket?.assignedTo === agent?.id ||
      data.ticket?.assignedTo === agent?.username ||
      !data.assignedTo; // Eventos sem assignedTo podem ser relevantes

    if (!isRelevantEvent) {
      return;
    }

    // Função auxiliar para atualizar contador baseado no ticket recebido
    const updateCounterFromTicket = (ticket) => {
      if (!ticket) return;
      
      // Só conta tickets in_progress atribuídos ao agente
      const isAgentTicket = ticket.assignedTo === agent?.id || ticket.assignedTo === agent?.username;
      const isInProgress = ticket.status === 'in_progress';
      
      setActiveTicketsCount(prevCount => {
        if (isInProgress && isAgentTicket) {
          // Verifica se já está na contagem (não duplica)
          return prevCount; // Mantém o contador, será recalculado abaixo
        } else {
          // Se foi fechado ou mudou de status, recalcula
          return prevCount; // Será recalculado abaixo
        }
      });
      
      // Recalcula contador completo (mais confiável)
      if (loadActiveTicketsRef.current) {
        loadActiveTicketsRef.current();
      }
    };

    switch (event) {
      case 'ticket.assigned':
        // Ticket atribuído - atualiza contador usando dados do WebSocket
        if (data.ticket) {
          updateCounterFromTicket(data.ticket);
        } else {
          // Fallback: recarrega contador se não tiver dados do ticket
          if (loadActiveTicketsRef.current) {
            loadActiveTicketsRef.current();
          }
        }
        break;

      case 'ticket.updated':
        // Ticket atualizado - atualiza contador se mudou status ou atribuição
        if (data.ticket) {
          updateCounterFromTicket(data.ticket);
        } else if (data.status === 'in_progress' || data.status === 'closed') {
          // Fallback: recarrega contador se não tiver dados do ticket
          if (loadActiveTicketsRef.current) {
            loadActiveTicketsRef.current();
          }
        }
        break;

      case 'ticket.closed':
        // Ticket fechado - atualiza contador usando dados do WebSocket
        if (data.ticket) {
          updateCounterFromTicket(data.ticket);
        } else {
          // Fallback: recarrega contador se não tiver dados do ticket
          if (loadActiveTicketsRef.current) {
            loadActiveTicketsRef.current();
          }
        }
        break;

      default:
        // Outros eventos não afetam o contador
        break;
    }
  }, [agent]);

  // Conecta ao WebSocket para receber atualizações em tempo real
  const { connected: wsConnected, authenticated: wsAuthenticated } = useWebSocketContext({
    enabled: !!agent,
    onEvent: handleWebSocketEvent,
    subscribeEvents: [
      'ticket.assigned',
      'ticket.updated',
      'ticket.closed',
    ],
  });

  // Atualiza métricas de status WebSocket
  useEffect(() => {
    websocketMetrics.setWebSocketStatus(wsConnected && wsAuthenticated);
  }, [wsConnected, wsAuthenticated]);

  // Carrega informações do tenant
  useEffect(() => {
    if (!agent || !agent.tenantId) {
      setTenantInfo(null);
      return;
    }

    const loadTenantInfo = async () => {
      try {
        const result = await getTenant(agent.tenantId);
        if (result && result.tenant) {
          setTenantInfo(result.tenant);
        } else {
          setTenantInfo({ name: agent.tenantId, id: agent.tenantId });
        }
      } catch (err) {
        logger.warn('Erro ao carregar informações do tenant', err);
        // Fallback: usa tenantId como nome
        setTenantInfo({ name: agent.tenantId, id: agent.tenantId });
      }
    };

    loadTenantInfo();
  }, [agent]);

  // Carrega tickets iniciais - apenas uma vez quando o agente é carregado
  // Polling removido - apenas WebSocket é usado para atualizações em tempo real
  useEffect(() => {
    if (!agent) {
      setActiveTicketsCount(0);
      setAgentStatus('offline');
      return;
    }

    // Carrega dados iniciais apenas uma vez
    loadActiveTickets();

    logger.debug('[UserMenu] Dados iniciais carregados. Atualizações via WebSocket apenas.', {
      wsConnected,
      wsAuthenticated,
    });
  }, [agent, loadActiveTickets]);

  // Gera inicial do nome para o avatar
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  const handleLogoutAll = async () => {
    if (!confirm('Deseja encerrar todas as sessões? Você será desconectado de todos os dispositivos.')) {
      return;
    }

    setIsLoggingOutAll(true);
    try {
      const result = await logoutAll();
      showToast(
        `Todas as sessões foram encerradas (${result.sessionsRemoved || 0} sessão(ões) removida(s))`,
        'success'
      );
      // Aguarda um pouco antes de redirecionar para mostrar o toast
      setTimeout(() => {
        window.location.href = '/login';
      }, 1000);
    } catch (err) {
      logger.error('Erro ao fazer logout de todas as sessões', err);
      showToast('Erro ao encerrar todas as sessões', 'error');
      setIsLoggingOutAll(false);
    }
  };

  if (!agent) {
    return null;
  }

  // Obtém itens do menu visíveis baseado em permissões e ordena alfabeticamente
  const visibleMenuItems = getVisibleMenuItems(agent).sort((a, b) => 
    a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' })
  );

  // Obtém classes de status para o avatar
  const getStatusClass = () => {
    return `user-avatar-status user-avatar-status-${agentStatus}`;
  };

  // Obtém texto do status
  const getStatusText = () => {
    switch (agentStatus) {
      case 'busy':
        return 'Ocupado';
      case 'offline':
        return 'Offline';
      default:
        return 'Online';
    }
  };

  return (
    <div className="user-menu-container">
      <button
        ref={buttonRef}
        className="user-menu-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Menu do usuário"
        aria-expanded={isOpen}
      >
        <div className="user-avatar-wrapper">
          <div className="user-avatar">
            {getInitials(agent.name)}
          </div>
          {activeTicketsCount > 0 && (
            <span className="user-avatar-badge" title={`${activeTicketsCount} ticket(s) ativo(s)`}>
              {activeTicketsCount > 99 ? '99+' : activeTicketsCount}
            </span>
          )}
          <span className={getStatusClass()} title={getStatusText()}></span>
        </div>
        <span 
          className="user-name" 
          title={
            tenantInfo 
              ? `Tenant: ${tenantInfo.name || agent.tenantId}\nTenant ID: ${agent.tenantId || 'N/A'}` 
              : agent.tenantId 
                ? `Tenant ID: ${agent.tenantId}` 
                : ''
          }
        >
          {agent.name}
        </span>
        <span className={`user-menu-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </button>

      {isOpen && (
        <div ref={menuRef} className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-info">
              <div className="user-avatar-large-wrapper">
                <div className="user-avatar-large">
                  {getInitials(agent.name)}
                </div>
                {activeTicketsCount > 0 && (
                  <span className="user-avatar-badge-large" title={`${activeTicketsCount} ticket(s) ativo(s)`}>
                    {activeTicketsCount > 99 ? '99+' : activeTicketsCount}
                  </span>
                )}
                <span className={`user-avatar-status-large user-avatar-status-${agentStatus}`} title={getStatusText()}></span>
              </div>
              <div className="user-menu-details">
                <div className="user-menu-name">{agent.name}</div>
                <div className="user-menu-role-status">
                  <span className="user-menu-role">{agent.role}</span>
                  <span className={`user-menu-status user-menu-status-${agentStatus}`}>
                    {getStatusText()}
                  </span>
                </div>
                {tenantInfo && (
                  <div className="user-menu-tenant" title={`Tenant: ${tenantInfo.name}\nTenant ID: ${agent.tenantId || 'N/A'}`}>
                    🏢 {tenantInfo.name}
                  </div>
                )}
                {!tenantInfo && agent.tenantId && (
                  <div className="user-menu-tenant" title={`Tenant ID: ${agent.tenantId}`}>
                    🏢 {agent.tenantId}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="user-menu-divider"></div>

          <div className="user-menu-nav">
            {visibleMenuItems.map((item) => (
              <NavigationLink
                key={item.path}
                to={item.path}
                className="user-menu-item"
                onClick={() => setIsOpen(false)}
              >
                <span className="icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavigationLink>
            ))}
          </div>

          <div className="user-menu-divider"></div>

          <div className="user-menu-footer">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogoutAll}
              className="user-menu-logout-all"
              disabled={isLoggingOutAll}
              style={{ marginBottom: '8px', width: '100%' }}
            >
              {isLoggingOutAll ? 'Encerrando...' : 'Encerrar todas as sessões'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="user-menu-logout"
            >
              Sair
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

