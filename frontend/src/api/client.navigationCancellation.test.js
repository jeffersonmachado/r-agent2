import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../utils/logger';
import {
  installNavigationCancellationGuards,
  isNavigatingAway,
  markNavigatingAway,
  resetNavigatingAway,
} from './navigationCancellation';
import { fetchJson } from './client';

/**
 * Cancelamento por navegação (pagehide/beforeunload).
 *
 * Quando o documento é descartado (navegação full-page, fechamento de aba), o
 * browser aborta as requisições em voo. Isso é cancelamento intencional, não
 * falha da API: não deve gerar log de erro nem toast/estado de erro para o
 * usuário. Regressão: `validate:runtime` contava esses logs como erros de
 * console na rota seguinte.
 */

function setFetchRejectingNetworkError() {
  // @ts-ignore
  global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

function isPending(promise, ms = 40) {
  return new Promise((resolve) => {
    let settled = false;
    promise.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    setTimeout(() => resolve(!settled), ms);
  });
}

describe('navigationCancellation - estado de navegação', () => {
  afterEach(() => {
    resetNavigatingAway();
  });

  it('marca navegação em pagehide e reseta em pageshow restaurado', () => {
    const listeners = {};
    const fakeWindow = {
      addEventListener: (type, handler) => { listeners[type] = handler; },
    };

    expect(isNavigatingAway()).toBe(false);
    installNavigationCancellationGuards(fakeWindow);

    listeners.pagehide();
    expect(isNavigatingAway()).toBe(true);

    // pageshow não-restaurado (carregamento normal) mantém o estado.
    listeners.pageshow({ persisted: false });
    expect(isNavigatingAway()).toBe(true);

    // pageshow restaurado (bfcache) volta ao estado normal.
    listeners.pageshow({ persisted: true });
    expect(isNavigatingAway()).toBe(false);
  });

  it('não marca navegação em beforeunload (evento cancelável mascararia falhas reais)', () => {
    const listeners = {};
    const fakeWindow = {
      addEventListener: (type, handler) => { listeners[type] = handler; },
    };

    installNavigationCancellationGuards(fakeWindow);

    // beforeunload é cancelável pelo usuário ("sair do site?"). Se marcasse
    // navegação e o usuário cancelasse, toda falha de rede seguinte ficaria
    // silenciada. pagehide cobre o caso real (documento sendo descartado).
    expect(listeners.beforeunload).toBeUndefined();
    expect(isNavigatingAway()).toBe(false);
  });
});

describe('api/client - cancelamento por navegação', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    setFetchRejectingNetworkError();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    resetNavigatingAway();
    vi.resetAllMocks();
  });

  it('não loga erro nem entrega falha ao chamador quando o documento está sendo descartado', async () => {
    markNavigatingAway();

    const pending = fetchJson('/system/status');

    expect(await isPending(pending)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('aborta as requisições em voo ao sair da página, sem logar erro', async () => {
    let capturedSignal = null;
    // @ts-ignore
    global.fetch = vi.fn((_url, init) => {
      capturedSignal = init && init.signal;
      return new Promise((_resolve, reject) => {
        if (capturedSignal) {
          capturedSignal.addEventListener('abort', () => reject(capturedSignal.reason));
        }
      });
    });

    const listeners = {};
    const fakeWindow = { addEventListener: (type, handler) => { listeners[type] = handler; } };
    installNavigationCancellationGuards(fakeWindow);

    const pending = fetchJson('/system/status');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(capturedSignal).toBeTruthy();
    expect(capturedSignal.aborted).toBe(false);

    listeners.pagehide();

    expect(capturedSignal.aborted).toBe(true);
    expect(await isPending(pending)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('mantém o comportamento normal (log + rejeição) para falha de rede genuína sem navegação', async () => {
    await expect(fetchJson('/system/status')).rejects.toBeInstanceOf(TypeError);
    expect(errorSpy).toHaveBeenCalled();
  });
});
