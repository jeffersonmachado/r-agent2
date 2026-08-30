import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { findNavigationTrail, navigationMenu, pathMatches } from '../navigation/menu';

export function AreaHeader({
  agent,
  currentPath,
  actionsSlot = null,
  rightSlot = null,
  capabilities,
}) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu, capabilities), [agent, capabilities]);
  const trail = useMemo(() => findNavigationTrail(filteredMenu, currentPath), [filteredMenu, currentPath]);

  const pageTitle = trail[trail.length - 1]?.label || 'Espaço de Trabalho';
  const effectiveActions = actionsSlot || rightSlot;

  return (
    <header className="rap-area-header">
      <div className="rap-area-header-main">
        <div className="rap-area-header-title-row">
          <h1 className="rap-area-header-title">{pageTitle}</h1>
        </div>
        <nav className="rap-area-header-breadcrumbs" aria-label="Breadcrumb">
          {trail.length > 0 ? trail.map((node, index) => (
            <React.Fragment key={node.id}>
              {node.path ? (
                <NavigationLink
                  to={node.path}
                  className={`rap-area-breadcrumb-link ${pathMatches(node.path, currentPath) ? 'is-active' : ''}`}
                >
                  {node.label}
                </NavigationLink>
              ) : (
                <span className="rap-area-breadcrumb-link">{node.label}</span>
              )}
              {index < trail.length - 1 ? <span className="rap-area-breadcrumb-separator">/</span> : null}
            </React.Fragment>
          )) : <span className="rap-area-breadcrumb-link is-active">Inicio</span>}
        </nav>
      </div>
      {effectiveActions ? <div className="rap-area-header-actions">{effectiveActions}</div> : null}
    </header>
  );
}

export default AreaHeader;
