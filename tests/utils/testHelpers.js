/**
 * Utilitários para testes com proteção contra travamentos
 */

/**
 * Wrapper para testes com timeout e cleanup garantido
 */
function withTimeout(testFn, timeout = 10000) {
  return async (...args) => {
    const timeoutId = setTimeout(() => {
      throw new Error(`Teste travou após ${timeout}ms`);
    }, timeout);
    
    try {
      await testFn(...args);
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

/**
 * Executa função assíncrona com timeout
 */
async function runWithTimeout(asyncFn, timeout = 5000) {
  return Promise.race([
    asyncFn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operação travou após ${timeout}ms`)), timeout)
    ),
  ]);
}

/**
 * Limpa recursos após teste
 */
function cleanupAfterTest() {
  // Limpa todos os timers pendentes
  jest.clearAllTimers();
  
  // Limpa mocks
  jest.clearAllMocks();
  
  // Limpa localStorage
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  
  // Limpa sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
}

/**
 * Proteção contra loops infinitos
 */
function withLoopProtection(testFn, maxIterations = 100) {
  return async (...args) => {
    let iterations = 0;
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
function safeTest(name, testFn, timeout = 10000) {
  return test(name, withTimeout(withLoopProtection(testFn), timeout), timeout);
}

module.exports = {
  withTimeout,
  runWithTimeout,
  cleanupAfterTest,
  withLoopProtection,
  safeTest,
};

