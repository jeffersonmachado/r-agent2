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

  // OCR será implementado no próximo commit (mantém pipeline robusto)
  if (mimeType.startsWith('image/')) {
    warnings.push({
      code: 'OCR_DISABLED',
      message: 'OCR ainda não foi executado para esta imagem. Indexando metadados mínimos.',
      details: { mimeType, filename },
    });
    return { extractedText: '', warnings };
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
};

