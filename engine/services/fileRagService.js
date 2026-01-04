/**
 * Serviço para indexar arquivos do chat no RAG
 */

const ragDocumentsService = require('../../api/services/ragDocumentsService');
const logger = require('../../api/utils/logger');

/**
 * Indexa arquivos no RAG
 * 
 * @param {Array} files - Array de arquivos { name, type, size, content }
 * @param {string} tenantId - ID do tenant
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Array>} Resultados da indexação
 */
async function indexFilesInRag(files, tenantId, options = {}) {
  const results = [];
  
  if (!files || !Array.isArray(files) || files.length === 0) {
    return results;
  }

  for (const file of files) {
    try {
      if (!file.content || file.content.startsWith('[')) {
        // Ignora arquivos sem conteúdo extraído ou placeholders
        continue;
      }

      const documentData = {
        title: file.name,
        content: file.content,
        metadata: {
          source: 'chat_upload',
          category: options.category || getFileCategory(file.type),
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          ...options.metadata,
        },
        autoIndex: options.autoIndex !== false, // Indexa por padrão
      };

      const result = await ragDocumentsService.createDocument(documentData, tenantId);

      results.push({
        file: file.name,
        success: result.success,
        documentId: result.document?.id,
        error: result.error || null,
      });

      if (result.success) {
        logger.debug('Arquivo indexado no RAG', {
          fileName: file.name,
          documentId: result.document.id,
          tenantId,
        });
      }
    } catch (error) {
      logger.error('Erro ao indexar arquivo no RAG', {
        fileName: file.name,
        error: error.message,
        tenantId,
      });
      results.push({
        file: file.name,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Determina categoria do arquivo baseado no tipo
 * 
 * @param {string} fileType - Tipo MIME do arquivo
 * @returns {string} Categoria
 */
function getFileCategory(fileType) {
  if (fileType.startsWith('image/')) return 'imagem';
  if (fileType === 'application/pdf') return 'documento';
  if (fileType.startsWith('text/')) return 'texto';
  return 'outro';
}

module.exports = {
  indexFilesInRag,
  getFileCategory,
};

