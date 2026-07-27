'use strict';

/**
 * frontendRouteScanner — inventário estático das páginas/rotas do frontend.
 *
 * Fontes:
 *  - `frontend/src/main.jsx`: paths referenciados via `isRoute('/x')`,
 *    `currentPath === '/x'`, `currentPath.startsWith('/x')` e os arrays
 *    literais `protectedRoutes`/`publicRoutes`.
 *  - `frontend/src/navigation/menu.js`: array `navigationMenu` (literal de
 *    dados) com `path`, `roles`, `permission` e `children`. O array é
 *    extraído por matching de colchetes e interpretado como literal JSON5
 *    (o arquivo contém apenas dados nesse array; funções utilitárias do
 *    módulo ficam fora dele).
 *
 * Cada item: `{ id: 'page:/agenda', kind: 'page', path, roles, permission,
 * section, guarded, classification, source }`.
 *
 * Classification (regra documentada):
 *   - DEVELOPMENT: path === '/dev' ou começa com '/dev/', ou o item de menu
 *     tem roles exatamente ['super_admin'] e está sob um ancestral de
 *     engenharia (id contém 'dev', 'engineering' ou 'super-admin').
 *   - SUPPORT: algum segmento do path ou da seção é de suporte/diagnóstico
 *     operacional: 'qa', 'qa-mesh', 'audit', 'diagnostics', 'system-status',
 *     'channel-health'. (A página '/support' — Central de Atendimento — é de
 *     negócio e permanece PRODUCTION.)
 *   - demais: PRODUCTION.
 *
 * `guarded`: true quando o menu restringe o item por roles ou permission
 * (herdados dos ancestrais quando não definidos no próprio item).
 */

const fs = require('fs');
const path = require('path');

const SUPPORT_PATH_SEGMENTS = new Set(['qa', 'qa-mesh', 'audit', 'diagnostics', 'system-status', 'channel-health']);
const ENGINEERING_ANCESTOR_TOKENS = ['dev', 'engineering', 'super-admin'];

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function matchBracket(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extrai e interpreta o literal do array `navigationMenu` de menu.js. */
function extractNavigationMenu(menuSource) {
  const anchor = /navigationMenu\s*=\s*\[/.exec(menuSource);
  if (!anchor) return [];
  const openIndex = menuSource.indexOf('[', anchor.index);
  const closeIndex = matchBracket(menuSource, openIndex);
  if (closeIndex === -1) return [];
  const literal = menuSource.slice(openIndex, closeIndex + 1);
  // O array é um literal de dados puro (sem funções/requires); interpretar como valor.
  // eslint-disable-next-line no-new-func
  return new Function(`"use strict"; return (${literal});`)();
}

/** Achata o menu registrando seção de topo e cadeia de ancestrais. */
function flattenMenu(nodes, context = {}) {
  const entries = [];
  for (const node of nodes || []) {
    const isTopLevel = !context.section;
    const section = isTopLevel ? node.id : context.section;
    const ancestors = [...(context.ancestors || []), node.id];
    const roles = node.roles || context.roles || null;
    const permission = node.permission || context.permission || null;
    if (typeof node.path === 'string') {
      entries.push({
        path: node.path,
        label: node.label || null,
        section,
        ancestors,
        roles,
        permission,
        hiddenInSidebar: Boolean(node.hiddenInSidebar),
      });
    }
    if (Array.isArray(node.children)) {
      entries.push(...flattenMenu(node.children, { section, ancestors, roles, permission }));
    }
  }
  return entries;
}

/**
 * Prefixos de mount de deploy (a app é servida sob este base path em produção).
 * Não são páginas: main.jsx usa startsWith neles apenas para normalizar
 * currentPath. Sem esta exclusão o scanner inventaria itens fantasma
 * (ex.: page:/r-agent2), sempre órfãos.
 */
const DEPLOY_MOUNT_PREFIXES = new Set(['/r-agent2']);

/** Extrai os paths referenciados em main.jsx. */
function extractMainJsxPaths(mainSource) {
  const paths = new Set();
  const patterns = [
    /\bisRoute\(\s*'([^']+)'/g,
    /\bcurrentPath\s*===\s*'(\/[^']*)'/g,
    /\bcurrentPath\.startsWith\(\s*'(\/[^']*)'/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(mainSource)) !== null) {
      paths.add(normalizePath(match[1]));
    }
  }
  for (const arrayName of ['protectedRoutes', 'publicRoutes']) {
    const re = new RegExp(`const\\s+${arrayName}\\s*=\\s*\\[`);
    const anchor = re.exec(mainSource);
    if (!anchor) continue;
    const openIndex = mainSource.indexOf('[', anchor.index);
    const closeIndex = matchBracket(mainSource, openIndex);
    if (closeIndex === -1) continue;
    const body = mainSource.slice(openIndex + 1, closeIndex);
    for (const m of body.matchAll(/'([^']+)'/g)) {
      paths.add(normalizePath(m[1]));
    }
  }
  paths.delete('/');
  for (const mountPrefix of DEPLOY_MOUNT_PREFIXES) paths.delete(mountPrefix);
  return paths;
}

