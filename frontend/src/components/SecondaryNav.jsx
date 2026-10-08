import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu, pathMatches } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

function getProjectIdFromPath(path) {
  const match = String(path || '').match(/^\/projects\/([^/]+)/);
  return match?.[1] || null;
}

function buildProjectContextSection(currentPath) {
  const projectId = getProjectIdFromPath(currentPath);
  if (!projectId) return null;

  return {
    id: 'project-context',
    label: 'Projeto atual',
    items: [
      { id: 'project-board', label: 'Quadro', path: `/projects/${projectId}` },
      { id: 'project-list', label: 'Lista', path: `/projects/${projectId}/list` },
      { id: 'project-dashboard', label: 'Painel', path: `/projects/${projectId}/dashboard` },
      { id: 'project-timeline', label: 'Linha do Tempo', path: `/projects/${projectId}/timeline` },
      { id: 'project-gantt', label: 'Gantt', path: `/projects/${projectId}/gantt` },
      { id: 'project-calendar', label: 'Calendário', path: `/projects/${projectId}/calendar` },
      { id: 'project-activities', label: 'Atividades', path: `/projects/${projectId}/activities` },
      { id: 'project-settings', label: 'Configurações', path: `/projects/${projectId}/settings` },
    ],
  };
}

function buildSections(activeArea) {
  if (!activeArea) return [];

  const sections = [];
  const fallbackItems = [];

  const shouldShowInSecondaryNav = (item) => item?.path && !item.hiddenInSubNav;

  // Um grupo vira uma seção com as folhas DIRETAS que contém (rótulo = label do grupo) e
  // delega para os subgrupos. Sem a recursão, um grupo aninhado dentro de outro grupo
  // (ex.: Super Admin → Engineering) era descartado em silêncio: o item era declarado no
  // menu e mesmo assim não existia em nenhuma navegação.
  const collectGroupSections = (group) => {
    const found = [];
    const directItems = (group.children || []).filter(shouldShowInSecondaryNav);
    if (directItems.length > 0) {
      found.push({ id: group.id, label: group.label, items: directItems });
    }
    (group.children || []).forEach((nested) => {
      if (Array.isArray(nested.children) && nested.children.length > 0) {
        found.push(...collectGroupSections(nested));
      }
    });
    return found;
  };

  activeArea.nodes.forEach((node) => {
    if (shouldShowInSecondaryNav(node)) {
      fallbackItems.push(node);
    }

    (node.children || []).forEach((child) => {
      if (Array.isArray(child.children) && child.children.length > 0) {
        sections.push(...collectGroupSections(child));
        return;
      }

      if (shouldShowInSecondaryNav(child)) {
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

export function SecondaryNav({ agent, currentPath, onCollapsedChange, capabilities }) {
  const [searchTerm, setSearchTerm] = useState('');
  // Guarda APENAS a intenção explícita do usuário (`true` = recolhida). O padrão é
  // derivado da rota a cada render — guardar o padrão em estado criava um snapshot que
  // "grudava": a seção que contém a rota ativa ficava recolhida depois da 1ª resolução.
  const [collapsedOverrides, setCollapsedOverrides] = useState({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const prevPathRef = useRef(currentPath);

  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu, capabilities), [agent, capabilities]);
  const { activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const sections = useMemo(() => buildSections(activeArea), [activeArea]);
  const projectContextSection = useMemo(() => buildProjectContextSection(currentPath), [currentPath]);
  const sectionsWithContext = useMemo(
    () => (projectContextSection ? [projectContextSection, ...sections] : sections),
    [projectContextSection, sections],
  );

  // Item ativo = match MAIS ESPECÍFICO. `pathMatches` é por prefixo (`/dev` casa
  // `/dev/engineering`), então sem isso dois itens da mesma área ficam marcados como
  // ativos ao mesmo tempo e a seção errada abre por padrão.
  const activeItemPath = useMemo(() => {
    const paths = sectionsWithContext
      .flatMap((section) => section.items.map((item) => item.path))
      .filter(Boolean);
    return paths
      .filter((path) => pathMatches(path, currentPath))
      .sort((left, right) => right.length - left.length)[0] || null;
  }, [sectionsWithContext, currentPath]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1080px)');
    const handleViewportChange = (event) => {
      setIsMobileViewport(event.matches);
      setIsMobilePanelOpen(!event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);
    setIsMobilePanelOpen(!mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  useEffect(() => {
    if (searchTerm.trim()) {
      setIsMobilePanelOpen(true);
    }
  }, [searchTerm]);

  // Abre o painel sempre que a rota mudar — garante que clique no rail sempre exibe o menu secundário.
  useEffect(() => {
    if (currentPath !== prevPathRef.current) {
      prevPathRef.current = currentPath;
      setIsMobilePanelOpen(true);
    }
  }, [currentPath]);

  useEffect(() => {
    if (!isMobilePanelOpen) return undefined;

    const handleOutsideClick = (event) => {
      const panel = event.target?.closest?.('.rap-secondary-nav');
      // Cliques no PrimaryRail nunca devem fechar o menu secundário —
      // a navegação via rail sempre deve abrir/manter o menu visível.
      const rail = event.target?.closest?.('.rap-primary-rail');
      if (!panel && !rail) {
        setIsMobilePanelOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [isMobilePanelOpen]);

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedSearchTerm) {
      return sectionsWithContext;
    }

    return sectionsWithContext
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
  }, [sectionsWithContext, normalizedSearchTerm]);

  /** Seção recolhida? Override do usuário vence; sem override, a 1ª seção e a seção da
   *  rota atual abrem. Derivado a cada render, então acompanha a navegação. */
  function isSectionCollapsed(section, index) {
    const override = collapsedOverrides[section.id];
    if (typeof override === 'boolean') return override;
    const containsActiveItem = section.items.some((item) => item.path && item.path === activeItemPath);
    return !(index === 0 || containsActiveItem);
  }

  function toggleSection(section, index) {
    const nextCollapsed = !isSectionCollapsed(section, index);
    setCollapsedOverrides((previous) => ({
      ...previous,
      ...(isMobileViewport
        ? sectionsWithContext.reduce((accumulator, item) => {
            accumulator[item.id] = item.id !== section.id;
            return accumulator;
          }, {})
        : {}),
      [section.id]: isMobileViewport ? false : nextCollapsed,
    }));
  }

  function handleItemClick() {
    setIsMobilePanelOpen(false);
  }

  const isSecondaryBodyCollapsed = !isMobilePanelOpen;

  useEffect(() => {
    onCollapsedChange?.(isSecondaryBodyCollapsed);
  }, [isSecondaryBodyCollapsed, onCollapsedChange]);

  return (
    <aside className={`rap-secondary-nav ${isSecondaryBodyCollapsed ? 'is-panel-collapsed' : ''}`} aria-label="Navegação secundária">
      <header className="rap-secondary-nav-header">
        <p className="rap-secondary-nav-kicker">Área ativa</p>
        <h2>{activeArea?.label || 'Navegação'}</h2>
        <p>{activeArea?.description || 'Selecione um módulo para continuar.'}</p>
        <button
          type="button"
          className="rap-secondary-nav-mobile-toggle"
          onClick={() => setIsMobilePanelOpen((previous) => !previous)}
          aria-expanded={!isSecondaryBodyCollapsed}
          aria-controls="secondary-nav-body"
        >
          <span>{isSecondaryBodyCollapsed ? 'Abrir menu da area' : 'Recolher menu da area'}</span>
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
            aria-label="Buscar itens do menu secundário"
          />
        </div>

        <div className="rap-secondary-nav-scroll">
          {filteredSections.map((section, index) => {
            const isCollapsed = normalizedSearchTerm ? false : isSectionCollapsed(section, index);
            return (
              <section key={section.id} className={`rap-secondary-nav-section ${isCollapsed ? 'is-collapsed' : ''}`}>
                <button
                  type="button"
                  className="rap-secondary-nav-section-header"
                  onClick={() => toggleSection(section, index)}
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
                        className={`rap-secondary-nav-item ${item.path === activeItemPath ? 'is-active' : ''}`}
                        onClick={handleItemClick}
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
