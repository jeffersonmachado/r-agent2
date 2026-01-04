import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Funções para trabalhar com documentos RAG.
 */

/**
 * Lista documentos com filtros opcionais.
 * 
 * @param {Object} [filters] - Filtros
 * @param {string} [filters.tenantId] - ID do tenant
 * @param {string} [filters.source] - Fonte (knowledge_base, product_docs, tickets, etc)
 * @param {string} [filters.category] - Categoria
 * @param {string} [filters.productId] - ID do produto
 * @param {string} [filters.clientId] - ID do cliente
 * @param {string} [filters.status] - Status (active, archived, deleted)
 * @param {string} [filters.search] - Busca por texto
 * @returns {Promise<Array>} Lista de documentos
 */
export function listDocuments(filters = {}) {
  const params = new URLSearchParams();
  
  if (filters.tenantId) params.append('tenantId', filters.tenantId);
  if (filters.source) params.append('source', filters.source);
  if (filters.category) params.append('category', filters.category);
  if (filters.productId) params.append('productId', filters.productId);
  if (filters.clientId) params.append('clientId', filters.clientId);
  if (filters.status) params.append('status', filters.status);
  if (filters.search) params.append('search', filters.search);

  const query = params.toString();
  const url = `/rag/documents${query ? `?${query}` : ''}`;

  return fetchJson(url, {
    method: 'GET',
  });
}

/**
 * Obtém um documento específico.
 * 
 * @param {string} documentId - ID do documento
 * @returns {Promise<Object>} Documento
 */
export function getDocument(documentId) {
  if (!documentId) {
    return Promise.reject(new Error('getDocument: documentId é obrigatório'));
  }

  return fetchJson(`/rag/documents/${encodeURIComponent(documentId)}`, {
    method: 'GET',
  });
}

/**
 * Cria um novo documento.
 * 
 * @param {Object} documentData - Dados do documento
 * @param {string} documentData.title - Título
 * @param {string} documentData.content - Conteúdo
 * @param {Object} [documentData.metadata] - Metadados
 * @param {Object} [documentData.permissions] - Permissões
 * @param {boolean} [documentData.autoIndex=true] - Indexar automaticamente
 * @returns {Promise<Object>} Documento criado
 */
export function createDocument(documentData) {
  if (!documentData.title || !documentData.content) {
    return Promise.reject(new Error('createDocument: title e content são obrigatórios'));
  }

  return fetchJson('/rag/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(documentData),
  });
}

/**
 * Atualiza um documento existente.
 * 
 * @param {string} documentId - ID do documento
 * @param {Object} updates - Atualizações
 * @param {boolean} [updates.reindex=false] - Reindexar após atualização
 * @returns {Promise<Object>} Documento atualizado
 */
export function updateDocument(documentId, updates) {
  if (!documentId) {
    return Promise.reject(new Error('updateDocument: documentId é obrigatório'));
  }

  return fetchJson(`/rag/documents/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
}

/**
 * Deleta um documento.
 * 
 * @param {string} documentId - ID do documento
 * @returns {Promise<{success: boolean}>}
 */
export function deleteDocument(documentId) {
  if (!documentId) {
    return Promise.reject(new Error('deleteDocument: documentId é obrigatório'));
  }

  return fetchJson(`/rag/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

/**
 * Reindexa um documento.
 * 
 * @param {string} documentId - ID do documento
 * @returns {Promise<{success: boolean, chunksCreated: number}>}
 */
export function reindexDocument(documentId) {
  if (!documentId) {
    return Promise.reject(new Error('reindexDocument: documentId é obrigatório'));
  }

  return fetchJson(`/rag/documents/${encodeURIComponent(documentId)}/reindex`, {
    method: 'POST',
  });
}

/**
 * Obtém estatísticas de documentos.
 * 
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<Object>} Estatísticas
 */
export function getDocumentsStats(tenantId = null) {
  const params = new URLSearchParams();
  if (tenantId) params.append('tenantId', tenantId);

  const query = params.toString();
  const url = `/rag/documents/stats${query ? `?${query}` : ''}`;

  return fetchJson(url, {
    method: 'GET',
  });
}

/**
 * Processa um arquivo e cria um documento RAG.
 * 
 * @param {File} file - Arquivo a ser processado
 * @param {Object} options - Opções (metadata, autoIndex)
 * @returns {Promise<Object>} Documento criado
 */
export async function uploadDocument(file, options = {}) {
  if (!file) {
    return Promise.reject(new Error('uploadDocument: file é obrigatório'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const content = e.target.result;
        const fileName = file.name;
        const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
        
        // Extrai título do nome do arquivo (sem extensão)
        const title = fileName.replace(/\.[^/.]+$/, '');
        
        // Processa conteúdo baseado no tipo de arquivo
        let documentContent = content;
        
        // Se for texto, usa diretamente
        if (file.type.startsWith('text/') || ['txt', 'md', 'json', 'csv'].includes(fileExtension)) {
          documentContent = content;
        } else if (fileExtension === 'pdf') {
          // Para PDF, precisaria de uma biblioteca específica
          // Por enquanto, tenta extrair texto se possível
          documentContent = content;
        }
        
        const documentData = {
          title: title,
          content: documentContent,
          metadata: {
            source: 'upload',
            category: options.category || null,
            tags: options.tags || [],
            fileName: fileName,
            fileType: file.type,
            fileSize: file.size,
            ...options.metadata,
          },
          autoIndex: options.autoIndex !== false,
        };
        
        const result = await createDocument(documentData);
        resolve(result);
      } catch (error) {
        logger.error('Erro ao processar arquivo', error);
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Erro ao ler arquivo'));
    };
    
    // Lê como texto para arquivos de texto, ou como data URL para outros
    if (file.type.startsWith('text/') || ['txt', 'md', 'json', 'csv'].includes(file.name.split('.').pop()?.toLowerCase() || '')) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  });
}

