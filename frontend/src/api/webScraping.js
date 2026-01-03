import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Funções para trabalhar com web scraping.
 */

/**
 * Raspa uma URL.
 * 
 * @param {Object} options - Opções de scraping
 * @param {string} options.url - URL a raspar
 * @param {string} [options.contentSelector] - Seletor CSS para conteúdo principal
 * @param {Array} [options.removeSelectors] - Seletores CSS para remover
 * @param {number} [options.timeout] - Timeout em ms
 * @param {boolean} [options.autoIndex] - Se deve indexar automaticamente
 * @param {string} [options.source] - Fonte do documento
 * @param {string} [options.category] - Categoria do documento
 * @param {Array} [options.tags] - Tags do documento
 * @returns {Promise<Object>} Resultado do scraping
 */
export function scrapeUrl(options) {
  return fetchJson('/web-scraping/scrape', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

/**
 * Raspa múltiplas URLs.
 * 
 * @param {Object} options - Opções de scraping
 * @param {Array<string>} options.urls - URLs a raspar
 * @param {string} [options.contentSelector] - Seletor CSS para conteúdo principal
 * @param {Array} [options.removeSelectors] - Seletores CSS para remover
 * @param {number} [options.timeout] - Timeout em ms
 * @param {number} [options.concurrency] - Número de requisições simultâneas
 * @param {boolean} [options.autoIndex] - Se deve indexar automaticamente
 * @param {string} [options.source] - Fonte do documento
 * @param {string} [options.category] - Categoria do documento
 * @param {Array} [options.tags] - Tags do documento
 * @returns {Promise<Object>} Resultados do scraping
 */
export function scrapeUrls(options) {
  return fetchJson('/web-scraping/scrape-batch', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}











