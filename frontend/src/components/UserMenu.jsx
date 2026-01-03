import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/authContext';
import { NavigationLink } from './NavigationLink';
import { Button } from '../styles/Button';
import { getVisibleMenuItems } from '../utils/menuPermissions';
import { listAllTickets } from '../api/tickets';
import logger from '../utils/logger';

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
  const [isOpen, setIsOpen] = useState(false);
  const [activeTicketsCount, setActiveTicketsCount] = useState(0);
  const [agentStatus, setAgentStatus] = useState('online'); // online, busy, offline
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

  // Carrega tickets ativos do agente e atualiza status
  useEffect(() => {
    if (!agent) {
      setActiveTicketsCount(0);
      setAgentStatus('offline');
      return;
    }

    let isMounted = true;

    async function loadActiveTickets() {
      try {
        // Busca tickets em atendimento atribuídos ao agente
        const result = await listAllTickets({
          status: 'in_progress',
          limit: 1000,
        });

        if (!isMounted) return;

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
        if (isMounted) {
          setAgentStatus('online'); // Assume online em caso de erro
        }
      }
    }

    loadActiveTickets();

    // Atualiza a cada 30 segundos
    const interval = setInterval(loadActiveTickets, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [agent]);

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
        <span className="user-name">{agent.name}</span>
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

