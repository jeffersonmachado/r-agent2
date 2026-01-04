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
      const frontendRoutes = ['/config', '/support', '/maintenance', '/editor', '/audit', '/agents', '/login', '/web-scraping', '/rpa-test', '/chat'];
      
      // IMPORTANTE: Este middleware deve ser executado ANTES do proxy do Vite
      // Para garantir que rotas de API sejam passadas adiante sem modificação
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        
        // CRÍTICO: Ignora requisições do Vite (HMR, WebSocket, etc)
        // O Vite usa rotas que começam com /@ para HMR e WebSocket para hot reload
        if (url.startsWith('/@') || 
            req.headers.upgrade === 'websocket' ||
            url.includes('?token=')) {
          // Deixa o Vite lidar com suas próprias requisições
          return next();
        }
        
        // Ignora rotas da API - deixa o proxy lidar com elas
        // IMPORTANTE: 
        // - /audit/logs e /audit/stats são rotas de API, mas /audit é rota de página
        // - /web-scraping/scrape e /web-scraping/scrape-batch são rotas de API, mas /web-scraping é rota de página
        // - /rpa/* são rotas de API (RPA recordings, execute, etc)
        const isApiRoute = url.startsWith('/tickets') || 
                          url.startsWith('/queues') || 
                          url.startsWith('/flows') || 
                          url.startsWith('/health') || 
                          url.startsWith('/version') || 
                          url.startsWith('/replay') || 
                          url.startsWith('/templates') || 
                          url.startsWith('/server') || 
                          url.startsWith('/api') ||
                          url.startsWith('/metrics') ||
                          url.startsWith('/auth') ||
                          (url.startsWith('/rpa/') && url !== '/rpa-test') || // /rpa/recordings é API, mas /rpa-test é página
                          (url.startsWith('/web-scraping/') && url !== '/web-scraping') || // /web-scraping/scrape é API
                          (url.startsWith('/audit/') && url !== '/audit'); // /audit/logs, /audit/stats são API
        
        // Para rotas de API (especialmente DELETE, POST, PUT), não faz nada e deixa o proxy lidar
        // O proxy do Vite será aplicado depois deste middleware
        if (isApiRoute) {
          // Deixa o proxy lidar com rotas da API - não modifica nada, apenas passa adiante
          return next();
        }
        
        // Se for uma rota de página do frontend e for GET
        if (req.method === 'GET') {
          const acceptHeader = req.headers.accept || '';
          const isNavigation = acceptHeader.includes('text/html') || 
                               !acceptHeader.includes('application/json');
          
          // Se for navegação (não é API e não é arquivo estático)
          // Serve index.html para todas as rotas do frontend (SPA routing)
          if (!isApiRoute && !url.includes('.') && !url.startsWith('/@')) {
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
    // Configuração explícita do HMR (Hot Module Replacement)
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: Number(process.env.FRONTEND_PORT || config.frontend?.port || 5173),
      clientPort: Number(process.env.FRONTEND_PORT || config.frontend?.port || 5173),
    },
    // Proxy para API em desenvolvimento
    // Em desenvolvimento, sempre usamos proxy para garantir que funcione corretamente
    // mesmo se VITE_API_BASE_URL estiver definido (pode estar vindo de config.json)
    proxy: process.env.NODE_ENV === 'production' && process.env.VITE_API_BASE_URL ? {} : {
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
      '^/tests': {
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
      '^/auth': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/rpa': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
        bypass(req, res, options) {
          // Se for GET de navegação para /rpa-test (sem subcaminho), serve index.html
          if (req.method === 'GET' && req.url === '/rpa-test') {
            const acceptHeader = req.headers.accept || '';
            const isNavigation = acceptHeader.includes('text/html') && 
                                 !acceptHeader.includes('application/json');
            
            if (isNavigation) {
              // Não faz proxy - o plugin frontend-routes já serviu o index.html
              return false;
            }
          }
          
          // Para /rpa/recordings, /rpa/execute ou outros métodos, faz proxy para API
          return undefined;
        },
      },
      '^/web-scraping': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
        bypass(req, res, options) {
          // Se for GET de navegação para /web-scraping (sem subcaminho), serve index.html
          if (req.method === 'GET' && req.url === '/web-scraping') {
            const acceptHeader = req.headers.accept || '';
            const isNavigation = acceptHeader.includes('text/html') && 
                                 !acceptHeader.includes('application/json');
            
            if (isNavigation) {
              // Não faz proxy - o plugin frontend-routes já serviu o index.html
              return false;
            }
          }
          
          // Para /web-scraping/scrape, /web-scraping/scrape-batch ou outros métodos, faz proxy para API
          return undefined;
        },
      },
      '^/audit': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
        bypass(req, res, options) {
          // Se for GET de navegação para /audit (sem subcaminho), serve index.html
          if (req.method === 'GET' && req.url === '/audit') {
            const acceptHeader = req.headers.accept || '';
            const isNavigation = acceptHeader.includes('text/html') && 
                                 !acceptHeader.includes('application/json');
            
            if (isNavigation) {
              // Não faz proxy - o plugin frontend-routes já serviu o index.html
              return false;
            }
          }
          
          // Para /audit/logs, /audit/stats ou outros métodos, faz proxy para API
          return undefined;
        },
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
