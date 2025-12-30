import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { vitePluginCommonJS } from './vite-plugin-commonjs.js';

// Lê configuração do backend
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '..', 'api', 'data', 'config.json');

let config = {};
try {
  const configData = readFileSync(configPath, 'utf8');
  config = JSON.parse(configData);
} catch (err) {
  console.warn('Não foi possível carregar config.json, usando valores padrão:', err.message);
}

// Configuração mínima do Vite para o frontend React.
export default defineConfig({
  plugins: [
    react({
      // Permite Fast Refresh para arquivos que exportam hooks customizados
      // junto com componentes (como Context Providers)
      fastRefresh: true,
    }),
    // Plugin customizado para processar CommonJS do backend
    vitePluginCommonJS(),
  ],
  test: {
    // Usamos happy-dom para evitar incompatibilidades ESM com jsdom
    environment: 'happy-dom',
    setupFiles: './src/test/setupTests.js',
  },
  server: {
    port: Number(process.env.FRONTEND_PORT || config.frontend?.port || 5173),
    fs: {
      allow: ['..'],
    },
  },
  // Define variáveis de ambiente para o frontend
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
      process.env.VITE_API_BASE_URL || config.frontend?.apiBaseUrl || ''
    ),
  },
  // Configuração para SPA routing - todas as rotas devem retornar index.html
  // E para tratar arquivos CommonJS do backend
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
    commonjsOptions: {
      // Inclui arquivos CommonJS do backend para serem transformados
      include: [/engine\/utils\/.*\.js$/],
      transformMixedEsModules: true,
    },
  },
  // Resolve alias para importar módulos compartilhados do backend
  // Usa wrappers ES module no frontend que importam CommonJS
  resolve: {
    alias: {
      '@shared/aiTaskExecutor': join(__dirname, 'src', 'shared', 'aiTaskExecutor.js'),
      '@shared/typeCompatibility': join(__dirname, 'src', 'shared', 'typeCompatibility.js'),
      '@shared/templateRenderer': join(__dirname, 'src', 'shared', 'templateRenderer.js'),
      '@shared/jsonSchemaValidator': join(__dirname, 'src', 'shared', 'jsonSchemaValidator.js'),
    },
  },
  // Configuração para permitir importar CommonJS do backend
  optimizeDeps: {
    include: [
      join(__dirname, '..', 'engine', 'utils', 'aiTaskExecutor.js'),
      join(__dirname, '..', 'engine', 'utils', 'typeCompatibility.js'),
      join(__dirname, '..', 'engine', 'utils', 'templateRenderer.js'),
      join(__dirname, '..', 'engine', 'utils', 'jsonSchemaValidator.js'),
    ],
    esbuildOptions: {
      // Permite importar CommonJS e força processamento
      mainFields: ['module', 'main'],
    },
    // Força re-processamento quando os arquivos mudarem
    force: false,
  },
});


