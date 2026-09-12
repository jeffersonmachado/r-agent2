/**
 * Registro de TELAS do "Perguntar à IA".
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): o contexto de tela era derivado de
 * `window.location.pathname` com uma heurística crua ("primeiro segmento =
 * módulo") e o widget NÃO reagia à navegação SPA (`router:change`) — só a
 * `popstate`/`hashchange`. Resultado: ao clicar no menu, o copiloto continuava
 * respondendo no contexto da tela anterior.
 *
 * Aqui o vocabulário de telas é DERIVADO da navegação canônica
 * (`navigation/menu.js`) — o mesmo arquivo que gera o menu. Não existe lista
 * paralela para divergir: uma tela nova no menu passa a ser reconhecida aqui
 * automaticamente.
 *
 * Regra de resolução:
 *   1. rota exatamente igual a uma entrada do menu  → `pageType: 'index'`
 *   2. rota que ESTENDE uma entrada conhecida        → `detail` (1 nível) ou
 *      `nested` (2+ níveis), herdando o módulo da entrada base
 *   3. rota desconhecida                             → módulo do 1º segmento,
 *      `pageType` por profundidade (nunca inventamos um módulo)
 *
 * O resultado é sempre uma DICA: o backend valida forma, vocabulário e posse.
 */

import { navigationMenu } from '../navigation/menu';

const MAX_ROUTE_LENGTH = 200;

function sanitizeSegment(segment) {
  return String(segment || '').replace(/[^A-Za-z0-9._-]/g, '');
}

/** Normaliza o pathname para comparação: sem query/hash, sem barra final. */
export function normalizeRoute(pathname) {
  const raw = String(pathname || '/');
  const withoutQuery = raw.split('?')[0].split('#')[0];
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const trimmed = withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
  return (trimmed || '/').slice(0, MAX_ROUTE_LENGTH);
}

function flattenMenu(items, trail = [], output = []) {
  for (const item of items || []) {
    const nextTrail = [...trail, item.id].filter(Boolean);
    if (item.path) {
      output.push({
        path: normalizeRoute(item.path),
        id: item.id,
        label: item.label || null,
        areaId: trail[0] || item.id || null,
        groupId: trail[trail.length - 1] || null,
        trail: nextTrail,
      });
    }
    if (Array.isArray(item.children) && item.children.length > 0) {
      flattenMenu(item.children, nextTrail, output);
    }
  }
  return output;
}

/** Índice rota → entrada canônica do menu. Exportado para teste/inspeção. */
export function buildScreenIndex() {
  const index = new Map();
  for (const entry of flattenMenu(navigationMenu)) {
    // Primeira declaração vence: o menu pode repetir um path em áreas
    // diferentes (ex.: /workspace), e a ordem do arquivo é a autoridade.
    if (!index.has(entry.path)) index.set(entry.path, entry);
  }
  return index;
}

const SCREEN_INDEX = buildScreenIndex();

function segmentsOf(route) {
  return route.split('/').filter(Boolean).map(sanitizeSegment).filter(Boolean);
}

function moduleOfRoute(route) {
  const first = segmentsOf(route)[0];
  return first || 'root';
}

/**
 * Resolve a tela atual para `{ route, module, pageType }` (+ rótulos do menu).
 *
 * @param {string} pathname
 * @returns {{route: string, module: string, pageType: string, screenId: string|null, areaId: string|null}}
 */
export function resolveScreen(pathname) {
  const route = normalizeRoute(pathname);

  const exact = SCREEN_INDEX.get(route);
  if (exact) {
    return {
      route,
      module: moduleOfRoute(route),
      pageType: 'index',
      screenId: exact.id,
      areaId: exact.areaId,
    };
  }

  // Prefixo conhecido mais longo: herda o módulo da tela base.
  let base = null;
  for (const candidate of SCREEN_INDEX.keys()) {
    if (candidate === '/') continue;
    if (route === candidate || route.startsWith(`${candidate}/`)) {
      if (!base || candidate.length > base.length) base = candidate;
    }
  }

  const segments = segmentsOf(route);
  if (base) {
    const baseSegments = segmentsOf(base).length;
    const extra = segments.length - baseSegments;
    const entry = SCREEN_INDEX.get(base);
    return {
      route,
      module: moduleOfRoute(base),
      pageType: extra <= 1 ? 'detail' : 'nested',
      screenId: entry ? entry.id : null,
      areaId: entry ? entry.areaId : null,
    };
  }

  return {
    route,
    module: moduleOfRoute(route),
    pageType: segments.length > 1 ? 'nested' : 'index',
    screenId: null,
    areaId: null,
  };
}

/** Quantidade de telas canônicas conhecidas (evidência de cobertura). */
export function knownScreenCount() {
  return SCREEN_INDEX.size;
}

export { SCREEN_INDEX };
