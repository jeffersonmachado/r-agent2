const logger = require('../utils/logger');

function safeToString(v, fallback = '') {
  if (v == null) return fallback;
  try { return String(v); } catch (_) { return fallback; }
}

function safeTrim(v, fallback = '') {
  return safeToString(v, fallback).trim();
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        const err = new Error(`${label || 'Operação'}: timeout após ${timeoutMs}ms`);
        err.code = 'TIMEOUT';
        reject(err);
      }, timeoutMs);
      // evita warnings de unhandled timers ao resolver antes
      promise.finally(() => clearTimeout(id)).catch(() => clearTimeout(id));
    }),
  ]);
}

/**
 * Normaliza texto de OCR antes de indexar.
 * Objetivo: remover “lixo” comum de OCR sem destruir tokens importantes (R$, CNPJ, telefones, e-mails, links).
 *
 * @param {string} text
 * @returns {string}
 */
function cleanupOcrText(text) {
  const raw = safeToString(text);
  if (!raw.trim()) return '';

  // Remove caracteres invisíveis/ruins comuns em OCR
  let t = raw
    .replace(/\u0000/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width
    .replace(/\uFFFD/g, ''); // replacement char �

  // Corrige hifenização por quebra de linha: "infor-\nmação" -> "informação"
  t = t.replace(/([A-Za-zÀ-ÿ])-\s*\n\s*([A-Za-zÀ-ÿ])/g, '$1$2');

  // Normaliza quebras e espaços
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');

  // Remove linhas muito “ruidosas” (baixa densidade de letras/números)
  const lines = t.split('\n');
  const cleaned = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const len = line.length;
    if (len >= 30) {
      const alnum = (line.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length;
      const ratio = alnum / len;
      if (ratio < 0.15) continue;
    }
    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Pré-processa imagem para OCR (best-effort), melhorando contraste e legibilidade.
 * Usa `sharp` quando disponível, mas nunca pode quebrar o pipeline.
 *
 * @param {Buffer} buffer
 * @param {{
 *   enabled?: boolean,
 *   maxDimension?: number,
 *   minDimension?: number,
 * }} [options]
 * @returns {Promise<{ variants: Array<{label: string, buffer: Buffer}>, warnings: Array<{code: string, message: string, details?: any}> }>}
 */
async function preprocessImageForOcr(buffer, options = {}) {
  const enabled = options.enabled !== false;
  const maxDimension = Number.isFinite(options.maxDimension) ? options.maxDimension : 2400;
  const minDimension = Number.isFinite(options.minDimension) ? options.minDimension : 1200;
  /** @type {Array<{code: string, message: string, details?: any}>} */
  const warnings = [];

  if (!enabled) return { variants: [], warnings };

  let sharp;
  try {
    // eslint-disable-next-line global-require
    sharp = require('sharp');
  } catch (err) {
    warnings.push({
      code: 'OCR_PREPROCESS_UNAVAILABLE',
      message: 'Pré-processamento de OCR indisponível (sharp não instalado).',
      details: { error: safeErrorMessage(err) },
    });
    return { variants: [], warnings };
  }

  try {
    const base = sharp(buffer, { failOnError: false });
    const meta = await base.metadata().catch(() => ({}));
    const w = Number(meta.width) || 0;
    const h = Number(meta.height) || 0;
    const largest = Math.max(w, h);

    // Heurística: garante tamanho mínimo para OCR e limita tamanho máximo para performance.
    let targetLargest = largest;
    if (largest > 0 && largest < minDimension) targetLargest = minDimension;
    if (largest > 0 && largest > maxDimension) targetLargest = maxDimension;

    const needsResize = largest > 0 && targetLargest > 0 && targetLargest !== largest;
    const isUpscale = needsResize && targetLargest > largest;

    const pipeline = sharp(buffer, { failOnError: false })
      .rotate() // respeita EXIF quando existir
      .flatten({ background: '#ffffff' }) // remove alpha (fundos transparentes)
      .grayscale()
      .normalize()
      .sharpen();

    if (needsResize) {
      pipeline.resize({
        width: w >= h ? targetLargest : undefined,
        height: h > w ? targetLargest : undefined,
        fit: 'inside',
        withoutEnlargement: !isUpscale,
      });
    }

    // Variante 1: “limpa” (boa para textos com anti-aliasing)
    const cleaned = await pipeline
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    // Variante 2: binarizada (boa para capturas com pouco contraste)
    const binary = await sharp(cleaned, { failOnError: false })
      .threshold(180)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    return {
      variants: [
        { label: 'preprocessed', buffer: cleaned },
        { label: 'preprocessed_threshold', buffer: binary },
      ],
      warnings,
    };
  } catch (err) {
    warnings.push({
      code: 'OCR_PREPROCESS_FAILED',
      message: 'Falha ao pré-processar imagem para OCR. Usando imagem original.',
      details: { error: safeErrorMessage(err) },
    });
    return { variants: [], warnings };
  }
}

/**
 * Extrai texto de PDF usando pdf-parse.
 *
 * @param {Buffer} buffer
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ text: string, warnings: Array<{code: string, message: string, details?: any}> }>}
 */
async function extractPdfText(buffer, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  /** @type {Array<{code: string, message: string, details?: any}>} */
  const warnings = [];

  let pdfParse;
  try {
    // eslint-disable-next-line global-require
    pdfParse = require('pdf-parse');
  } catch (err) {
    warnings.push({
      code: 'PDF_PARSE_FAILED',
      message: 'pdf-parse não está disponível para extração de PDF.',
      details: { error: safeErrorMessage(err) },
    });
    return { text: '', warnings };
  }

  try {
    const res = await withTimeout(pdfParse(buffer), timeoutMs, 'Extração de PDF');
    const text = (res && typeof res.text === 'string') ? res.text.trim() : '';
    if (!text) {
      warnings.push({
        code: 'PDF_NO_TEXT',
        message: 'Nenhum texto encontrado no PDF (pode ser PDF escaneado/imagem).',
      });
    }
    return { text, warnings };
  } catch (err) {
    warnings.push({
      code: 'PDF_PARSE_FAILED',
      message: 'Falha ao extrair texto do PDF.',
      details: { error: safeErrorMessage(err) },
    });
    logger.warn('[FileExtraction] PDF parse failed', { error: safeErrorMessage(err) });
    return { text: '', warnings };
  }
}

/**
 * Extrai texto de imagem via OCR (tesseract.js).
 *
 * @param {Buffer} buffer
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ text: string, warnings: Array<{code: string, message: string, details?: any}> }>}
 */
async function extractImageTextOcr(buffer, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  /** @type {Array<{code: string, message: string, details?: any}>} */
  const warnings = [];

  let createWorker;
  try {
    // eslint-disable-next-line global-require
    ({ createWorker } = require('tesseract.js'));
  } catch (err) {
    warnings.push({
      code: 'OCR_FAILED',
      message: 'tesseract.js não está disponível para OCR.',
      details: { error: safeErrorMessage(err) },
    });
    return { text: '', warnings };
  }

  const run = async () => {
    const lang = safeToString(process.env.OCR_LANG || 'por+eng', 'por+eng');
    const psm = safeToString(process.env.OCR_PSM || '6', '6'); // 6 = bloco uniforme de texto (bom default)
    const enablePreprocess = safeToString(process.env.OCR_PREPROCESS || 'true', 'true').toLowerCase() !== 'false';

    const pre = await preprocessImageForOcr(buffer, { enabled: enablePreprocess });
    warnings.push(...pre.warnings);

    /** @type {Array<{label: string, buffer: Buffer}>} */
    const candidates = [
      ...pre.variants,
      { label: 'original', buffer },
    ];

    const worker = await createWorker();
    try {
      // por+eng cobre PT-BR e alguns casos mistos
      await worker.loadLanguage(lang);
      await worker.initialize(lang);

      // Best-effort: melhora separação de palavras e usa DPI mais adequado
      try {
        await worker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          tessedit_pageseg_mode: psm,
        });
      } catch (err) {
        warnings.push({
          code: 'OCR_PARAMS_UNSUPPORTED',
          message: 'Não foi possível aplicar parâmetros avançados do OCR. Continuando com defaults.',
          details: { error: safeErrorMessage(err) },
        });
      }

      /** @type {Array<{label: string, text: string, confidence?: number}>} */
      const results = [];

      for (const c of candidates) {
        const res = await worker.recognize(c.buffer);
        const text = res?.data?.text ? safeTrim(res.data.text) : '';
        const confidence = Number.isFinite(res?.data?.confidence) ? Number(res.data.confidence) : undefined;
        results.push({ label: c.label, text, confidence });

        // Heurística de early-exit: texto suficiente e confiança razoável
        if (text && text.length >= 120 && (confidence == null || confidence >= 45)) break;
      }

      const best = results
        .slice()
        .sort((a, b) => {
          const aScore = (a.text?.length || 0) + (Number.isFinite(a.confidence) ? a.confidence * 2 : 0);
          const bScore = (b.text?.length || 0) + (Number.isFinite(b.confidence) ? b.confidence * 2 : 0);
          return bScore - aScore;
        })[0] || { label: 'none', text: '' };

      if (results.length > 1) {
        warnings.push({
          code: 'OCR_MULTI_PASS',
          message: 'OCR executado em múltiplas tentativas e selecionado melhor resultado.',
          details: {
            tried: results.map(r => ({ label: r.label, chars: (r.text || '').length, confidence: r.confidence })),
            chosen: best.label,
          },
        });
      }

      if (!best.text) {
        warnings.push({
          code: 'OCR_NO_TEXT',
          message: 'OCR executado, mas nenhum texto foi encontrado na imagem.',
        });
      }

      return best.text;
    } finally {
      try { await worker.terminate(); } catch { /* ignora */ }
    }
  };

  try {
    const text = await withTimeout(run(), timeoutMs, 'OCR');
    return { text: cleanupOcrText(text), warnings };
  } catch (err) {
    warnings.push({
      code: 'OCR_FAILED',
      message: 'Falha ao executar OCR na imagem.',
      details: { error: safeErrorMessage(err) },
    });
    logger.warn('[FileExtraction] OCR failed', { error: safeErrorMessage(err) });
    return { text: '', warnings };
  }
}

/**
 * Extração de texto por tipo de arquivo.
 *
 * @param {{ buffer: Buffer, mimeType: string, filename: string }} file
 * @param {{ useOcr?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<{ extractedText: string, warnings: Array<{code: string, message: string, details?: any}> }>}
 */
async function extractTextFromFile(file, options = {}) {
  const mimeType = (file?.mimeType || '').toLowerCase();
  const filename = file?.filename || 'arquivo';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  /** @type {Array<{code: string, message: string, details?: any}>} */
  const warnings = [];

  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    return {
      extractedText: '',
      warnings: [{ code: 'FILE_BUFFER_MISSING', message: 'Buffer do arquivo não foi fornecido para extração.' }],
    };
  }

  if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    const pdf = await extractPdfText(file.buffer, { timeoutMs });
    warnings.push(...pdf.warnings);
    return { extractedText: pdf.text, warnings };
  }

  if (mimeType.startsWith('image/')) {
    const useOcr = options.useOcr === true;
    if (!useOcr) {
      warnings.push({
        code: 'OCR_DISABLED',
        message: 'OCR está desabilitado (USE_OCR!=true). Indexando metadados mínimos.',
        details: { mimeType, filename },
      });
      return { extractedText: '', warnings };
    }

    const ocr = await extractImageTextOcr(file.buffer, { timeoutMs });
    warnings.push(...ocr.warnings);
    return { extractedText: ocr.text, warnings };
  }

  // Texto simples (best-effort)
  if (mimeType.startsWith('text/')) {
    try {
      const text = withTimeout(Promise.resolve(file.buffer.toString('utf8')), timeoutMs, 'Leitura de texto');
      return { extractedText: (await text).trim(), warnings };
    } catch (err) {
      warnings.push({
        code: 'TEXT_READ_FAILED',
        message: 'Falha ao ler arquivo de texto.',
        details: { error: safeErrorMessage(err) },
      });
      return { extractedText: '', warnings };
    }
  }

  warnings.push({
    code: 'UNSUPPORTED_FILE_TYPE',
    message: 'Tipo de arquivo não suportado para extração automática. Indexando metadados mínimos.',
    details: { mimeType, filename },
  });
  return { extractedText: '', warnings };
}

module.exports = {
  extractTextFromFile,
  extractPdfText,
  extractImageTextOcr,
  cleanupOcrText,
};

