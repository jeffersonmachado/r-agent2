import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetchJson = vi.fn();
const mockGetFeature = vi.fn();

vi.mock('../api/client', () => ({
  fetchJson: (...args) => mockFetchJson(...args),
}));

vi.mock('../utils/featuresConfig', () => ({
  getFeature: (...args) => mockGetFeature(...args),
}));

import {
  initInteractionTracker,
  stopInteractionTracker,
  isInteractionTrackerActive,
  trackLearningEvent,
} from './interactionTracker';

describe('core/interactionTracker', () => {
  const nativeSendBeacon = window.navigator.sendBeacon;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockFetchJson.mockResolvedValue({ accepted: 1, rejected: 0 });
    mockGetFeature.mockResolvedValue(true);
    // Caminho fetch por padrão nos testes; os testes de beacon definem seu mock.
    Object.defineProperty(window.navigator, 'sendBeacon', { value: undefined, configurable: true });
  });

  afterEach(() => {
    stopInteractionTracker();
    Object.defineProperty(window.navigator, 'sendBeacon', { value: nativeSendBeacon, configurable: true });
  });

  it('nao inicia quando a feature flag esta desligada', async () => {
    mockGetFeature.mockResolvedValue(false);

    const started = await initInteractionTracker();

    expect(started).toBe(false);
    expect(isInteractionTrackerActive()).toBe(false);
  });

  it('inicia quando habilitado e registra evento inicial de navegacao', async () => {
    const started = await initInteractionTracker();

    expect(started).toBe(true);
    expect(isInteractionTrackerActive()).toBe(true);
  });

  it('gera sessionId persistente em sessionStorage', async () => {
    await initInteractionTracker();
    const first = window.sessionStorage.getItem('learning_core_session_id');

    stopInteractionTracker();
    await initInteractionTracker();
    const second = window.sessionStorage.getItem('learning_core_session_id');

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('descarrega buffer ao atingir o limiar de 20 eventos', async () => {
    await initInteractionTracker();

    // 1 evento inicial de navegacao + 18 eventos = 19 no buffer (sem flush)
    for (let i = 0; i < 18; i += 1) {
      trackLearningEvent('flow_completed', { flowId: `f-${i}` });
    }
    expect(mockFetchJson).not.toHaveBeenCalled();

    trackLearningEvent('flow_completed', { flowId: 'f-18' });

    // flush disparado no 20o evento do buffer
    await vi.waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(1));
    const [path, options] = mockFetchJson.mock.calls[0];
    expect(path).toBe('/api/learning/interactions');
    expect(options.keepalive).toBe(true);
    const body = JSON.parse(options.body);
    expect(body.sessionId).toBeTruthy();
    expect(body.events.length).toBe(20);
    expect(body.events[0].type).toBe('navigation');
    expect(body.events.every((e) => e.clientEventId)).toBe(true);
  });

  it('ignora tipos fora da whitelist em trackLearningEvent', async () => {
    await initInteractionTracker();
    stopInteractionTracker();

    trackLearningEvent('navigation', {});
    trackLearningEvent('qualquer-coisa', {});

    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('falha de ingest nao quebra a aplicacao e loga aviso uma unica vez', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchJson.mockRejectedValue(new Error('ingest down'));
    await initInteractionTracker();

    for (let i = 0; i < 40; i += 1) {
      trackLearningEvent('flow_completed', { flowId: `f-${i}` });
    }
    await vi.waitFor(() => expect(mockFetchJson.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('stop restaura fetch original e desativa o tracker', async () => {
    const originalFetch = window.fetch;
    await initInteractionTracker();
    expect(window.fetch).not.toBe(originalFetch);

    stopInteractionTracker();

    expect(window.fetch).toBe(originalFetch);
    expect(isInteractionTrackerActive()).toBe(false);
  });

  it('usa sendBeacon com token no body quando a página fica oculta', async () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    });
    window.localStorage.setItem('auth_token', 'token-beacon');
    await initInteractionTracker();

    trackLearningEvent('flow_completed', { flowId: 'f-beacon' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [path, blob] = sendBeacon.mock.calls[0];
    expect(path).toBe('/api/learning/interactions');
    const payload = JSON.parse(await blob.text());
    expect(payload.token).toBe('token-beacon');
    expect(payload.events.some((e) => e.type === 'flow_completed')).toBe(true);
    expect(mockFetchJson).not.toHaveBeenCalled();

    window.localStorage.removeItem('auth_token');
  });

  it('pagehide também descarrega via beacon', async () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    });
    await initInteractionTracker();

    trackLearningEvent('flow_completed', { flowId: 'f-pagehide' });
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('sem sendBeacon disponível faz fallback para fetch', async () => {
    await initInteractionTracker();
    expect(typeof window.navigator.sendBeacon).not.toBe('function');

    trackLearningEvent('flow_completed', { flowId: 'f-fallback' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    await vi.waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(1));
  });
});
