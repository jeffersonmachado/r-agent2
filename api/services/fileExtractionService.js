const logger = require('../utils/logger');

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
      details: { error: err.message },
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
      details: { error: err.message || String(err) },
    });
    logger.warn('[FileExtraction] PDF parse failed', { error: err.message });
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
      details: { error: err.message },
    });
    return { text: '', warnings };
  }

  const run = async () => {
    const worker = await createWorker();
    try {
      // por+eng cobre PT-BR e alguns casos mistos
      await worker.loadLanguage('por+eng');
      await worker.initialize('por+eng');
      const res = await worker.recognize(buffer);
      const text = res?.data?.text ? String(res.data.text).trim() : '';
      if (!text) {
        warnings.push({
          code: 'OCR_NO_TEXT',
          message: 'OCR executado, mas nenhum texto foi encontrado na imagem.',
        });
      }
      return text;
    } finally {
      try { await worker.terminate(); } catch { /* ignora */ }
    }
  };

  try {
    const text = await withTimeout(run(), timeoutMs, 'OCR');
    return { text, warnings };
  } catch (err) {
    warnings.push({
      code: 'OCR_FAILED',
      message: 'Falha ao executar OCR na imagem.',
      details: { error: err.message || String(err) },
    });
    logger.warn('[FileExtraction] OCR failed', { error: err.message });
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
        details: { error: err.message || String(err) },
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
};

