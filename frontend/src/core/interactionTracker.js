/**
 * Learning Core — Interaction Tracker.
 *
 * Telemetria de interação do usuário na UI (Fase 0 do Learning Core).
 * Alimenta o Competency Engine: navegação (rota + tempo por tela), cliques
 * em alvos identificáveis (data-testid/aria-label — nunca texto digitado)
 * e chamadas de API (path, duração, status — nunca payload).
 *
 * Privacidade por desenho: nenhum valor de campo, texto, body ou resposta
 * é capturado. Apenas metadados estruturais.
 *
 * Feature flag: `learningCoreEnabled` (featuresConfig) — default desligado.
 * Envio em batch (10s ou 20 eventos) para POST /api/learning/interactions.
 */

import { fetchJson } from '../api/client';
import { getFeature } from '../utils/featuresConfig';

const ROUTE_CHANGE_EVENT = 'router:change';
const FLUSH_INTERVAL_MS = 10000;
const FLUSH_THRESHOLD = 20;
const INGEST_PATH = '/api/learning/interactions';
const SESSION_STORAGE_KEY = 'learning_core_session_id';

let trackerState = null;

function getSessionId() {
  let id = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  }
  return id;
}

function normalizePathname(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    let pathname = parsed.pathname || '/';
    const base = '/r-agent2';
    if (pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length) || '/';
    return pathname.slice(0, 200);
  } catch {
    return null;
  }
}

function describeClickTarget(element) {
  if (!(element instanceof Element)) return null;
  const withTestId = element.closest('[data-testid]');
  if (withTestId) return `testid:${withTestId.getAttribute('data-testid')}`.slice(0, 120);
  const withAria = element.closest('[aria-label]');
  if (withAria) return `aria:${withAria.getAttribute('aria-label')}`.slice(0, 120);
  const clickable = element.closest('button, a, [role="button"], input, select, textarea');
  if (!clickable) return null;
  const parts = [clickable.tagName.toLowerCase()];
  const type = clickable.getAttribute('type');
  const name = clickable.getAttribute('name');
  if (type) parts.push(`type=${type}`);
  if (name) parts.push(`name=${name}`);
  return parts.join(':').slice(0, 120);
}

function createEvent(type, data = {}) {
  const state = trackerState;
  if (!state) return;
  state.eventSeq += 1;
  state.buffer.push({
    type,
    clientEventId: `${state.sessionId}-${state.eventSeq}`,
    occurredAt: new Date().toISOString(),
    route: normalizePathname(window.location.href),
    ...data,
  });
  if (state.buffer.length >= FLUSH_THRESHOLD) {
    state.flush();
  }
}

function getAuthToken() {
  try {
    return window.localStorage.getItem('auth_token') || null;
  } catch {
    return null;
  }
}

/**
 * Flush via sendBeacon: canal padrão da telemetria. O browser enfileira o
 * POST e ele sobrevive a navegações/unload — fetch in-flight (mesmo com
 * keepalive) é abortado nesse cenário, o que derruba gates de runtime
 * (net::ERR_ABORTED) e perde eventos. Como o beacon não permite headers,
 * o token vai no body (o endpoint aceita essa alternativa somente para
 * telemetria). Trade-off assumido: beacon não expõe falha de servidor —
 * telemetria é best-effort por desenho.
 */
function flushWithBeacon(state, events) {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false;
  }
  const payload = JSON.stringify({
    sessionId: state.sessionId,
    events,
    token: getAuthToken(),
  });
  try {
    const blob = new Blob([payload], { type: 'application/json' });
    return navigator.sendBeacon(INGEST_PATH, blob);
  } catch {
    return false;
  }
}

