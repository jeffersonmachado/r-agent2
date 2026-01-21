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

// Playwright é opcional em runtime (habilitado via env USE_PLAYWRIGHT=true)
let playwrightChromium = null;
function getPlaywrightChromium() {
  if (playwrightChromium) return playwrightChromium;
  try {
    // eslint-disable-next-line global-require
    const { chromium } = require('playwright');
    playwrightChromium = chromium;
    return playwrightChromium;
  } catch (err) {
    return null;
  }
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
  let cleaned = content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  // Anti-ruído (heurístico): remove sequências típicas de navegação/breadcrumb que costumam dominar ranking
  // Ex.: "Home / Sobre / Serviços / Planos / Contato"
  // Mantemos isso restrito a sequências com 3+ itens de menu para não apagar conteúdo real.
  const navItems = [
    'home', 'início', 'inicio', 'sobre', 'serviços', 'servicos', 'produtos', 'produto',
    'planos', 'plano', 'contato', 'blog', 'faq', 'entrar', 'login', 'cadastro',
    'política', 'politica', 'privacidade', 'termos',
  ];
  const navWord = `(?:${navItems.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
  const navSeq = new RegExp(
    `(?:\\b${navWord}\\b\\s*(?:[\\|/›»>\\-•·\\u00B7]\\s*)?){3,}`,
    'gi'
  );
  cleaned = cleaned.replace(navSeq, ' ').replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Extrai headings (h1/h2) de HTML.
 * @param {string} html
 * @returns {string[]}
 */
function extractHeadingsFromHtml(html) {
  if (!html) return [];
  if (!cheerio) return [];
  try {
    const $ = cheerio.load(html);
    const headings = [];
    $('h1, h2').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t) headings.push(t);
    });
    return Array.from(new Set(headings)).slice(0, 30);
  } catch {
    return [];
  }
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
 * Fallback de scraping via Playwright (SPA/JS-heavy sites).
 *
 * Regras:
 * - chromium headless
 * - page.goto(..., { waitUntil: 'networkidle', timeout: 15000 })
 * - waitForTimeout(2000)
 * - extrair: title, meta description, headings h1/h2, body.innerText
 *
 * @param {string} url
 * @returns {Promise<{url: string, title: string, metaDescription: string, headings: string[], extractedText: string}>}
 */
async function scrapeWithPlaywright(url) {
  const chromium = getPlaywrightChromium();
  if (!chromium) {
    throw new Error('Playwright não disponível. Instale e habilite USE_PLAYWRIGHT=true');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const title = document?.title ? String(document.title).trim() : '';
      const metaDescription =
        document?.querySelector?.('meta[name="description"]')?.getAttribute?.('content') ||
        document?.querySelector?.('meta[property="og:description"]')?.getAttribute?.('content') ||
        '';

      const headings = Array.from(document.querySelectorAll('h1, h2'))
        .map((el) => (el && el.textContent ? el.textContent : ''))
        .map((t) => String(t).replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const extractedText = document?.body?.innerText ? String(document.body.innerText).trim() : '';

      return {
        title,
        metaDescription: String(metaDescription || '').trim(),
        headings: Array.from(new Set(headings)).slice(0, 30),
        extractedText,
      };
    });

    return {
      url,
      title: data.title || '',
      metaDescription: data.metaDescription || '',
      headings: Array.isArray(data.headings) ? data.headings : [],
      extractedText: data.extractedText || '',
    };
  } finally {
    try { await page.close(); } catch { /* ignora */ }
    try { await context.close(); } catch { /* ignora */ }
    try { await browser.close(); } catch { /* ignora */ }
  }
}

function buildMinimalScrape(url) {
  let title = '';
  try {
    const u = new URL(url);
    title = u.hostname ? u.hostname : url;
  } catch {
    title = url;
  }
  return {
    url,
    title,
    metaDescription: '',
    headings: [],
    extractedText: 'Sem texto extraído. Indexando metadados do site.',
  };
}

function buildIndexableContent(scrape) {
  const safe = scrape || {};
  const lines = [];
  if (safe.title) lines.push(`Título: ${safe.title}`);
  if (safe.metaDescription) lines.push(`Descrição: ${safe.metaDescription}`);
  if (Array.isArray(safe.headings) && safe.headings.length > 0) {
    lines.push(`Headings:\n- ${safe.headings.slice(0, 30).join('\n- ')}`);
  }
  if (safe.extractedText) lines.push(safe.extractedText);
  return lines.join('\n\n').trim() || 'Sem texto extraído. Indexando metadados do site.';
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
  // Inicializa recording (opcional) — nunca pode quebrar o scraping
  let recording = null;
  let recordingId = null;
  
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

  // Recording é best-effort: qualquer falha desativa e segue normalmente
  try {
    const shouldRecord = process.env.ENABLE_SCRAPING_RECORDING !== 'false';
    if (shouldRecord) {
      recording = new RecordingSystem({
        storagePath: path.join(process.cwd(), 'recordings', 'scraping'),
        context: 'scraping',
        enableTimestamps: true,
      });
      recordingId = `scraping-${Date.now()}`;
      recording.start(recordingId, {
        name: 'Web scraping',
        description: 'Raspagem de URL',
        url,
        source: 'automatic',
      });
    }
  } catch (err) {
    logger.warn('Recording disabled', err);
    recording = null;
    recordingId = null;
  }

  // Valida URL
  try {
    new URL(url);
  } catch (error) {
    throw new Error('URL inválida');
  }

  const {
    contentSelector,
    removeSelectors = [
      'nav',
      'header',
      'footer',
      '.sidebar',
      '.menu',
      '.navbar',
      '.breadcrumbs',
      '.breadcrumb',
      '.advertisement',
      '.ads',
      // Cookie/LGPD/consent banners (muito ruidoso, raramente útil para descrição)
      '#cookie',
      '#cookies',
      '.cookie',
      '.cookies',
      '.cookie-banner',
      '.cookie-consent',
      '.consent',
      '.consent-banner',
      '.lgpd',
      '.privacy-banner',
      '[aria-label*="cookie" i]',
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      // Elementos de navegação/compartilhamento comumente repetidos
      '.social',
      '.share',
    ],
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

    /** @type {{code: string, message: string, details?: any}[]} */
    const warnings = [];

    let scrapeResult = null;
    let html = '';
    let metadata = { title: '', description: '', keywords: [] };
    let headings = [];
    let extractedText = '';
    let usedPlaywright = false;

    // 1) Tentativa rápida via fetch
    try {
      recording?.recordAction?.({
        type: 'url-fetch',
        step: 'fetch-url',
        value: { url },
      });
      const response = await fetchUrl(url, { timeout });
      html = await response.text();

      metadata = extractMetadata(html, url);
      headings = extractHeadingsFromHtml(html);

      recording?.recordAction?.({
        type: 'content-extraction',
        step: 'extract-content',
        value: { url },
      });
      extractedText = extractTextFromHtml(html, {
        contentSelector,
        removeSelectors,
      });

      scrapeResult = {
        url,
        title: metadata.title || '',
        metaDescription: metadata.description || '',
        headings,
        extractedText: extractedText || '',
      };

      // 2) Se texto curto, tenta fallback Playwright (SPA/JS)
      const minCharsForNoFallback = 200;
      const usePlaywright = String(process.env.USE_PLAYWRIGHT || '').toLowerCase() === 'true';
      if ((scrapeResult.extractedText || '').trim().length < minCharsForNoFallback) {
        warnings.push({
          code: 'SCRAPE_SHORT',
          message: `Conteúdo extraído via fetch é curto (<${minCharsForNoFallback} chars). Tentando fallback Playwright.`,
          details: { extractedLength: (scrapeResult.extractedText || '').trim().length, url },
        });
        if (usePlaywright) {
          try {
            const pw = await scrapeWithPlaywright(url);
            usedPlaywright = true;
            // Usa Playwright se trouxer mais conteúdo, ou se fetch não trouxe nada
            const pwLen = (pw.extractedText || '').trim().length;
            const fetchLen = (scrapeResult.extractedText || '').trim().length;
            if (pwLen > fetchLen) {
              scrapeResult = pw;
            } else {
              // Mesmo sem trocar, preserva metadados/heads do Playwright se estavam vazios
              scrapeResult = {
                ...scrapeResult,
                title: scrapeResult.title || pw.title,
                metaDescription: scrapeResult.metaDescription || pw.metaDescription,
                headings: (scrapeResult.headings && scrapeResult.headings.length > 0) ? scrapeResult.headings : pw.headings,
              };
            }
            warnings.push({
              code: 'PLAYWRIGHT_FALLBACK_USED',
              message: 'Fallback Playwright executado para extrair conteúdo renderizado por JavaScript.',
              details: { url, pwLength: pwLen, fetchLength: fetchLen },
            });
          } catch (pwErr) {
            warnings.push({
              code: 'PLAYWRIGHT_FAILED',
              message: 'Fallback Playwright falhou. Continuando com o melhor resultado disponível.',
              details: { url, error: pwErr.message || String(pwErr) },
            });
          }
        } else {
          warnings.push({
            code: 'PLAYWRIGHT_DISABLED',
            message: 'Fallback Playwright está desabilitado (USE_PLAYWRIGHT!=true).',
            details: { url },
          });
        }
      }
    } catch (fetchErr) {
      warnings.push({
        code: 'SCRAPE_FAILED',
        message: 'Falha ao extrair conteúdo via fetch/HTML estático. Tentando fallback.',
        details: { url, error: fetchErr.message || String(fetchErr) },
      });

      // 2) Se fetch falhou, tenta Playwright
      const usePlaywright = String(process.env.USE_PLAYWRIGHT || '').toLowerCase() === 'true';
      if (usePlaywright) {
        try {
          scrapeResult = await scrapeWithPlaywright(url);
          usedPlaywright = true;
          warnings.push({
            code: 'PLAYWRIGHT_FALLBACK_USED',
            message: 'Fallback Playwright executado após falha no fetch.',
            details: { url },
          });
        } catch (pwErr) {
          warnings.push({
            code: 'PLAYWRIGHT_FAILED',
            message: 'Fallback Playwright também falhou. Indexando metadados mínimos.',
            details: { url, error: pwErr.message || String(pwErr) },
          });
        }
      } else {
        warnings.push({
          code: 'PLAYWRIGHT_DISABLED',
          message: 'Fallback Playwright está desabilitado (USE_PLAYWRIGHT!=true). Indexando metadados mínimos.',
          details: { url },
        });
      }
    }

    // 3) Seed mínimo garantido (nunca aborta por texto curto)
    if (!scrapeResult) {
      scrapeResult = buildMinimalScrape(url);
    }

    // Se texto ainda é vazio, garante placeholder indexável
    if (!(scrapeResult.extractedText || '').trim()) {
      warnings.push({
        code: 'NO_TEXT_EXTRACTED',
        message: 'Sem texto extraído. Indexando metadados do site.',
        details: { url },
      });
      scrapeResult.extractedText = 'Sem texto extraído. Indexando metadados do site.';
    }

    // Cria documento
    const documentId = uuidv4();
    const indexableContent = buildIndexableContent(scrapeResult);
    const document = {
      id: documentId,
      title: scrapeResult.title || url,
      content: indexableContent,
      metadata: {
        source,
        category,
        tags,
        url,
        scrapedAt: new Date().toISOString(),
        description: scrapeResult.metaDescription || '',
        headings: Array.isArray(scrapeResult.headings) ? scrapeResult.headings : [],
        scrape_method: usedPlaywright ? 'playwright' : 'fetch',
        warnings,
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
      recording?.recordAction?.({
        type: 'document-indexing',
        step: 'index-document',
        value: { documentId },
      });
      
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
            recording?.stop?.();
            if (recordingId) recording?.save?.(recordingId);
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
        contentLength: indexableContent.length,
        indexed,
      });
      replay.stop();
      replay.save(replayId);
    }

    recording?.stop?.();
    if (recordingId) recording?.save?.(recordingId);

    return {
      success: true,
      documentId,
      url,
      title: document.title,
      metaDescription: scrapeResult.metaDescription || '',
      headings: Array.isArray(scrapeResult.headings) ? scrapeResult.headings : [],
      extractedText: scrapeResult.extractedText || '',
      content: indexableContent.substring(0, 500) + '...', // Preview (indexável)
      contentLength: indexableContent.length,
      metadata: {
        title: document.title,
        description: scrapeResult.metaDescription || '',
        keywords: metadata.keywords,
      },
      warnings,
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
    recording?.recordCustom?.('error', {
      step: 'scraping-error',
      value: { error: error.message },
    });
    recording?.stop?.();
    if (recordingId) recording?.save?.(`${recordingId}-error`);
    
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
  const { concurrency = 3 } = options;
  const results = [];

  function normalizeError(err) {
    if (err && typeof err === 'object') {
      const anyErr = /** @type {any} */ (err);
      return {
        name: anyErr.name || 'Error',
        message: anyErr.message || String(err),
        stack: anyErr.stack ? String(anyErr.stack) : undefined,
      };
    }
    return {
      name: 'Error',
      message: String(err),
      stack: undefined,
    };
  }

  async function scrapeUrlSafe(url) {
    const startedAt = Date.now();
    try {
      const value = await scrapeUrl(url, options);
      const durationMs = Date.now() - startedAt;
      const status = value?.success
        ? (value.isDuplicate ? 'duplicate' : 'new')
        : 'failed';
      return { ...value, url, success: !!value?.success, status, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const normalized = normalizeError(err);
      return {
        success: false,
        url,
        status: 'failed',
        error: normalized,
        durationMs,
      };
    }
  }

  // Processa em lotes para não sobrecarregar
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((u) => scrapeUrlSafe(u)));
    results.push(...batchResults);
  }

  return results;
}

module.exports = {
  scrapeUrl,
  scrapeUrls,
  extractTextFromHtml,
  extractMetadata,
};

