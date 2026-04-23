import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

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

export function PrimaryRail({ agent, currentPath }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const { areas, activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  return (
    <aside className="rap-primary-rail" aria-label="Navegacao primaria">
      <div className="rap-primary-rail-brand">
        <span className="rap-primary-rail-mark">RAP</span>
      </div>

      <nav className="rap-primary-rail-nav">
        {areas.map((area) => {
          // Usa a rota canônica da área quando disponível para evitar desvios por ordenação de leaves.
          // Exemplo: area "clientes" deve abrir /crm.
          const targetPath = area.fallbackPath || area.path;
          return (
            <NavigationLink
              key={area.id}
              to={targetPath}
              className={`rap-primary-rail-item ${activeArea?.id === area.id ? 'is-active' : ''}`}
              title={area.label}
              aria-label={area.label}
            >
              <span className="rap-primary-rail-item-icon" aria-hidden="true">
                <RailIcon icon={area.icon} />
              </span>
              <span className="rap-primary-rail-item-label">{area.shortLabel || area.label}</span>
              <span className="rap-primary-rail-item-tooltip" role="tooltip">{area.label}</span>
              <span
                className="rap-primary-rail-item-accent"
                style={{ backgroundColor: area.accent || 'var(--color-accent-primary)' }}
                aria-hidden="true"
              />
            </NavigationLink>
          );
        })}
      </nav>

      <div className="rap-primary-rail-footer" aria-label="Acoes rapidas">
        <NavigationLink to="/dashboard" className="rap-primary-rail-quick" title="Dashboard" aria-label="Ir para dashboard">
          <span aria-hidden="true">D</span>
        </NavigationLink>
        <NavigationLink to="/support" className="rap-primary-rail-quick" title="Atendimento" aria-label="Ir para atendimento">
          <span aria-hidden="true">A</span>
        </NavigationLink>
        <div className="rap-primary-rail-profile" aria-label={`Perfil ${agent?.role || 'desconhecido'}`}>
          {(agent?.role || '??').slice(0, 2).toUpperCase()}
        </div>
      </div>
    </aside>
  );
}

export default PrimaryRail;