async function flushBuffer() {
  const state = trackerState;
  if (!state || state.buffer.length === 0 || state.flushing) return;
  const events = state.buffer.splice(0, state.buffer.length);

  if (flushWithBeacon(state, events)) {
    return;
  }

  state.flushing = true;
  try {
    await fetchJson(INGEST_PATH, {
      method: 'POST',
      silent: true,
      suppressErrorLog: true,
      keepalive: true,
      body: JSON.stringify({ sessionId: state.sessionId, events }),
    });
  } catch (error) {
    // Telemetria nunca quebra a aplicação; perda é explícita no console.
    if (!state.warnedOnce) {
      state.warnedOnce = true;
      console.warn('[interactionTracker] ingest indisponível — eventos descartados:', error?.message);
    }
  } finally {
    state.flushing = false;
  }
}

function handleRouteChange() {
  const state = trackerState;
  if (!state) return;
  const now = Date.now();
  const durationMs = state.routeEnteredAt ? now - state.routeEnteredAt : null;
  state.routeEnteredAt = now;
  createEvent('navigation', {
    route: normalizePathname(window.location.href),
    durationMs,
  });
}

function handleClick(event) {
  const target = describeClickTarget(event.target);
  if (!target) return;
  createEvent('click', { target });
}

function installFetchObserver() {
  const state = trackerState;
  const originalFetch = window.fetch;
  const boundFetch = originalFetch.bind(window);
  state.originalFetch = originalFetch;

  window.fetch = async function observedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const pathname = typeof url === 'string' ? normalizePathname(url) : null;
    const isApiCall = pathname && pathname.startsWith('/api/');
    const isIngest = pathname === INGEST_PATH;

    if (!isApiCall || isIngest) {
      return boundFetch(input, init);
    }

    const startedAt = Date.now();
    try {
      const response = await boundFetch(input, init);
      if (response.status >= 400) {
        createEvent('api_call', {
          target: `${(init?.method || 'GET').toUpperCase()} ${pathname}`,
          durationMs: Date.now() - startedAt,
          status: String(response.status),
          errorCode: `http_${response.status}`,
        });
      }
      return response;
    } catch (error) {
      createEvent('api_call', {
        target: `${(init?.method || 'GET').toUpperCase()} ${pathname}`,
        durationMs: Date.now() - startedAt,
        status: 'network_error',
        errorCode: 'network_error',
      });
      throw error;
    }
  };
}

/**
 * Inicializa o tracker se a feature flag estiver habilitada.
 * Idempotente; retorna true se ativado.
 */
export async function initInteractionTracker() {
  if (trackerState) return true;

  const enabled = await getFeature('learningCoreEnabled', false).catch(() => false);
  if (!enabled) return false;

  const state = {
    sessionId: getSessionId(),
    buffer: [],
    eventSeq: 0,
    flushing: false,
    warnedOnce: false,
    routeEnteredAt: Date.now(),
    originalFetch: null,
    intervalId: null,
    flush: flushBuffer,
  };
  trackerState = state;

  window.addEventListener(ROUTE_CHANGE_EVENT, handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);
  window.addEventListener('pagehide', handlePageHide);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  installFetchObserver();

  state.intervalId = window.setInterval(flushBuffer, FLUSH_INTERVAL_MS);

  // Evento inicial: entrada na rota corrente.
  createEvent('navigation', { route: normalizePathname(window.location.href), durationMs: null });
  return true;
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flushBuffer();
  }
}

function handlePageHide() {
  flushBuffer();
}

export function stopInteractionTracker() {
  const state = trackerState;
  if (!state) return;
  window.removeEventListener(ROUTE_CHANGE_EVENT, handleRouteChange);
  window.removeEventListener('popstate', handleRouteChange);
  window.removeEventListener('pagehide', handlePageHide);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (state.originalFetch) window.fetch = state.originalFetch;
  if (state.intervalId) window.clearInterval(state.intervalId);
  trackerState = null;
}

/**
 * API pública para eventos de fluxo (Fase 1+): flow_completed, flow_abandoned, error.
 */
export function trackLearningEvent(type, data = {}) {
  if (!trackerState) return;
  if (!['flow_completed', 'flow_abandoned', 'error'].includes(type)) return;
  createEvent(type, data);
}

export function isInteractionTrackerActive() {
  return trackerState !== null;
}
