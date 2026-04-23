import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { findNavigationTrail, navigationMenu, pathMatches } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

export function AreaHeader({ agent, currentPath, rightSlot = null, tenantLabel = '', verticalLabels = [] }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const trail = useMemo(() => findNavigationTrail(filteredMenu, currentPath), [filteredMenu, currentPath]);
  const { activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const meta = [
    tenantLabel ? `Conta: ${tenantLabel}` : '',
    verticalLabels.length > 0 ? `Vertical${verticalLabels.length > 1 ? 'is' : ''}: ${verticalLabels.join(', ')}` : '',
  ].filter(Boolean);

  return (
    <header className="rap-area-header">
      <div className="rap-area-header-main">
        <p className="rap-area-header-kicker">{activeArea?.label || 'Workspace'}</p>
        <div className="rap-area-header-breadcrumbs" aria-label="Breadcrumb">
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
        </div>
        {meta.length > 0 ? (
          <div className="rap-area-header-meta">
            {meta.map((item) => (
              <span key={item} className="rap-area-header-meta-pill">{item}</span>
            ))}
          </div>
        ) : null}
      </div>
      {rightSlot ? <div className="rap-area-header-actions">{rightSlot}</div> : null}
    </header>
  );
}

export default AreaHeader;
