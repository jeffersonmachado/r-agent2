/**
 * Helpers genéricos de UI.
 */

/**
 * Formata uma data ISO em string legível.
 *
 * @param {string|Date|undefined|null} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

// Cache para config.json carregado
let configCache = null;
let configLoadPromise = null;

/**
 * Carrega config.json de forma assíncrona (com cache)
 */
async function loadConfig() {
  if (configCache !== null) {
    return configCache;
  }
  
  if (configLoadPromise) {
    return configLoadPromise;
  }
  
  configLoadPromise = (async () => {
    try {
      // Tenta carregar config.json de várias formas
      const possiblePaths = [
        '/config.json',  // Raiz
        '/r-agent2/config.json',  // Com prefixo
        `${import.meta.env.BASE_URL || ''}config.json`,  // Com BASE_URL do Vite
      ];
      
      // Remove duplicatas e vazios
      const uniquePaths = [...new Set(possiblePaths.filter(p => p && p !== 'config.json'))];
      
      for (const configPath of uniquePaths) {
        try {
          const response = await fetch(configPath);
          if (response.ok) {
            const config = await response.json();
            configCache = config;
            return config;
          }
        } catch (err) {
          // Tenta próximo path
          continue;
        }
      }
    } catch (err) {
      // Ignora erros silenciosamente - usa fallback
    }
    return null;
  })();
  
  return configLoadPromise;
}

/**
 * Base path da aplicação.
 * Baseado apenas na URL base definida no vite.config.mjs (sem detecção automática).
 * 
 * O valor vem de import.meta.env.BASE_URL que é automaticamente definido pelo Vite
 * baseado na configuração `base` do vite.config.mjs, que por sua vez usa
 * process.env.VITE_BASE_PATH (definido no Dockerfile como /r-agent2/).
 * 
 * @example
 * - Em produção (Docker): '/r-agent2' (vem de VITE_BASE_PATH=/r-agent2/)
 * - Em desenvolvimento: '' (vazio, se VITE_BASE_PATH não estiver definido)
 */
const BASE_PATH = (() => {
  // Usa BASE_URL do Vite (definido automaticamente baseado no 'base' do vite.config.mjs)
  // O vite.config.mjs usa: base: process.env.VITE_BASE_PATH || '/'
  const baseUrl = import.meta.env.BASE_URL || '';
  
  if (baseUrl && baseUrl !== '/') {
    // Remove barra final se presente
    const path = baseUrl.trim();
    return path.endsWith('/') ? path.slice(0, -1) : path;
  }
  
  // Se não estiver definido, retorna vazio (desenvolvimento)
  return '';
})();

/**
 * Obtém o base path da aplicação.
 * 
 * @returns {string} Base path (ex: '/r-agent2' ou '')
 */
export function getBasePath() {
  return BASE_PATH;
}

/**
 * Obtém o base path de forma assíncrona (tenta carregar config.json)
 * Use esta função quando precisar do valor de config.json
 * 
 * @returns {Promise<string>} Base path
 */
export async function getBasePathAsync() {
  const config = await loadConfig();
  if (config && config.basePath) {
    const basePath = config.basePath.endsWith('/') ? config.basePath.slice(0, -1) : config.basePath;
    if (basePath) {
      return basePath;
    }
  }
  return getBasePath();
}

/**
 * Ajusta uma URL de recurso estático (imagem, asset, etc.) para incluir o base path se necessário.
 * 
 * @param {string} url - URL do recurso (ex: '/images/logo.png')
 * @returns {string} URL ajustada (ex: '/r-agent2/images/logo.png' se necessário)
 */
export function getStaticUrl(url) {
  const basePath = getBasePath();
  if (!basePath) {
    return url;
  }
  // Remove barra inicial se presente para evitar duplicação
  const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
  return `${basePath}${normalizedUrl}`;
}

/**
 * Redireciona para a página de login.
 * 
 * @param {string} [path='/login'] - Caminho de destino (padrão: '/login')
 */
export function redirectToLogin(path = '/login') {
  const basePath = BASE_PATH;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullPath = basePath ? `${basePath}${normalizedPath}` : normalizedPath;
  window.location.href = `${window.location.origin}${fullPath}`;
}


