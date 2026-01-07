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

/**
 * Obtém o base path da aplicação (ex: /r-agent2) se estiver rodando com prefixo.
 * 
 * @returns {string} Base path (ex: '/r-agent2' ou '')
 */
export function getBasePath() {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/r-agent2')) {
    return '/r-agent2';
  }
  return '';
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


