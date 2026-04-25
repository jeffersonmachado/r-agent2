import React, { useEffect, useMemo, useState } from 'react';
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

  if (sections.length === 0 && fallbackItems.length > 0) {
    sections.push({ id: 'atalhos', label: 'Atalhos', items: fallbackItems });
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
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);

  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const { activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const sections = useMemo(() => buildSections(activeArea), [activeArea]);

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

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobilePanelOpen(true);
      return;
    }
    setIsMobilePanelOpen(false);
  }, [isMobileViewport, currentPath]);

  useEffect(() => {
    if (isMobileViewport && searchTerm.trim()) {
      setIsMobilePanelOpen(true);
    }
  }, [isMobileViewport, searchTerm]);

  useEffect(() => {
    setCollapsedSections((previous) => {
      const nextState = {};
      sections.forEach((section, index) => {
        nextState[section.id] = previous[section.id] ?? index > 0;
      });
      return nextState;
    });
  }, [sections]);

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedSearchTerm) {
      return sections;
    }

    return sections
      .map((section) => {
        const sectionMatches = section.label.toLowerCase().includes(normalizedSearchTerm);
        const items = sectionMatches
          ? section.items
          : section.items.filter((item) => item.label.toLowerCase().includes(normalizedSearchTerm));
        return {
          ...section,
          items,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [sections, normalizedSearchTerm]);

  function toggleSection(sectionId) {
    setCollapsedSections((previous) => ({
      ...previous,
      ...(isMobileViewport
        ? sections.reduce((accumulator, section) => {
            accumulator[section.id] = section.id !== sectionId;
            return accumulator;
          }, {})
        : {}),
      [sectionId]: isMobileViewport ? false : !previous[sectionId],
    }));
  }

  const isSecondaryBodyCollapsed = isMobileViewport && !isMobilePanelOpen;

  return (
    <aside className="rap-secondary-nav" aria-label="Navegacao secundaria">
      <header className="rap-secondary-nav-header">
        <p className="rap-secondary-nav-kicker">Area ativa</p>
        <h2>{activeArea?.label || 'Navegacao'}</h2>
        <p>{activeArea?.description || 'Selecione um modulo para continuar.'}</p>
        <button
          type="button"
          className="rap-secondary-nav-mobile-toggle"
          onClick={() => setIsMobilePanelOpen((previous) => !previous)}
          aria-expanded={!isSecondaryBodyCollapsed}
          aria-controls="secondary-nav-body"
        >
          <span>{isSecondaryBodyCollapsed ? 'Abrir menu da area' : 'Fechar menu da area'}</span>
          <span className="rap-secondary-nav-mobile-toggle-icon" aria-hidden="true">▾</span>
        </button>
      </header>

      <div id="secondary-nav-body" className={`rap-secondary-nav-body ${isSecondaryBodyCollapsed ? 'is-collapsed' : ''}`}>
        <div className="rap-secondary-nav-search-wrap">
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="rap-secondary-nav-search"
            placeholder="Buscar no menu..."
            aria-label="Buscar itens do menu secundario"
          />
        </div>

        <div className="rap-secondary-nav-scroll">
          {filteredSections.map((section) => {
            const isCollapsed = normalizedSearchTerm ? false : !!collapsedSections[section.id];
            return (
              <section key={section.id} className={`rap-secondary-nav-section ${isCollapsed ? 'is-collapsed' : ''}`}>
                <button
                  type="button"
                  className="rap-secondary-nav-section-header"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`secondary-nav-section-${section.id}`}
                >
                  <h3>{section.label}</h3>
                  <span className="rap-secondary-nav-section-meta">
                    <span className="rap-secondary-nav-section-count">{section.items.length}</span>
                    <span className="rap-secondary-nav-section-chevron" aria-hidden="true">▾</span>
                  </span>
                </button>
                <div
                  id={`secondary-nav-section-${section.id}`}
                  className={`rap-secondary-nav-items-wrap ${isCollapsed ? 'is-collapsed' : ''}`}
                  aria-hidden={isCollapsed}
                >
                  <div className="rap-secondary-nav-items" role="list">
                    {section.items.map((item) => (
                      <NavigationLink
                        key={item.id}
                        to={item.path}
                        className={`rap-secondary-nav-item ${pathMatches(item.path, currentPath) ? 'is-active' : ''}`}
                      >
                        <span className="rap-secondary-nav-item-label">{item.label}</span>
                        {item.badge ? <span className="rap-secondary-nav-item-badge">{item.badge}</span> : null}
                      </NavigationLink>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
          {filteredSections.length === 0 ? (
            <div className="rap-secondary-nav-empty">Nenhum item encontrado para "{searchTerm}".</div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export default SecondaryNav;
