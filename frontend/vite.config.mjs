import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { vitePluginCommonJS } from './vite-plugin-commonjs.js';

// Plugin para interceptar rotas de página do frontend antes do proxy
function frontendRoutesPlugin() {
  return {
    name: 'frontend-routes',
    configureServer(server) {
      // Rotas de página do frontend que não devem ser proxyadas
      const frontendRoutes = ['/config', '/support', '/maintenance', '/editor'];
      
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        
        // Ignora rotas da API - deixa o proxy lidar com elas
        const isApiRoute = url.startsWith('/tickets') || 
                          url.startsWith('/queues') || 
                          url.startsWith('/flows') || 
                          url.startsWith('/health') || 
                          url.startsWith('/version') || 
                          url.startsWith('/replay') || 
                          url.startsWith('/templates') || 
                          url.startsWith('/server') || 
                          url.startsWith('/api') ||
                          url.startsWith('/metrics');
        
        if (isApiRoute) {
          // Deixa o proxy lidar com rotas da API
          return next();
        }
        
        // Se for uma rota de página do frontend e for GET de navegação
        if (req.method === 'GET' && frontendRoutes.includes(url)) {
          const acceptHeader = req.headers.accept || '';
          const isNavigation = acceptHeader.includes('text/html') && 
                               !acceptHeader.includes('application/json');
          
          if (isNavigation) {
            // Serve o index.html para SPA routing
            req.url = '/index.html';
          }
        }
        
        next();
      });
    },
  };
}

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
const viteConfig = defineConfig({
  plugins: [
    react({
      // Permite Fast Refresh para arquivos que exportam hooks customizados
      // junto com componentes (como Context Providers)
      fastRefresh: true,
    }),
    // Plugin customizado para processar CommonJS do backend
    vitePluginCommonJS(),
    // Plugin para interceptar rotas de página do frontend
    frontendRoutesPlugin(),
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
    // Proxy para API em desenvolvimento (quando VITE_API_BASE_URL não está configurado)
    proxy: process.env.VITE_API_BASE_URL ? {} : {
      // Rotas da API que devem ser proxyadas
      // Usa regex explícitas para garantir que rotas aninhadas sejam capturadas
      '^/tickets': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/queues': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/flows': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/health': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/version': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/replay': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/templates': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/server': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/api': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/metrics': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      // Rota específica para /config da API
      // Faz proxy apenas para requisições de API (não navegação)
      '^/config$': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
        bypass(req, res, options) {
          // Se for GET de navegação, o plugin frontend-routes já lidou com isso
          // Aqui só fazemos proxy para requisições de API
          if (req.method === 'GET') {
            const acceptHeader = req.headers.accept || '';
            const isNavigation = acceptHeader.includes('text/html') && 
                                 !acceptHeader.includes('application/json');
            
            if (isNavigation) {
              // Não faz proxy - o plugin já serviu o index.html
              return false;
            }
          }
          
          // Para outros métodos (POST, PUT, DELETE) ou GET com Accept: application/json, faz proxy
          return undefined;
        },
      },
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

export default viteConfig;
