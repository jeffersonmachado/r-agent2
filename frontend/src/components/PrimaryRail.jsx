import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

const RAIL_PREFERRED_PATHS = {
  home: ['/workspace', '/dashboard'],
  atendimento: ['/support', '/inbox', '/quick-replies', '/departments'],
  clientes: ['/crm'],
  conhecimento: ['/knowledge-base', '/rag-documents', '/faq', '/product-docs', '/web-scraping'],
  operacoes: ['/supervisor', '/operations-dashboard', '/analytics', '/channel-health', '/pbx'],
  builder: ['/editor', '/bpmn-editor', '/automations', '/projects'],
  admin: ['/config', '/agents', '/tenants', '/audit', '/rbac', '/access-control', '/super-admin'],
};

function resolveRailTargetPath(area) {
  const availablePaths = new Set((area?.items || []).map((item) => item.path).filter(Boolean));
  const preferredPaths = RAIL_PREFERRED_PATHS[area?.id] || [];
  return preferredPaths.find((path) => availablePaths.has(path))
    || area?.path
    || area?.fallbackPath;
}

function RailIcon({ icon }) {
  switch (icon) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 10.5L12 3l9 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9.8V20h13V9.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'spark':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18 15l.8 1.9L21 18l-2.2 1.1L18 21l-.8-1.9L15 18l2.2-1.1L18 15z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'users':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="9" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="16" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.5 18.5c.7-2.4 2.6-3.8 4.5-3.8s3.8 1.4 4.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M13.2 18.5c.6-1.9 2-3 3.6-3 1.5 0 2.9 1.1 3.5 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'book':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 5.5C4 4.1 5.1 3 6.5 3H20v16H6.5A2.5 2.5 0 014 16.5V5.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 7h8M8 11h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'pulse':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2.5 12h4l2.2-4.8L12 17l2.6-5h6.9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'flow':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="6" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="15" y="4" width="6" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="9" y="16" width="6" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 6h6M12 8.2V16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3l7 2.5V11c0 4.5-3 8.6-7 10-4-1.4-7-5.5-7-10V5.5L12 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <span className="rap-primary-rail-fallback-dot" aria-hidden="true" />;
  }
}

export function PrimaryRail({ agent, currentPath, capabilities }) {
  const { agent: authAgent, logout, capabilities: authCapabilities } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const effectiveCapabilities = capabilities || authCapabilities;
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu, effectiveCapabilities), [agent, effectiveCapabilities]);
  const { areas, activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const normalizedUsername = String(authAgent?.username || agent?.username || '').trim().toLowerCase();
  const normalizedName = String(authAgent?.name || agent?.name || '').trim().toLowerCase();
  const normalizedRole = String(authAgent?.role || agent?.role || '').trim().toLowerCase();
  const isSuperUserFlag = Boolean(
    authAgent?.isSuperAdmin
    || authAgent?.is_super_admin
    || authAgent?.superuser
    || agent?.isSuperAdmin
    || agent?.is_super_admin
    || agent?.superuser,
  );
  const canShowDevRail = isSuperUserFlag
    || normalizedUsername === 'systemadmin'
    || normalizedUsername === 'superuser'
    || normalizedName === 'systemadmin'
    || normalizedName === 'superuser'
    || normalizedRole === 'super_admin'
    || normalizedRole === 'superuser';

  const railAreas = useMemo(() => {
    if (!canShowDevRail || areas.some((area) => area.id === 'dev')) {
      return areas;
    }

    const devArea = {
      id: 'dev',
      label: 'Dev',
      shortLabel: 'DEV',
      icon: 'flow',
      accent: 'var(--color-status-info)',
      path: '/dev',
      fallbackPath: '/dev',
      isActive: currentPath === '/dev' || currentPath.startsWith('/dev/'),
    };

    const adminIndex = areas.findIndex((area) => area.id === 'admin');
    if (adminIndex < 0) {
      return [...areas, devArea];
    }

    return [
      ...areas.slice(0, adminIndex),
      devArea,
      ...areas.slice(adminIndex),
    ];
  }, [areas, canShowDevRail, currentPath]);

  const activeRailAreaId = useMemo(() => {
    if (canShowDevRail && (currentPath === '/dev' || currentPath.startsWith('/dev/'))) {
      return 'dev';
    }
    return activeArea?.id || null;
  }, [activeArea?.id, canShowDevRail, currentPath]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1080px)');
    const handleViewportChange = (event) => setIsMobileViewport(event.matches);

    setIsMobileViewport(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  // Em mobile, fechar menu após clique para liberar área de conteúdo.
  const handleNavClick = () => {
    if (isMobileViewport) {
      setIsMenuOpen(false);
    }
  };

  return (
    <aside className="rap-primary-rail" aria-label="Navegação primária">
      <div className="rap-primary-rail-header">
        <div className="rap-primary-rail-brand">
          <span className="rap-primary-rail-mark">RAP</span>
        </div>
        <button 
          className="rap-primary-rail-toggle"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Abrir menu"
          aria-expanded={isMenuOpen}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      <nav className={`rap-primary-rail-nav ${isMenuOpen ? 'is-open' : ''}`}>
        {/* Mobile: User profile section */}
        {authAgent && (
          <div className="rap-primary-rail-mobile-profile">
            <div className="rap-primary-rail-profile-avatar">
              {(authAgent.role || '??').slice(0, 2).toUpperCase()}
            </div>
            <div className="rap-primary-rail-profile-info">
              <div className="rap-primary-rail-profile-name">{authAgent.name}</div>
              <div className="rap-primary-rail-profile-role">{authAgent.role}</div>
            </div>
          </div>
        )}

        {railAreas.map((area) => {
          const targetPath = resolveRailTargetPath(area);
          return (
            <NavigationLink
              key={area.id}
              to={targetPath}
              className={`rap-primary-rail-item ${activeRailAreaId === area.id ? 'is-active' : ''}`}
              title={area.label}
              aria-label={area.label}
              aria-current={activeRailAreaId === area.id ? 'page' : undefined}
              onClick={handleNavClick}
            >
              <span className="rap-primary-rail-item-icon" aria-hidden="true">
                <RailIcon icon={area.icon} />
              </span>
              <span className="rap-primary-rail-item-label">{isMobileViewport ? area.label : (area.shortLabel || area.label)}</span>
              <span className="rap-primary-rail-item-tooltip" role="tooltip">{area.label}</span>
              <span
                className="rap-primary-rail-item-accent"
                style={{ backgroundColor: area.accent || 'var(--color-accent-primary)' }}
                aria-hidden="true"
              />
            </NavigationLink>
          );
        })}
        {/* Mobile: Botão Sair */}
        <button
          className="rap-primary-rail-logout"
          onClick={async () => { setIsMenuOpen(false); await logout(); }}
        >
          <span className="rap-primary-rail-logout-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="16 17 21 12 16 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span>Sair</span>
        </button>      </nav>
    </aside>
  );
}

export default PrimaryRail;
