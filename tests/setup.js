/**
 * Setup global para testes Jest - proteção contra travamentos
 */

process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_INIT = 'true';
// Assinaturas de replay são obrigatórias. Testes usam uma chave isolada,
// explícita e sem qualquer relação com segredos de runtime.
process.env.REPLAY_SIGNING_KEY = process.env.REPLAY_SIGNING_KEY
  || 'jest-only-replay-signing-key-32-bytes-minimum';
process.env.RAG_INTERNAL_TOKEN = process.env.RAG_INTERNAL_TOKEN
  || 'jest-only-rag-internal-token-32-bytes-minimum';
// Chave de criptografia em repouso: testes usam uma chave isolada, explícita e
// sem relação com segredos de runtime (necessária para cifrar credenciais de
// integração em testes de conexão).
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || Buffer.alloc(32, 'jest-only-encryption-key-32bytes').toString('base64');

// Isolamento do runtime root para testes (fora do workspace, em /tmp).
require('../api/utils/runtimePaths').configureRuntimeRoot('/tmp/r-agent2-test-runtime');

// Timeout global para hooks
jest.setTimeout(10000);

// Limpeza após cada teste
afterEach(() => {
  // Limpa todos os timers
  jest.clearAllTimers();
  
  // Limpa mocks
  jest.clearAllMocks();
  
  // Limpa localStorage se disponível
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  
  // Limpa sessionStorage se disponível
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
});

// Finaliza WebSocket no fim de cada arquivo de teste
afterAll(async () => {
  try {
    const websocketServicePath = require.resolve('../api/services/websocketService');
    if (!require.cache[websocketServicePath]) {
      return;
    }

    const { shutdownWebSocket } = require(websocketServicePath);
    await shutdownWebSocket();
  } catch (err) {
    // best-effort
  }
});

// Proteção contra promises não resolvidas
const pendingPromises = new Set();

// Intercepta Promise.all para rastrear promises pendentes
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
    pendingPromises.clear();
  }
});

// Proteção contra intervalos não limpos
const intervals = new Set();
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

global.setInterval = function(...args) {
  const id = originalSetInterval.apply(this, args);
  intervals.add(id);
  return id;
};

global.clearInterval = function(id) {
  intervals.delete(id);
  return originalClearInterval.call(this, id);
};

// Limpa intervalos após cada teste
afterEach(() => {
  intervals.forEach(id => {
    try {
      originalClearInterval.call(global, id);
    } catch (e) {
      // Ignora erros
    }
  });
  intervals.clear();
});

// Proteção contra timeouts não limpos
const timeouts = new Set();
const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;

global.setTimeout = function(...args) {
  const id = originalSetTimeout.apply(this, args);
  timeouts.add(id);
  return id;
};

global.clearTimeout = function(id) {
  timeouts.delete(id);
  return originalClearTimeout.call(this, id);
};

// Limpa timeouts após cada teste
afterEach(() => {
  timeouts.forEach(id => {
    try {
      originalClearTimeout.call(global, id);
    } catch (e) {
      // Ignora erros
    }
  });
  timeouts.clear();
});

if (process.env.DEBUG_TEST_SETUP === 'true') {
  console.log('✅ Proteções contra travamentos ativadas nos testes Jest');
}
