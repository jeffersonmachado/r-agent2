/**
 * Utilitários para processar arquivos no chat
 */

import logger from './logger';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Importações dinâmicas para bibliotecas opcionais
let pdfjsLib = null;
let Tesseract = null;
let imageCompression = null;

// Carrega pdfjs-dist dinamicamente
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  try {
    pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
    // Configura worker
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    }
    return pdfjsLib;
  } catch (error) {
    logger.warn('pdfjs-dist não disponível', error);
    return null;
  }
}

// Carrega Tesseract.js dinamicamente
async function loadTesseract() {
  if (Tesseract) return Tesseract;
  try {
    Tesseract = await import('tesseract.js');
    return Tesseract;
  } catch (error) {
    logger.warn('tesseract.js não disponível', error);
    return null;
  }
}

// Carrega browser-image-compression dinamicamente
async function loadImageCompression() {
  if (imageCompression) return imageCompression;
  try {
    imageCompression = await import('browser-image-compression');
    return imageCompression;
  } catch (error) {
    logger.warn('browser-image-compression não disponível', error);
    return null;
  }
}

/**
 * Cria preview de imagem
 * 
 * @param {File} file - Arquivo de imagem
 * @returns {Promise<string>} Data URL da imagem
 */
export async function createImagePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Erro ao ler arquivo de imagem'));
    reader.readAsDataURL(file);
  });
}

/**
 * Extrai conteúdo de texto de um arquivo
 * 
 * @param {File} file - Arquivo de texto
 * @returns {Promise<string>} Conteúdo do arquivo como texto
 */
export async function extractTextContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Erro ao ler arquivo de texto'));
    reader.readAsText(file);
  });
}

/**
 * Extrai conteúdo de PDF usando pdfjs-dist
 * 
 * @param {File} file - Arquivo PDF
 * @param {Function} onProgress - Callback de progresso (opcional)
 * @returns {Promise<string>} Conteúdo extraído do PDF
 */
export async function extractPdfContent(file, onProgress = null) {
  try {
    const pdfjs = await loadPdfJs();
    if (!pdfjs) {
      logger.warn('pdfjs-dist não disponível, retornando placeholder');
      return `[PDF: ${file.name}]\n\nNota: Biblioteca de extração de PDF não está disponível.`;
    }

    // Converte File para ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Carrega o PDF
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const numPages = pdf.numPages;
    const textParts = [];
    
    // Extrai texto de cada página
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onProgress) {
        onProgress((pageNum / numPages) * 100);
      }
      
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Concatena texto da página
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      
      if (pageText.trim()) {
        textParts.push(`--- Página ${pageNum} ---\n${pageText}`);
      }
    }
    
    const extractedText = textParts.join('\n\n');
    
    if (!extractedText.trim()) {
      return `[PDF: ${file.name}]\n\nNenhum texto encontrado no PDF. O arquivo pode conter apenas imagens.`;
    }
    
    return extractedText;
  } catch (error) {
    logger.error('Erro ao extrair conteúdo do PDF', {
      fileName: file.name,
      error: error.message,
    });
    return `[PDF: ${file.name}]\n\nErro ao extrair texto: ${error.message}`;
  }
}

/**
 * Extrai conteúdo de imagem usando OCR (Tesseract.js)
 * 
 * @param {File} file - Arquivo de imagem
 * @param {Function} onProgress - Callback de progresso (opcional)
 * @returns {Promise<string>} Texto extraído da imagem via OCR
 */
export async function extractImageContent(file, onProgress = null) {
  try {
    const tesseract = await loadTesseract();
    if (!tesseract) {
      logger.warn('Tesseract.js não disponível, retornando placeholder');
      return `[Imagem: ${file.name}]\n\nNota: Biblioteca de OCR não está disponível.`;
    }

    // Cria URL da imagem
    const imageUrl = URL.createObjectURL(file);
    
    try {
      // Executa OCR
      const { data: { text } } = await tesseract.recognize(
        imageUrl,
        'por+eng', // Português e Inglês
        {
          logger: (m) => {
            if (onProgress && m.status === 'recognizing text') {
              onProgress(m.progress * 100);
            }
          },
        }
      );
      
      // Limpa URL
      URL.revokeObjectURL(imageUrl);
      
      if (!text || !text.trim()) {
        return `[Imagem: ${file.name}]\n\nNenhum texto encontrado na imagem via OCR.`;
      }
      
      return `[Imagem: ${file.name}]\n\nTexto extraído (OCR):\n${text.trim()}`;
    } catch (ocrError) {
      URL.revokeObjectURL(imageUrl);
      throw ocrError;
    }
  } catch (error) {
    logger.error('Erro ao extrair conteúdo da imagem', {
      fileName: file.name,
      error: error.message,
    });
    return `[Imagem: ${file.name}]\n\nErro ao extrair texto: ${error.message}`;
  }
}

/**
 * Comprime imagem antes do upload
 * 
 * @param {File} file - Arquivo de imagem
 * @param {Object} options - Opções de compressão
 * @returns {Promise<File>} Arquivo comprimido
 */
