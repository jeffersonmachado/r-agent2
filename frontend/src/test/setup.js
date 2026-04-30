/**
 * Setup global para testes - proteção contra travamentos
 */

import { beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Limpa o DOM após cada teste
afterEach(() => {
  cleanup();
});

// Proteção global contra timers não limpos
beforeEach(() => {
  // Limpa todos os timers pendentes
  vi.clearAllTimers();
});

afterEach(() => {
  // Restaura timers reais e limpa todos os mocks
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Proteção contra promises não resolvidas
const pendingPromises = new Set();

// Intercepta Promise.all, Promise.race, etc. para rastrear promises pendentes
const originalPromiseAll = Promise.all;
Promise.all = function(...args) {
  const promise = originalPromiseAll.apply(this, args);
  pendingPromises.add(promise);
  promise.finally(() => {
    pendingPromises.delete(promise);
  });
  return promise;
};

// Verifica promises pendentes após cada teste
afterEach(async () => {
  // Aguarda um pouco para promises pendentes se resolverem
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Se ainda houver promises pendentes, loga um aviso
  if (pendingPromises.size > 0) {
    console.warn(`⚠️  ${pendingPromises.size} promise(s) pendente(s) após o teste`);
    // Limpa o set para evitar acúmulo
    pendingPromises.clear();
  }
});

// Proteção contra event listeners não removidos
const originalAddEventListener = window.addEventListener;
const originalRemoveEventListener = window.removeEventListener;
const eventListeners = new Map();

window.addEventListener = function(type, listener, options) {
  if (!eventListeners.has(type)) {
    eventListeners.set(type, new Set());
  }
  eventListeners.get(type).add(listener);
  return originalAddEventListener.call(this, type, listener, options);
};

window.removeEventListener = function(type, listener, options) {
  if (eventListeners.has(type)) {
    eventListeners.get(type).delete(listener);
  }
  return originalRemoveEventListener.call(this, type, listener, options);
};

// Limpa event listeners após cada teste
afterEach(() => {
  eventListeners.forEach((listeners, type) => {
    listeners.forEach(listener => {
      try {
        originalRemoveEventListener.call(window, type, listener);
      } catch (e) {
        // Ignora erros ao remover listeners
      }
    });
  });
  eventListeners.clear();
});

// Proteção contra intervalos não limpos
const intervals = new Set();
const originalSetInterval = window.setInterval;
const originalClearInterval = window.clearInterval;

window.setInterval = function(...args) {
  const id = originalSetInterval.apply(this, args);
  intervals.add(id);
  return id;
};

window.clearInterval = function(id) {
  intervals.delete(id);
  return originalClearInterval.call(this, id);
};

// Limpa intervalos após cada teste
afterEach(() => {
  intervals.forEach(id => {
    try {
      originalClearInterval.call(window, id);
    } catch (e) {
      // Ignora erros
    }
  });
  intervals.clear();
});

// Proteção contra timeouts não limpos
const timeouts = new Set();
const originalSetTimeout = window.setTimeout;
const originalClearTimeout = window.clearTimeout;

window.setTimeout = function(...args) {
  const id = originalSetTimeout.apply(this, args);
  timeouts.add(id);
  return id;
};

window.clearTimeout = function(id) {
  timeouts.delete(id);
  return originalClearTimeout.call(this, id);
};

// Limpa timeouts após cada teste
afterEach(() => {
  timeouts.forEach(id => {
    try {
      originalClearTimeout.call(window, id);
    } catch (e) {
      // Ignora erros
    }
  });
  timeouts.clear();
});

// Proteção contra observadores não desconectados
const observers = new Set();

const originalMutationObserver = window.MutationObserver;
const BaseMutationObserver = originalMutationObserver || class {
  disconnect() {}
};

window.MutationObserver = class extends BaseMutationObserver {
  constructor(...args) {
    super(...args);
    observers.add(this);
  }
  
  disconnect() {
    observers.delete(this);
    return super.disconnect();
  }
};

const originalIntersectionObserver = window.IntersectionObserver;
const BaseIntersectionObserver = originalIntersectionObserver || class {
  disconnect() {}
};

window.IntersectionObserver = class extends BaseIntersectionObserver {
  constructor(...args) {
    super(...args);
    observers.add(this);
  }
  
  disconnect() {
    observers.delete(this);
    return super.disconnect();
  }
};

// Desconecta observadores após cada teste
afterEach(() => {
  observers.forEach(observer => {
    try {
      observer.disconnect();
    } catch (e) {
      // Ignora erros
    }
  });
  observers.clear();
});

// Proteção contra loops infinitos em useEffect (monitoramento passivo)
// Não interceptamos React.useEffect diretamente para evitar quebrar funcionalidades
// Em vez disso, monitoramos via console em modo de desenvolvimento
if (process.env.NODE_ENV === 'test') {
  console.log('⚠️  Proteção contra loops infinitos ativada (monitoramento passivo)');
}

// ---------------------------------------------------------------------------
// Mock global de fetch para evitar tráfego real em localhost durante testes.
// - Testes específicos podem sobrescrever com vi.spyOn/global.fetch.mock...
// - Mantém payload mínimo para /config usado por várias telas/hooks.
// ---------------------------------------------------------------------------
if (typeof globalThis.fetch !== 'function' || !globalThis.fetch.__riaTestDefaultMock) {
  const defaultFetch = vi.fn(async (input) => {
    const rawUrl = typeof input === 'string'
      ? input
      : (input && typeof input === 'object' && 'url' in input ? String(input.url || '') : '');
    const normalizedUrl = String(rawUrl || '');
    const pathname = (() => {
      try {
        const u = new URL(normalizedUrl, 'http://localhost:3000');
        return u.pathname || '/';
      } catch {
        return normalizedUrl.startsWith('/') ? normalizedUrl : `/${normalizedUrl}`;
      }
    })();

    let payload = { ok: true };
    if (pathname === '/config') {
      payload = {
        frontend: {
          enableFileExtraction: true,
          autoExtractFileContent: false,
          autoInferFileCategory: false,
        },
        ai: {},
      };
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  Object.defineProperty(defaultFetch, '__riaTestDefaultMock', { value: true });
  globalThis.fetch = defaultFetch;
}
