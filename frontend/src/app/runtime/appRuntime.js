import { useEffect } from 'react';
import { resolveDocumentTitle } from '../routes/routeTitles';

function isFilterTitle(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === 'filtros'
    || normalized.startsWith('filtros ')
    || normalized.startsWith('filtros da ')
    || normalized.startsWith('filtros e ');
}

function collectFilterSections(root) {
  const sections = [];
  const candidates = Array.from(root.querySelectorAll('div'));
  for (const container of candidates) {
    if (!(container instanceof HTMLElement)) continue;
    if (container.dataset.autoFilterIgnore === '1') continue;
    if (!container.className || !String(container.className).includes('bg-bg-elevated')) continue;
    if (!container.firstElementChild || container.children.length < 2) continue;

    const titleNodes = container.querySelectorAll('h1, h2, h3, h4, h5, h6, span, strong');
    let titleNode = null;
    for (const node of titleNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (isFilterTitle(node.textContent || '')) {
        titleNode = node;
        break;
      }
    }
    if (!titleNode || titleNode.closest('button')) continue;
    container.classList.add('auto-filter-section');
    sections.push(container);
  }
  return sections;
}

function applyGlobalFilterToggleState(root, sections, expanded) {
  root.dataset.autoFilterExpanded = expanded ? '1' : '0';
  for (const container of sections) {
    container.classList.toggle('auto-filter-collapsed', !expanded);
  }
  const controls = root.querySelector('.support-controls');
  if (!(controls instanceof HTMLElement)) return;
  const btn = controls.querySelector('.auto-filter-toggle-btn');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  btn.title = expanded ? 'Ocultar filtros' : 'Mostrar filtros';
}

function setupAutoCollapsibleFilters(root) {
  if (!root) return;
  const sections = collectFilterSections(root);
  const controls = root.querySelector('.support-controls');
  if (!(controls instanceof HTMLElement) || sections.length === 0) return;

  let toggleButton = controls.querySelector('.auto-filter-toggle-btn');
  if (!(toggleButton instanceof HTMLButtonElement)) {
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'btn-default px-4 py-2 text-sm auto-filter-toggle-btn';
    toggleButton.textContent = '🔍';
    toggleButton.setAttribute('aria-label', 'Mostrar ou ocultar filtros');
    controls.prepend(toggleButton);
    toggleButton.addEventListener('click', () => {
      const expanded = root.dataset.autoFilterExpanded === '1';
      const liveSections = collectFilterSections(root);
      applyGlobalFilterToggleState(root, liveSections, !expanded);
    });
  }

  const shouldExpand = root.dataset.autoFilterExpanded === '1';
  applyGlobalFilterToggleState(root, sections, shouldExpand);
}

let runtimeInstalled = false;

export function installAppRuntimeGuards() {
  if (runtimeInstalled || typeof window === 'undefined') return;
  runtimeInstalled = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    const errorMessage = error?.message || String(error);

    if (
      errorMessage.includes('Cannot read properties of null') ||
      errorMessage.includes("reading 'he'") ||
      (error?.stack && error.stack.includes('rete-auto-arrange-plugin'))
    ) {
      console.warn('Erro do AutoArrangePlugin suprimido:', errorMessage);
      event.preventDefault();
      return;
    }

    originalError('Unhandled promise rejection:', error);
  });

  const shouldSuppressMessage = (message) =>
    (typeof message === 'string' && (
      message.includes('hasSubitems') ||
      message.includes('hasSubitems prop') ||
      message.includes('hassubitems')
    )) ||
    (typeof message === 'object' && message?.message?.includes('hasSubitems'));

  console.error = (...args) => {
    if (shouldSuppressMessage(args[0])) return;
    originalError(...args);
  };

  console.warn = (...args) => {
    if (shouldSuppressMessage(args[0])) return;
    originalWarn(...args);
  };
}

export function useAppRuntime({ currentPath, isAuthenticated }) {
  useEffect(() => {
    installAppRuntimeGuards();
  }, []);

  useEffect(() => {
    document.title = resolveDocumentTitle(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const root = document.querySelector('.support-content-wrapper');
    if (!(root instanceof HTMLElement)) return;

    setupAutoCollapsibleFilters(root);
    const observer = new MutationObserver(() => {
      setupAutoCollapsibleFilters(root);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isAuthenticated, currentPath]);
}
