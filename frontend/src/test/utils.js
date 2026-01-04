/**
 * Utilitários para testes com proteção contra travamentos
 */

import { act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Wrapper para waitFor com timeout e proteção contra travamentos
 */
export async function waitForWithTimeout(
  callback,
  { timeout = 5000, interval = 50 } = {}
) {
  const startTime = Date.now();
  let lastError;
  
  while (Date.now() - startTime < timeout) {
    try {
      await act(async () => {
        await callback();
      });
      return; // Sucesso
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  throw new Error(
    `waitForWithTimeout falhou após ${timeout}ms: ${lastError?.message || 'Timeout'}`
  );
}

/**
 * Renderiza componente com timeout e cleanup garantido
 */
export async function renderWithTimeout(renderFn, timeout = 5000) {
  const timeoutId = setTimeout(() => {
    throw new Error(`Render travou após ${timeout}ms`);
  }, timeout);
  
  try {
    const result = await Promise.race([
      renderFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout no render')), timeout)
      ),
    ]);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Executa ação assíncrona com timeout
 */
export async function actWithTimeout(asyncFn, timeout = 3000) {
  return Promise.race([
    act(async () => {
      await asyncFn();
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Ação travou após ${timeout}ms`)), timeout)
    ),
  ]);
}

/**
 * Limpa todos os recursos após teste
 */
export function cleanupAfterTest() {
  // Limpa timers
  vi.clearAllTimers();
  
  // Limpa mocks
  vi.clearAllMocks();
  
  // Limpa localStorage
  localStorage.clear();
  
  // Limpa sessionStorage
  sessionStorage.clear();
  
  // Força garbage collection se disponível
  if (global.gc) {
    global.gc();
  }
}

/**
 * Proteção contra loops infinitos em testes
 */
export function withLoopProtection(testFn, maxIterations = 100) {
  let iterations = 0;
  
  return async (...args) => {
    iterations = 0;
    const checkInterval = setInterval(() => {
      iterations++;
      if (iterations > maxIterations) {
        clearInterval(checkInterval);
        throw new Error(
          `Possível loop infinito detectado: ${iterations} iterações`
        );
      }
    }, 100);
    
    try {
      await testFn(...args);
    } finally {
      clearInterval(checkInterval);
    }
  };
}

/**
 * Wrapper para testes com proteção completa
 */
export function safeTest(name, testFn, timeout = 5000) {
  return it(name, async () => {
    const timeoutId = setTimeout(() => {
      throw new Error(`Teste "${name}" travou após ${timeout}ms`);
    }, timeout);
    
    try {
      await testFn();
    } finally {
      clearTimeout(timeoutId);
      cleanupAfterTest();
    }
  }, timeout);
}