function normalizePath(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/\?$/, '').replace(/\/$/, '');
  return value === '' ? '/' : value;
}

function isEngineeringEntry(menuEntry) {
  if (!menuEntry) return false;
  const exactSuperAdmin = Array.isArray(menuEntry.roles)
    && menuEntry.roles.length === 1
    && menuEntry.roles[0] === 'super_admin';
  if (!exactSuperAdmin) return false;
  return menuEntry.ancestors.some((id) => ENGINEERING_ANCESTOR_TOKENS.some((token) => id.includes(token)));
}

/**
 * Aliases legados (fora do prefixo /dev) que renderizam páginas de engenharia
 * em main.jsx. Classificados DEVELOPMENT para não virarem órfãos PRODUCTION
 * nem ruído na política de visibilidade. Manter sincronizado com
 * PROTECTED_PATH_PREFIXES de frontend/src/utils/menuPermissions.js.
 */
const LEGACY_DEV_PATH_ALIASES = new Set(['/rpa-replays', '/rpa-seeds', '/system-status']);

function hasSupportSegment(value) {
  if (!value) return false;
  return String(value).split('/').filter(Boolean)
    .some((segment) => SUPPORT_PATH_SEGMENTS.has(segment));
}

function classifyPage(pagePath, menuEntry) {
  if (pagePath === '/dev' || pagePath.startsWith('/dev/') || pagePath === '/dev-dashboard') {
    return 'DEVELOPMENT';
  }
  if (LEGACY_DEV_PATH_ALIASES.has(pagePath)) {
    return 'DEVELOPMENT';
  }
  if (isEngineeringEntry(menuEntry)) {
    return 'DEVELOPMENT';
  }
  if (hasSupportSegment(pagePath) || (menuEntry && hasSupportSegment(menuEntry.section))) {
    return 'SUPPORT';
  }
  return 'PRODUCTION';
}

/**
 * @param {{ rootDir: string, mainFile?: string, menuFile?: string }} options
 * @returns {{ items: object[], warnings: string[] }}
 */
function scanFrontendRoutes({ rootDir, mainFile, menuFile }) {
  const mainPath = mainFile || path.join(rootDir, 'frontend', 'src', 'main.jsx');
  const menuPath = menuFile || path.join(rootDir, 'frontend', 'src', 'navigation', 'menu.js');
  const mainSource = readFileSafe(mainPath);
  if (mainSource === null) {
    throw new Error(`main.jsx não encontrado em ${mainPath}`);
  }
  const warnings = [];

  const menuEntries = new Map();
  const menuSource = readFileSafe(menuPath);
  if (menuSource !== null) {
    try {
      for (const entry of flattenMenu(extractNavigationMenu(menuSource))) {
        // Entradas duplicadas no menu: a primeira (mais alta na hierarquia) vence.
        if (!menuEntries.has(entry.path)) menuEntries.set(entry.path, entry);
      }
    } catch (error) {
      warnings.push(`falha ao interpretar navigationMenu: ${error.message}`);
    }
  } else {
    warnings.push(`menu.js não encontrado em ${menuPath}`);
  }

  const paths = extractMainJsxPaths(mainSource);
  for (const menuPathKey of menuEntries.keys()) paths.add(menuPathKey);

  const items = [...paths].sort().map((pagePath) => {
    const menuEntry = menuEntries.get(pagePath) || null;
    const permission = menuEntry && menuEntry.permission
      ? `${menuEntry.permission.resource}:${menuEntry.permission.action}`
      : null;
    return {
      id: `page:${pagePath}`,
      kind: 'page',
      path: pagePath,
      roles: menuEntry ? menuEntry.roles : null,
      permission,
      section: menuEntry ? menuEntry.section : null,
      guarded: Boolean(menuEntry && (menuEntry.roles || menuEntry.permission)),
      classification: classifyPage(pagePath, menuEntry),
      source: 'frontend/src/main.jsx',
    };
  });

  return { items, warnings };
}

module.exports = { scanFrontendRoutes, classifyPage };
