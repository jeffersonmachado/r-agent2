/**
 * Serviço de Web Scraping (Raspagem de Sites).
 * 
 * Responsabilidades:
 * - Extrair conteúdo de URLs
 * - Limpar e processar HTML
 * - Integrar com RAG para indexação automática
 */

const logger = require('../utils/logger');
const ragDocumentsService = require('./ragDocumentsService');
const { v4: uuidv4 } = require('uuid');
const { enforceScrapingRateLimit } = require('../../infra/rate-limit/scraping');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');
const path = require('path');

// Verifica se cheerio está disponível
let cheerio = null;
try {
  cheerio = require('cheerio');
} catch (error) {
  logger.warn('[WebScraping] cheerio não instalado. Execute: npm install cheerio');
}

/**
 * Faz requisição HTTP com timeout e headers apropriados.
 */
async function fetchUrl(url, options = {}) {
  const timeout = options.timeout || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Timeout após ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Extrai texto limpo de HTML usando cheerio.
 */
function extractTextFromHtml(html, options = {}) {
  if (!cheerio) {
    // Fallback simples se cheerio não estiver disponível
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const $ = cheerio.load(html);
  
  // Remove scripts, styles, comments
  $('script, style, noscript, iframe, embed, object').remove();
  
  // Remove elementos indesejados
  if (options.removeSelectors) {
    options.removeSelectors.forEach(selector => {
      $(selector).remove();
    });
  }

  // Seleciona conteúdo principal
  let content = '';
  
  if (options.contentSelector) {
    // Usa seletor específico
    content = $(options.contentSelector).text();
  } else {
    // Tenta encontrar conteúdo principal automaticamente
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.main-content'];
    let found = false;
    
    for (const selector of mainSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = element.text();
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Fallback: pega todo o body
      content = $('body').text();
    }
  }

  // Limpa texto
  return content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Extrai metadados de uma página HTML.
 */
function extractMetadata(html, url) {
  if (!cheerio) {
    return {
      title: '',
      description: '',
      keywords: [],
    };
  }

  const $ = cheerio.load(html);
  
  const title = $('title').text().trim() || 
                $('meta[property="og:title"]').attr('content') || 
                $('h1').first().text().trim() || '';
  
  const description = $('meta[name="description"]').attr('content') || 
                     $('meta[property="og:description"]').attr('content') || '';
  
  const keywords = ($('meta[name="keywords"]').attr('content') || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  return {
    title,
    description,
    keywords,
  };
}

/**
 * Raspa conteúdo de uma URL.
 * 
 * @param {string} url - URL a raspar
 * @param {Object} options - Opções de scraping
 * @param {string} options.contentSelector - Seletor CSS para conteúdo principal
 * @param {Array} options.removeSelectors - Seletores CSS para remover
 * @param {number} options.timeout - Timeout em ms
 * @param {boolean} options.autoIndex - Se deve indexar automaticamente no RAG
 * @param {string} options.source - Fonte do documento (web_scraping, knowledge_base, etc)
 * @param {string} options.category - Categoria do documento
 * @param {Array} options.tags - Tags do documento
 * @returns {Promise<Object>} Resultado do scraping
 */
async function scrapeUrl(url, options = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL é obrigatória');
  }

  // Inicializa replay (opcional)
  const shouldRecordReplay = process.env.ENABLE_SCRAPING_REPLAY !== 'false';
  let replay = null;
  let replayId = null;
  
  if (shouldRecordReplay) {
    replay = new ReplaySystem({
      storagePath: path.join(process.cwd(), 'replays', 'scraping'),
      context: 'scraping',
      enableScreenshots: false,
    });
    
    replayId = `scraping-${Date.now()}`;
    replay.start(replayId, {
      url,
      options: Object.keys(options),
    });
  }

  // Valida URL
  try {
    new URL(url);
  } catch (error) {
    throw new Error('URL inválida');
  }

  const {
    contentSelector,
    removeSelectors = ['nav', 'header', 'footer', '.sidebar', '.menu', '.advertisement', '.ads'],
    timeout = 30000,
    autoIndex = true,
    source = 'web_scraping',
    category = null,
    tags = [],
    tenantId = null, // Tenant deve ser fornecido explicitamente
  } = options;

  logger.info('[WebScraping] Iniciando scraping', { url });

  try {
    // Aplica rate limiting ANTES de fazer requisição
    const executionId = options.executionId || `exec-${Date.now()}`;
    const userId = options.userId || tenantId;
    
    await enforceScrapingRateLimit({
      url,
      executionId,
      userId,
    });

    // Faz requisição
    if (recording) {
      recording.recordAction({
        type: 'url-fetch',
        step: 'fetch-url',
        value: { url },
      });
    }
    const response = await fetchUrl(url, { timeout });
    const html = await response.text();

    // Extrai metadados
    const metadata = extractMetadata(html, url);

    // Extrai conteúdo
    if (recording) {
      recording.recordAction({
        type: 'content-extraction',
        step: 'extract-content',
        value: { url },
      });
    }
    const content = extractTextFromHtml(html, {
      contentSelector,
      removeSelectors,
    });

    if (!content || content.trim().length < 50) {
      throw new Error('Conteúdo extraído muito curto ou vazio');
    }

    // Cria documento
    const documentId = uuidv4();
    const document = {
      id: documentId,
      title: metadata.title || url,
      content: content,
      metadata: {
        source,
        category,
        tags,
        url,
        scrapedAt: new Date().toISOString(),
        description: metadata.description,
        keywords: metadata.keywords,
      },
      status: 'active',
    };

    // Indexa no RAG se solicitado
    let indexed = false;
    let chunksCreated = 0;
    let isDuplicate = false;

    if (autoIndex) {
      if (replay) {
        replay.recordEvent('indexing_started', { documentId });
      }
      if (recording) {
        recording.recordAction({
          type: 'document-indexing',
          step: 'index-document',
          value: { documentId },
        });
      }
      
      try {
        const indexStartTime = new Date().toISOString();
        const result = await ragDocumentsService.createDocument(document, tenantId);
        const indexEndTime = new Date().toISOString();
        
        if (result.success && result.document) {
          // Verifica se é duplicata
          if (result.isDuplicate) {
            isDuplicate = true;
            logger.info('[WebScraping] Documento duplicado detectado, usando existente', {
              url,
              existingDocumentId: result.existingDocument.id,
              existingTitle: result.existingDocument.title,
            });
            
            if (replay) {
              replay.recordAction(
                { type: 'document_indexing', step: 'index-document' },
                {
                  success: true,
                  startTime: indexStartTime,
                  endTime: indexEndTime,
                  actual: { isDuplicate: true },
                }
              );
              replay.stop();
              replay.save(replayId);
            }
            
            // Retorna documento existente
            return {
              success: true,
              documentId: result.existingDocument.id,
              title: result.existingDocument.title,
              content: result.existingDocument.content,
              metadata: result.existingDocument.metadata,
              indexed: result.existingDocument.indexed || false,
              chunksCreated: result.existingDocument.chunksCount || 0,
              isDuplicate: true,
              message: 'Documento já existe (mesma URL), usando documento existente',
            };
          }
          
          indexed = result.document.indexed || false;
          chunksCreated = result.document.chunksCount || 0;
          
          if (replay) {
            replay.recordAction(
              { type: 'document_indexing', step: 'index-document' },
              {
                success: true,
                startTime: indexStartTime,
                endTime: indexEndTime,
                actual: { chunksCreated, indexed },
              }
            );
          }
          
          logger.info('[WebScraping] Documento indexado automaticamente', {
            documentId,
            chunksCreated,
          });
        }
      } catch (indexError) {
        if (replay) {
          replay.recordError(indexError, 'document-indexing');
        }
        logger.error('[WebScraping] Erro ao indexar documento', {
          error: indexError.message,
          documentId,
        });
        // Não falha o scraping se a indexação falhar
      }
    }

    // Finaliza e salva replay
    if (replay) {
      replay.recordEvent('scraping_completed', {
        documentId,
        contentLength: content.length,
        indexed,
      });
      replay.stop();
      replay.save(replayId);
    }

    return {
      success: true,
      documentId,
      url,
      title: document.title,
      content: content.substring(0, 500) + '...', // Preview
      contentLength: content.length,
      metadata,
      indexed,
      chunksCreated,
      isDuplicate: isDuplicate || false,
    };
  } catch (error) {
    // Registra erro no replay
    if (replay) {
      replay.recordError(error, 'url-scraping');
      replay.recordEvent('scraping_failed', { error: error.message });
      replay.stop();
      replay.save(`${replayId}-error`);
    }

    // Registra erro na gravação
    if (recording) {
      recording.recordCustom('error', {
        step: 'scraping-error',
        value: { error: error.message },
      });
      recording.stop();
      recording.save(`${recordingId}-error`);
    }
    
    logger.error('[WebScraping] Erro ao raspar URL', {
      url,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Raspa múltiplas URLs.
 * 
 * @param {Array<string>} urls - URLs a raspar
 * @param {Object} options - Opções de scraping
 * @returns {Promise<Array>} Resultados do scraping
 */
async function scrapeUrls(urls, options = {}) {
  const results = [];
  const { concurrency = 3 } = options;

  // Processa em lotes para não sobrecarregar
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(url => scrapeUrl(url, options))
    );

    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          url: batch[index],
          error: result.reason.message,
        });
      }
    });
  }

  return results;
}

module.exports = {
  scrapeUrl,
  scrapeUrls,
  extractTextFromHtml,
  extractMetadata,
};

