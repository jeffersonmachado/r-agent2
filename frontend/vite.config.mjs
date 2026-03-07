import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { vitePluginCommonJS } from './vite-plugin-commonjs.js';

function normalizeBasePath(input) {
  const raw = String(input || '/').trim();
  if (!raw || raw === '/') return '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return `${withLeadingSlash.replace(/\/+$/, '')}/`;
}

// Plugin para interceptar rotas de página do frontend antes do proxy
function frontendRoutesPlugin() {
  return {
    name: 'frontend-routes',
    configureServer(server) {
      // Rotas de página do frontend que não devem ser proxyadas
      const frontendRoutes = ['/config', '/support', '/maintenance', '/editor', '/audit', '/agents', '/login', '/web-scraping', '/rpa-test', '/chat', '/inbox', '/failed-messages', '/agenda'];
      
      // IMPORTANTE: Este middleware deve ser executado ANTES do proxy do Vite
      // Para garantir que rotas de API sejam passadas adiante sem modificação
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url || '';
        const url = requestUrl.split('?')[0] || '';
        
        // CRÍTICO: Ignora requisições do Vite (HMR, WebSocket, etc)
        // O Vite usa rotas que começam com /@ para HMR e WebSocket para hot reload
        if (
          url.startsWith('/@') ||
          // Para websockets, não aplicamos rewrites/proxy decisions aqui.
          // Isso evita interferência tanto com o HMR do Vite quanto com eventuais sockets proxied.
          req.headers.upgrade === 'websocket' ||
          // Alguns clientes (ex.: HMR) usam token na querystring.
          requestUrl.includes('token=')
        ) {
          // Deixa o Vite lidar com suas próprias requisições
          return next();
        }
        
        // Verifica se é uma requisição de API baseado no header Accept
        const acceptHeader = req.headers.accept || '';
        const isApiRequest = acceptHeader.includes('application/json') && 
                            !acceptHeader.includes('text/html');
        
        // Ignora rotas da API - deixa o proxy lidar com elas
        // IMPORTANTE: 
        // - /audit/logs e /audit/stats são rotas de API, mas /audit é rota de página
        // - /web-scraping/scrape e /web-scraping/scrape-batch são rotas de API, mas /web-scraping é rota de página
        // - /rpa/* são rotas de API (RPA recordings, execute, etc)
        // - /config pode ser tanto API quanto página (depende do Accept header)
        const isApiRoute = url.startsWith('/tickets') || 
                          url.startsWith('/queues') || 
                          url.startsWith('/inbox') ||
                          url.startsWith('/public') ||
                          url.startsWith('/segmentation') ||
                          url.startsWith('/quick-replies') ||
                          url.startsWith('/close-reasons') ||
                          url.startsWith('/bulk-campaigns') ||
                          url.startsWith('/channel-accounts') ||
                          (url === '/whatsapp' || url.startsWith('/whatsapp/')) ||
                          url.startsWith('/ai') ||
                          url.startsWith('/flow-templates') ||
                          url.startsWith('/flows') || 
                          url.startsWith('/health') || 
                          url.startsWith('/version') || 
                          url.startsWith('/replay') || 
                          url.startsWith('/templates') || 
                          url.startsWith('/server') || 
                          url.startsWith('/api') ||
                          url.startsWith('/metrics') ||
                          url.startsWith('/auth') ||
                          url.startsWith('/system') ||
                          url.startsWith('/tenants') ||
                          // IMPORTANTE: endpoints de API são /rag e /rag/*.
                          // A página do frontend é /rag-documents (não deve ser proxyada).
                          (url === '/rag' || url.startsWith('/rag/')) ||
                          url.startsWith('/super-admin') ||
                          url.startsWith('/onboarding') ||
                          url.startsWith('/admin') ||
                          url.startsWith('/dev') ||
                          // /analytics e /export (sem subcaminho) são rotas de página
                          // Já os endpoints de API ficam em /analytics/* e /export/*
                          url.startsWith('/analytics/') ||
                          url.startsWith('/export/') ||
                          url.startsWith('/conversations') ||
                          url.startsWith('/tests') || // /tests/rpa/replay é API
                          (url.startsWith('/rpa/') && url !== '/rpa-test') || // /rpa/recordings é API, mas /rpa-test é página
                          (url.startsWith('/web-scraping/') && url !== '/web-scraping') || // /web-scraping/scrape é API
                          (url.startsWith('/audit/') && url !== '/audit') || // /audit/logs, /audit/stats são API
                          // /departments é página quando navegação (text/html), mas API quando Accept: application/json
                          (url === '/departments' && isApiRequest) ||
                          (url.startsWith('/departments/') && url !== '/departments') ||
                          (url === '/config' && isApiRequest) || // /config é API quando Accept: application/json
                          (url.startsWith('/config/') && url !== '/config'); // /config/validate-* são API
        
        // Para rotas de API (especialmente DELETE, POST, PUT), não faz nada e deixa o proxy lidar
        // O proxy do Vite será aplicado depois deste middleware
        if (isApiRoute) {
          // Deixa o proxy lidar com rotas da API - não modifica nada, apenas passa adiante
          console.log('[FrontendRoutesPlugin] Rota de API detectada, passando para proxy:', {
            method: req.method,
            url: req.url,
            isApiRoute: true,
          });
          return next();
        }
        
        // Se for uma rota de página do frontend e for GET
        if (req.method === 'GET') {
          const isNavigation = acceptHeader.includes('text/html') || 
                               !acceptHeader.includes('application/json');
          
          // Se for navegação (não é API e não é arquivo estático)
          // Serve index.html para todas as rotas do frontend (SPA routing)
          // IMPORTANTE: Não serve HTML para /config quando for requisição de API
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
const pwaBasePath = normalizeBasePath(process.env.VITE_BASE_PATH || '/');
const viteConfig = defineConfig({
  base: pwaBasePath,
  cacheDir: process.env.VITE_CACHE_DIR || './.vite',
  plugins: [
    react({
      // Permite Fast Refresh para arquivos que exportam hooks customizados
      // junto com componentes (como Context Providers)
      fastRefresh: true,
      // Usa JSX runtime automático mas garante compatibilidade
      jsxRuntime: 'automatic',
      // Garante que todas as exportações do React sejam incluídas
      include: '**/*.{jsx,tsx}',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: [
        'favicon.ico',
        'icons/apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-192-maskable.png',
        'icons/icon-512-maskable.png',
      ],
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        importScripts: ['pwa-webpush-sw.js'],
      },
      manifest: {
        name: 'R-Agent2',
        short_name: 'R-Agent2',
        description: 'Dashboard de atendimento e operação',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        scope: pwaBasePath,
        start_url: pwaBasePath,
        icons: [
          {
            src: 'favicon.ico',
            sizes: '64x64 32x32 24x24 16x16',
            type: 'image/x-icon',
          },
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
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
      '^/public': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/queues': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/inbox': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
        bypass(req, res, options) {
          // /inbox é rota de página do frontend (SPA) quando é GET para /inbox (sem subcaminho) + navegação
          // Subrotas como /inbox/conversations são APIs
          if (req.method === 'GET' && req.url === '/inbox') {
            const acceptHeader = req.headers.accept || '';
            const isNavigation = acceptHeader.includes('text/html') && 
                                 !acceptHeader.includes('application/json');
            if (isNavigation) {
              // Não faz proxy - deixa o plugin frontend-routes servir index.html
              return false;
            }
          }
          // Para /inbox/conversations e outros métodos, faz proxy para API
          return undefined;
        },
      },
      '^/segmentation': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/quick-replies': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/close-reasons': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/departments': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
        bypass(req, res, options) {
          // /departments é rota de página do frontend (SPA) quando é navegação (text/html)
          // e é rota de API quando Accept: application/json
          if (req.method === 'GET') {
            const acceptHeader = req.headers.accept || '';
            const isNavigation = acceptHeader.includes('text/html') && 
                                 !acceptHeader.includes('application/json');
            if (isNavigation) {
              return false;
            }
          }
          return undefined;
        },
      },
      '^/bulk-campaigns': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/channel-accounts': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/whatsapp': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/ai': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/flow-templates': {
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
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Vite Proxy] Proxying /auth request:', {
              method: req.method,
              url: req.url,
              target: `http://localhost:${config.api?.port || 3000}${req.url}`,
              headers: req.headers,
            });
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('[Vite Proxy] Proxy response for /auth:', {
              method: req.method,
              url: req.url,
              statusCode: proxyRes.statusCode,
              statusMessage: proxyRes.statusMessage,
              headers: proxyRes.headers,
            });
          });
          proxy.on('error', (err, req, res) => {
            console.error('[Vite Proxy] Proxy error for /auth:', {
              error: err.message,
              stack: err.stack,
              method: req.method,
              url: req.url,
            });
          });
        },
      },
      '^/system': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/tenants': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      // IMPORTANTE:
      // - /rag-documents é rota de página do frontend (SPA)
      // - /rag e /rag/* são endpoints da API (RAG)
      '^/rag(/|$)': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/super-admin': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/onboarding': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/admin': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/dev': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      // IMPORTANTE:
      // - /analytics (sem barra no final) é página do frontend
      // - /analytics/* são endpoints da API (ex: /analytics/metrics)
      '^/analytics/': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      // Mesma regra para export:
      // - /export é página
      // - /export/* é API
      '^/export/': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
      '^/conversations': {
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
      // Rota para subcaminhos de /config (ex: /config/validate-provider-token)
      // Sempre faz proxy para subcaminhos, pois são rotas de API
      '^/config/': {
        target: `http://localhost:${config.api?.port || 3000}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // Define variáveis de ambiente para o frontend
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
      process.env.VITE_API_BASE_URL || config.frontend?.apiBaseUrl || ''
    ),
    // Porta da API para fallback no DEV (ex: WebSocket direto, sem depender do proxy)
    'import.meta.env.VITE_API_DEV_PORT': JSON.stringify(
      Number(process.env.API_PORT || config.api?.port || 3000)
    ),
    'import.meta.env.VITE_BASE_PATH': JSON.stringify(
      process.env.VITE_BASE_PATH || ''
    ),
    // Garante que DEV e MODE estejam definidos corretamente
    'import.meta.env.DEV': JSON.stringify(process.env.NODE_ENV !== 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  },
  // Configuração para SPA routing - todas as rotas devem retornar index.html
  // E para tratar arquivos CommonJS do backend
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
      // Garante que React não seja externalizado
      external: [],
      // Força o Rollup a preservar todas as exportações do React
      preserveEntrySignatures: 'strict',
      // Plugin para garantir que React seja processado corretamente
      plugins: [],
    },
    // Configuração para garantir que o React seja incluído corretamente
    commonjsOptions: {
      // Inclui arquivos CommonJS do backend e todos os node_modules CommonJS
      include: [/engine\/utils\/.*\.js$/, /node_modules\/.*/],
      transformMixedEsModules: true,
      // Garante que todos os módulos CommonJS sejam processados corretamente
      requireReturnsDefault: 'auto',
      // Força transformação de CommonJS para ESM
      strictRequires: true,
      // Permite default exports de módulos CommonJS
      defaultIsModuleExports: true,
    },
    // Garante que todas as dependências sejam incluídas
    target: 'esnext',
    minify: 'esbuild',
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
    // Força o Rollup a incluir todas as exportações do React
    dedupe: ['react', 'react-dom'],
  },
  // Configuração para permitir importar CommonJS do backend
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      join(__dirname, '..', 'engine', 'utils', 'aiTaskExecutor.js'),
      join(__dirname, '..', 'engine', 'utils', 'typeCompatibility.js'),
      join(__dirname, '..', 'engine', 'utils', 'templateRenderer.js'),
      join(__dirname, '..', 'engine', 'utils', 'jsonSchemaValidator.js'),
    ],
    esbuildOptions: {
      // Permite importar CommonJS e força processamento
      mainFields: ['module', 'main'],
      // Garante que React seja processado corretamente
      jsx: 'automatic',
    },
    // Força re-processamento quando os arquivos mudarem
    force: false,
  },
});

export default viteConfig;
