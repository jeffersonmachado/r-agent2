import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared/aiTaskExecutor': join(__dirname, 'src', 'shared', 'aiTaskExecutor.js'),
      '@shared/typeCompatibility': join(__dirname, 'src', 'shared', 'typeCompatibility.js'),
      '@shared/templateRenderer': join(__dirname, 'src', 'shared', 'templateRenderer.js'),
      '@shared/jsonSchemaValidator': join(__dirname, 'src', 'shared', 'jsonSchemaValidator.js'),
    },
  },
  test: {
    // Ambiente de teste - jsdom tem suporte a DOMParser nativo
    environment: 'jsdom',
    
    // Setup files para polyfills
    setupFiles: ['./vitest.setup.js'],
    
    // Timeouts globais para evitar travamentos
    testTimeout: 10000, // 10 segundos por teste
    hookTimeout: 10000, // 10 segundos para hooks (beforeEach, afterEach)
    teardownTimeout: 5000, // 5 segundos para cleanup
    
    // Proteção contra loops infinitos
    bail: 1, // Para após o primeiro teste falhar (útil para debug)
    
    // Limpeza automática
    clearMocks: true,
    restoreMocks: true,
    resetMocks: true,
    
    // Isolamento de testes - desabilitado para compatibilidade
    isolate: false, // Desabilita isolamento para evitar problemas com módulos ESM
    
    // Pool de workers para evitar travamentos
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 2, // Reduzido para evitar problemas de memória
        isolate: false, // Desabilita isolamento para compatibilidade
      },
    },
    
    // Coverage (opcional)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.test.{js,jsx}',
        '**/*.config.{js,jsx}',
        '**/dist/',
        '**/build/',
      ],
    },
    
    // Setup e teardown globais
    setupFiles: ['./src/test/setup.js'],
    
    // Globals
    globals: true,
    
    // Reporters
    reporters: ['verbose', 'junit'],
    outputFile: {
      junit: './test-results/junit.xml',
    },
  },
});