export async function compressImage(file, options = {}) {
  try {
    const compression = await loadImageCompression();
    if (!compression) {
      logger.warn('browser-image-compression não disponível, retornando arquivo original');
      return file;
    }

    const defaultOptions = {
      maxSizeMB: 1, // Tamanho máximo em MB
      maxWidthOrHeight: 1920, // Dimensão máxima
      useWebWorker: true,
      ...options,
    };

    const compressedFile = await compression.default(file, defaultOptions);
    
    logger.debug('Imagem comprimida', {
      originalSize: formatFileSize(file.size),
      compressedSize: formatFileSize(compressedFile.size),
      reduction: `${((1 - compressedFile.size / file.size) * 100).toFixed(1)}%`,
    });
    
    return compressedFile;
  } catch (error) {
    logger.error('Erro ao comprimir imagem', {
      fileName: file.name,
      error: error.message,
    });
    // Retorna arquivo original em caso de erro
    return file;
  }
}

/**
 * Processa um arquivo e extrai seu conteúdo baseado no tipo
 * 
 * @param {File} file - Arquivo a ser processado
 * @param {Object} options - Opções de processamento
 * @param {Function} options.onProgress - Callback de progresso
 * @param {boolean} options.compressImages - Se deve comprimir imagens
 * @param {boolean} options.extractImageText - Se deve extrair texto de imagens (OCR)
 * @returns {Promise<{content: string, preview: string|null, file: File}>} Conteúdo, preview e arquivo (possivelmente comprimido)
 */
export async function processFile(file, options = {}) {
  const {
    onProgress = null,
    compressImages = true,
    extractImageText = false,
  } = options;

  let content = null;
  let preview = null;
  let processedFile = file;

  try {
    if (file.type.startsWith('image/')) {
      // Comprime imagem se solicitado
      if (compressImages) {
        if (onProgress) onProgress(10, 'Comprimindo imagem...');
        processedFile = await compressImage(file);
        if (onProgress) onProgress(30, 'Imagem comprimida');
      }

      // Cria preview
      if (onProgress) onProgress(40, 'Criando preview...');
      preview = await createImagePreview(processedFile);
      
      // Extrai texto da imagem se solicitado
      if (extractImageText) {
        if (onProgress) onProgress(50, 'Extraindo texto da imagem (OCR)...');
        content = await extractImageContent(processedFile, (progress) => {
          if (onProgress) onProgress(50 + (progress * 0.4), 'OCR em progresso...');
        });
      } else {
        content = `[Imagem: ${file.name}]`;
      }
    } else if (file.type === 'application/pdf') {
      // Para PDF, extrai texto
      if (onProgress) onProgress(10, 'Extraindo texto do PDF...');
      content = await extractPdfContent(file, (progress) => {
        if (onProgress) onProgress(10 + (progress * 0.8), 'Processando PDF...');
      });
    } else if (
      file.type.startsWith('text/') ||
      file.name.endsWith('.txt') ||
      file.name.endsWith('.md') ||
      file.name.endsWith('.json') ||
      file.name.endsWith('.csv')
    ) {
      // Para arquivos de texto, extrai conteúdo
      if (onProgress) onProgress(50, 'Lendo arquivo de texto...');
      content = await extractTextContent(file);
      if (onProgress) onProgress(100, 'Concluído');
    } else {
      // Para outros tipos, tenta extrair como texto
      try {
        if (onProgress) onProgress(50, 'Tentando ler como texto...');
        content = await extractTextContent(file);
        if (onProgress) onProgress(100, 'Concluído');
      } catch (error) {
        logger.warn('Não foi possível extrair conteúdo do arquivo', {
          fileName: file.name,
          fileType: file.type,
          error: error.message,
        });
        content = `[Arquivo: ${file.name} - Tipo: ${file.type}]`;
        if (onProgress) onProgress(100, 'Concluído');
      }
    }

    return { content, preview, file: processedFile };
  } catch (error) {
    logger.error('Erro ao processar arquivo', {
      fileName: file.name,
      fileType: file.type,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Valida tamanho e tipo de arquivo
 * 
 * @param {File} file - Arquivo a validar
 * @param {number} maxSizeMB - Tamanho máximo em MB (padrão: 10MB)
 * @param {string[]} allowedTypes - Tipos MIME permitidos (vazio = todos)
 * @returns {boolean} true se válido
 * @throws {Error} Se arquivo for inválido
 */
export function validateFile(file, maxSizeMB = 10, allowedTypes = []) {
  const maxSize = maxSizeMB * 1024 * 1024;
  
  if (file.size > maxSize) {
    throw new Error(`Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`);
  }
  
  if (allowedTypes.length > 0) {
    const isAllowed = allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        // Tipo genérico (ex: image/*)
        const baseType = type.slice(0, -2);
        return file.type.startsWith(baseType);
      }
      return file.type === type || file.type.match(type);
    });
    
    if (!isAllowed) {
      throw new Error(
        `Tipo de arquivo não permitido. Tipos permitidos: ${allowedTypes.join(', ')}`
      );
    }
  }
  
  return true;
}

/**
 * Formata tamanho de arquivo para exibição
 * 
 * @param {number} bytes - Tamanho em bytes
 * @returns {string} Tamanho formatado (ex: "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Obtém ícone baseado no tipo de arquivo
 * 
 * @param {string} fileType - Tipo MIME do arquivo
 * @returns {string} Emoji ou símbolo representando o tipo
 */
export function getFileIcon(fileType) {
  if (fileType.startsWith('image/')) return '🖼️';
  if (fileType === 'application/pdf') return '📄';
  if (fileType.startsWith('text/')) return '📝';
  if (fileType.includes('word') || fileType.includes('document')) return '📘';
  if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊';
  if (fileType.includes('zip') || fileType.includes('archive')) return '📦';
  return '📎';
}

