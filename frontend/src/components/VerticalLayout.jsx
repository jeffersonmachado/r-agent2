import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { verticalWorkspaces, pathMatches } from '../navigation/menu';
import { canAccessMenuItem } from '../utils/menuPermissions';

export function VerticalLayout({ agent, verticalKey, verticalKeys = null, currentPath, children }) {
  const resolvedKeys = Array.isArray(verticalKeys) && verticalKeys.length > 0
    ? verticalKeys
    : [verticalKey || 'beauty'];

  const workspaces = useMemo(
    () => resolvedKeys
      .map((key) => verticalWorkspaces[key])
      .filter(Boolean),
    [resolvedKeys],
  );

  const isMultiWorkspace = workspaces.length > 1;
  const headerWorkspace = workspaces[0] || verticalWorkspaces.beauty;
  const dashboardVisible = useMemo(
    () => workspaces.some((workspace) =>
      workspace.items.some((item) => item.path === '/vertical/dashboard' && canAccessMenuItem(agent, item)),
    ),
    [agent, workspaces],
  );

  const groupedItems = useMemo(
    () => workspaces
      .map((workspace) => ({
        ...workspace,
        items: workspace.items
          .filter((item) => item.path !== '/vertical/dashboard' && canAccessMenuItem(agent, item))
          .map((item) => ({
            ...item,
            id: `${workspace.id}:${item.id}`,
          })),
      })),
    [agent, workspaces],
  );

  const flatItems = useMemo(
    () => groupedItems.flatMap((workspace) => workspace.items),
    [groupedItems],
  );

  const headerTitle = isMultiWorkspace ? 'Todas as verticais' : headerWorkspace.label;
  const headerDescription = isMultiWorkspace
    ? 'Painel consolidado com acesso a todas as verticais disponiveis.'
    : headerWorkspace.description;
  const headerColor = isMultiWorkspace ? '#0f766e' : headerWorkspace.color;

  return (
    <section className="rap-vertical-layout">
      <div className="rap-vertical-header" style={{ '--rap-vertical-color': headerColor }}>
        <div>
          <span className="rap-vertical-kicker">Workspace vertical</span>
          <h2>{headerTitle}</h2>
          <p>{headerDescription}</p>
        </div>
      </div>

      <nav className="rap-vertical-nav" aria-label={`Subnavegacao da vertical ${headerTitle}`}>
        {dashboardVisible && (
          <div className="rap-vertical-global-nav">
            <NavigationLink
              to="/vertical/dashboard"
              className={`rap-vertical-pill ${pathMatches('/vertical/dashboard', currentPath) ? 'is-active' : ''}`}
            >
              Cockpit Vertical
            </NavigationLink>
          </div>
        )}

        {isMultiWorkspace ? groupedItems.map((workspace) => (
          <section key={workspace.id} className="rap-vertical-group">
            <div className="rap-vertical-group-header">
              <span
                className="rap-vertical-group-dot"
                style={{ '--rap-vertical-group-color': workspace.color }}
              ></span>
              <span className="rap-vertical-group-title">{workspace.label}</span>
            </div>
            <div className="rap-vertical-group-items">
              {workspace.items.length > 0 ? workspace.items.map((item) => (
                <NavigationLink
                  key={item.id}
                  to={item.path}
                  className={`rap-vertical-pill ${pathMatches(item.path, currentPath) ? 'is-active' : ''}`}
                >
                  {item.label}
                </NavigationLink>
              )) : (
                <div className="rap-vertical-group-empty">
                  Modulos especificos desta vertical ainda estao em preparacao. Use o Cockpit Vertical para visao consolidada.
                </div>
              )}
            </div>
          </section>
        )) : flatItems.map((item) => (
          <NavigationLink
            key={item.id}
            to={item.path}
            className={`rap-vertical-pill ${pathMatches(item.path, currentPath) ? 'is-active' : ''}`}
          >
            {item.label}
          </NavigationLink>
        ))}
      </nav>

      <div className="rap-vertical-content">{children}</div>
    </section>
  );
}

export default VerticalLayout;
