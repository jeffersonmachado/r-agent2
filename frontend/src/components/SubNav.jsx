import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { findNavigationTrail, navigationMenu, pathMatches } from '../navigation/menu';
import { filterNavigationTree } from '../utils/menuPermissions';

// Legacy sub-navigation component kept only for backward compatibility and tests.
// Official shell uses AreaHeader as contextual command bar.

function titleFromPath(pathname) {
  const cleaned = pathname.split('/').filter(Boolean);
  const last = cleaned[cleaned.length - 1] || 'dashboard';
  return last.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function LegacySubNav({ agent, currentPath, rightSlot = null, tenantLabel = '', verticalLabels = [], capabilities }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu, capabilities), [agent, capabilities]);
  const trail = useMemo(() => findNavigationTrail(filteredMenu, currentPath), [filteredMenu, currentPath]);
  const parentWithLinks = [...trail].reverse().find((node) => Array.isArray(node.children) && node.children.some((child) => child.path));
  const contextualItems = (parentWithLinks?.children || [])
    .filter((item) => item.path && !item.hiddenInSubNav && !item.hiddenInSidebar);
  const breadcrumb = trail.filter((node) => node.label);
  const metaItems = [
    tenantLabel ? `Conta: ${tenantLabel}` : '',
    Array.isArray(verticalLabels) && verticalLabels.length > 0
      ? `Vertical${verticalLabels.length > 1 ? 'is' : ''}: ${verticalLabels.join(', ')}`
      : '',
  ].filter(Boolean);

  return (
    <header className="rap-subnav">
      <div className="rap-subnav-main">
        <div className="rap-breadcrumbs" aria-label="Breadcrumb">
          {breadcrumb.length > 0 ? (
            breadcrumb.map((node, index) => (
              <React.Fragment key={node.id}>
                {node.path ? (
                  <NavigationLink to={node.path} className={`rap-breadcrumb-link ${pathMatches(node.path, currentPath) ? 'is-active' : ''}`}>
                    {node.label}
                  </NavigationLink>
                ) : (
                  <span className="rap-breadcrumb-link">{node.label}</span>
                )}
                {index < breadcrumb.length - 1 && <span className="rap-breadcrumb-separator">/</span>}
              </React.Fragment>
            ))
          ) : (
            <span className="rap-breadcrumb-link is-active">{titleFromPath(currentPath)}</span>
          )}
        </div>

        {metaItems.length > 0 && (
          <div className="rap-subnav-meta" aria-label="Resumo de contexto">
            {metaItems.map((item) => (
              <span key={item} className="rap-subnav-meta-pill">{item}</span>
            ))}
          </div>
        )}

        {contextualItems.length > 1 && (
          <nav className="rap-context-nav" aria-label="Subnavegação contextual">
            {contextualItems.map((item) => (
              <NavigationLink
                key={item.id}
                to={item.path}
                className={`rap-context-pill ${pathMatches(item.path, currentPath) ? 'is-active' : ''}`}
              >
                {item.label}
              </NavigationLink>
            ))}
          </nav>
        )}
      </div>

      {rightSlot ? <div className="rap-subnav-actions">{rightSlot}</div> : null}
    </header>
  );
}

// Backward-compatible export.
export const SubNav = LegacySubNav;

export default LegacySubNav;
