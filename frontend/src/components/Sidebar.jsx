import React, { useEffect, useMemo, useState } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { findNavigationTrail, getTopLevelNode, navigationMenu, pathMatches, verticalWorkspaces } from '../navigation/menu';

function getInitialOpenMap(nodes, currentPath, previousState) {
  const trailIds = new Set(findNavigationTrail(nodes, currentPath).map((node) => node.id));
  const next = { ...(previousState || {}) };
  nodes.forEach((node) => {
    if (Array.isArray(node.children) && node.children.length > 0) {
      next[node.id] = previousState?.[node.id] ?? trailIds.has(node.id);
      node.children.forEach((child) => {
        if (Array.isArray(child.children) && child.children.length > 0) {
          next[child.id] = previousState?.[child.id] ?? trailIds.has(child.id);
        }
      });
    }
  });
  return next;
}

function SidebarSection({ node, currentPath, openMap, onToggle, isCurrentSection }) {
  const isActive = isCurrentSection || (node.path ? pathMatches(node.path, currentPath) : false);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isOpen = openMap[node.id];

  return (
    <div className={`rap-sidebar-section ${isActive ? 'is-active' : ''}`}>
      <div className="rap-sidebar-section-header">
        <NavigationLink
          to={node.path || '#'}
          className={`rap-sidebar-top-link ${isActive ? 'is-active' : ''}`}
        >
          <span className="rap-sidebar-icon">{node.icon || '•'}</span>
          <span className="rap-sidebar-label">{node.label}</span>
        </NavigationLink>
        {hasChildren && (
          <button
            type="button"
            className="rap-sidebar-toggle"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? `Recolher ${node.label}` : `Expandir ${node.label}`}
          >
            {isOpen ? '−' : '+'}
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <div className="rap-sidebar-children">
          {node.children
            .filter((child) => !child.hiddenInSidebar)
            .map((child) => {
              const nestedChildren = Array.isArray(child.children)
                ? child.children.filter((item) => !item.hiddenInSidebar)
                : [];

              if (nestedChildren.length > 0) {
                const groupOpen = openMap[child.id];
                return (
                  <div key={child.id} className="rap-sidebar-group">
                    <button
                      type="button"
                      className="rap-sidebar-group-label"
                      onClick={() => onToggle(child.id)}
                    >
                      <span>{child.label}</span>
                      <span>{groupOpen ? '−' : '+'}</span>
                    </button>
                    {groupOpen && (
                      <div className="rap-sidebar-group-items">
                        {nestedChildren.map((item) => (
                          <NavigationLink
                            key={item.id}
                            to={item.path}
                            className={`rap-sidebar-item ${pathMatches(item.path, currentPath) ? 'is-active' : ''}`}
                          >
                            {item.label}
                          </NavigationLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return child.path ? (
                <NavigationLink
                  key={child.id}
                  to={child.path}
                  className={`rap-sidebar-item ${pathMatches(child.path, currentPath) ? 'is-active' : ''}`}
                >
                  {child.label}
                </NavigationLink>
              ) : null;
            })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ agent, currentPath, resolvedVerticalKeys = [] }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const [openMap, setOpenMap] = useState(() => getInitialOpenMap(filteredMenu, currentPath));
  const activeTopLevel = useMemo(() => getTopLevelNode(filteredMenu, currentPath), [filteredMenu, currentPath]);
  const resolvedVerticals = useMemo(
    () => resolvedVerticalKeys.map((key) => verticalWorkspaces[key]).filter(Boolean),
    [resolvedVerticalKeys],
  );

  useEffect(() => {
    setOpenMap((previous) => getInitialOpenMap(filteredMenu, currentPath, previous));
  }, [filteredMenu, currentPath]);

  const topLevelNodes = filteredMenu.slice(0, 7);

  return (
    <aside className="rap-sidebar">
      <div className="rap-sidebar-brand">
        <div className="rap-sidebar-brand-mark">RAP</div>
        <div>
          <div className="rap-sidebar-brand-title">Runtime Access Portal</div>
          <div className="rap-sidebar-brand-subtitle">Navegacao por capacidades</div>
        </div>
      </div>

      <div className="rap-sidebar-scroll">
        {topLevelNodes.map((node) => (
          <SidebarSection
            key={node.id}
            node={node}
            currentPath={currentPath}
            openMap={openMap}
            onToggle={(id) => setOpenMap((previous) => ({ ...previous, [id]: !previous[id] }))}
            isCurrentSection={activeTopLevel?.id === node.id}
          />
        ))}
      </div>

      <div className="rap-sidebar-footer">
        <div className="rap-sidebar-role">Perfil: {agent?.role || 'desconhecido'}</div>
        <div className="rap-sidebar-context">
          {activeTopLevel ? `Contexto: ${activeTopLevel.label}` : 'Contexto global'}
        </div>
        {resolvedVerticals.length > 0 && (
          <div className="rap-sidebar-verticals">
            <div className="rap-sidebar-verticals-label">
              {resolvedVerticals.length > 1 ? 'Verticais' : 'Vertical'}
            </div>
            <div className="rap-sidebar-verticals-list">
              {resolvedVerticals.map((workspace) => (
                <span
                  key={workspace.id}
                  className="rap-sidebar-vertical-badge"
                  style={{ '--rap-sidebar-vertical-color': workspace.color }}
                >
                  {workspace.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
