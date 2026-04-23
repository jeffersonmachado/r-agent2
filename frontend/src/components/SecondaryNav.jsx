import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu, pathMatches } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

function buildSections(activeArea) {
  if (!activeArea) return [];

  const sections = [];
  const fallbackItems = [];

  activeArea.nodes.forEach((node) => {
    if (node.path && !node.hiddenInSidebar) {
      fallbackItems.push(node);
    }

    (node.children || []).forEach((child) => {
      if (Array.isArray(child.children) && child.children.length > 0) {
        const children = child.children.filter((item) => item.path && !item.hiddenInSidebar);
        if (children.length > 0) {
          sections.push({ id: child.id, label: child.label, items: children });
        }
        return;
      }

      if (child.path && !child.hiddenInSidebar) {
        fallbackItems.push(child);
      }
    });
  });

  if (fallbackItems.length > 0) {
    sections.unshift({ id: 'geral', label: 'Geral', items: fallbackItems });
  }

  const seen = new Set();
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item?.path) return false;
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export function SecondaryNav({ agent, currentPath }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const { activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const sections = useMemo(() => buildSections(activeArea), [activeArea]);

  return (
    <aside className="rap-secondary-nav" aria-label="Navegacao secundaria">
      <header className="rap-secondary-nav-header">
        <p className="rap-secondary-nav-kicker">Area ativa</p>
        <h2>{activeArea?.label || 'Navegacao'}</h2>
        <p>{activeArea?.description || 'Selecione um modulo para continuar.'}</p>
      </header>

      <div className="rap-secondary-nav-scroll">
        {sections.map((section) => (
          <section key={section.id} className="rap-secondary-nav-section">
            <h3>{section.label}</h3>
            <div className="rap-secondary-nav-items">
              {section.items.map((item) => (
                <NavigationLink
                  key={item.id}
                  to={item.path}
                  className={`rap-secondary-nav-item ${pathMatches(item.path, currentPath) ? 'is-active' : ''}`}
                >
                  {item.label}
                </NavigationLink>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

export default SecondaryNav;
