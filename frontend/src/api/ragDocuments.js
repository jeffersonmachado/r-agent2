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
 * Reindexa todos os documentos não indexados.
 * 
 * @param {string} [tenantId] - ID do tenant (opcional)
 * @param {boolean} [includeInconsistent=false] - Se true, também reindexa documentos marcados como indexados mas que podem não estar no vector store
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
export function reindexAllNotIndexed(tenantId = null, includeInconsistent = false) {
  const body = {};
  if (tenantId) body.tenantId = tenantId;
  if (includeInconsistent) body.includeInconsistent = true;
  
  return fetchJson('/rag/documents/reindex-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
 * Faz uma pergunta ao sistema RAG e retorna documentos relacionados.
 * 
 * @param {string} query - Pergunta do usuário
 * @param {string} [tenantId] - ID do tenant (opcional)
 * @param {Object} [options] - Opções (topK, minScore, maxTokens)
 * @returns {Promise<{success: boolean, response?: string, sources?: Array, confidence?: number, error?: string}>}
 */
export function queryRag(query, tenantId = null, options = {}) {
  if (!query || !query.trim()) {
    return Promise.reject(new Error('queryRag: query é obrigatório'));
  }

  const body = {
    query: query.trim(),
    ...(tenantId && { tenantId }),
    options: {
      topK: options.topK || 6,  // Aumentado de 5 para 6 para melhor cobertura
      minScore: options.minScore || 0.45,  // Reduzido de 0.5 para 0.45 para melhor taxa de sucesso
      maxTokens: options.maxTokens || 1000,
    },
  };

  return fetchJson('/rag/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Obtém a configuração de domínios RAG para um tenant.
 * 
 * @param {string} [tenantId] - ID do tenant (opcional)
 * @returns {Promise<Object>} Configuração de domínios
 */
export function getRagDomains(tenantId = null) {
  const params = new URLSearchParams();
  if (tenantId) params.append('tenantId', tenantId);

  const query = params.toString();
  const url = `/rag/domains${query ? `?${query}` : ''}`;

  return fetchJson(url, {
    method: 'GET',
  });
}

/**
 * Atualiza sinônimos aprendidos baseado em documentos.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {Array} documents - Lista de documentos
 * @returns {Promise<Object>} Resultado da atualização
 */
export function updateSynonymsFromDocuments(tenantId, documents) {
  if (!tenantId) {
    return Promise.reject(new Error('updateSynonymsFromDocuments: tenantId é obrigatório'));
  }

  return fetchJson('/rag/learning/update-synonyms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      documents: documents.map(doc => ({
        id: doc.id,
        title: doc.title || '',
        content: doc.content || '',
        metadata: doc.metadata || {},
      })),
    }),
  });
}

/**
 * Obtém métricas de aprendizado para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Métricas de aprendizado
 */
export function getLearningMetrics(tenantId) {
  if (!tenantId) {
    return Promise.reject(new Error('getLearningMetrics: tenantId é obrigatório'));
  }

  return fetchJson(`/rag/learning/metrics/${tenantId}`, {
    method: 'GET',
  });
}

/**
 * Dispara processo de aprendizado completo para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Resultado do aprendizado
 */
export function triggerLearning(tenantId) {
  if (!tenantId) {
    return Promise.reject(new Error('triggerLearning: tenantId é obrigatório'));
  }

  return fetchJson(`/rag/learning/trigger-learning/${tenantId}`, {
    method: 'POST',
  });
}

/**
 * Obtém todos os dados de aprendizado para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Dados completos de aprendizado
 */
export function getFullLearningData(tenantId) {
  if (!tenantId) {
    return Promise.reject(new Error('getFullLearningData: tenantId é obrigatório'));
  }

  return fetchJson(`/rag/learning/full-data/${tenantId}`, {
    method: 'GET',
  });
}

/**
 * Atualiza sinônimos de um termo específico.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} term - Termo principal
 * @param {Array<string>} synonyms - Lista de sinônimos
 * @returns {Promise<Object>} Resultado da atualização
 */
export function updateSynonym(tenantId, term, synonyms) {
  if (!tenantId || !term) {
    return Promise.reject(new Error('updateSynonym: tenantId e term são obrigatórios'));
  }

  return fetchJson('/rag/learning/synonyms', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      term,
      synonyms: Array.isArray(synonyms) ? synonyms : [synonyms],
    }),
  });
}

/**
 * Remove um sinônimo específico.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} term - Termo a remover
 * @returns {Promise<Object>} Resultado da remoção
 */
export function deleteSynonym(tenantId, term) {
  if (!tenantId || !term) {
    return Promise.reject(new Error('deleteSynonym: tenantId e term são obrigatórios'));
  }

  return fetchJson(`/rag/learning/synonyms/${tenantId}/${encodeURIComponent(term)}`, {
    method: 'DELETE',
  });
}

/**
 * Remove queries inválidas do histórico de aprendizado.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Resultado da limpeza
 */
export function cleanInvalidQueries(tenantId) {
  if (!tenantId) {
    return Promise.reject(new Error('cleanInvalidQueries: tenantId é obrigatório'));
  }

  return fetchJson(`/rag/learning/clean-invalid-queries/${tenantId}`, {
    method: 'POST',
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
        
        // PRIORIDADE: Se o conteúdo extraído já foi fornecido nos metadados (OCR, PDF, texto extraído), usa ele
        if (options.metadata?.extractedContent) {
          documentContent = options.metadata.extractedContent;
          logger.debug('Usando conteúdo extraído fornecido nos metadados', {
            fileName,
            contentLength: documentContent.length,
          });
        } else if (file.type.startsWith('image/')) {
          // Para imagens sem OCR pré-processado, usa placeholder informativo
          documentContent = `[Imagem: ${fileName}]\n\nEsta imagem foi enviada para indexação no RAG. Se necessário, use OCR para extrair texto da imagem.`;
        } else if (file.type.startsWith('text/') || ['txt', 'md', 'json', 'csv'].includes(fileExtension)) {
          // Se for texto, usa diretamente
          documentContent = content;
        } else if (fileExtension === 'pdf') {
          // Para PDF sem extração prévia, usa placeholder
          // Nota: O conteúdo deve ser extraído antes de chamar uploadDocument
          documentContent = `[PDF: ${fileName}]\n\nConteúdo do PDF não foi extraído. Use processFile() antes de chamar uploadDocument() para extrair o texto.`;
        } else {
          // Para outros tipos, tenta usar como texto ou usa placeholder
          try {
            documentContent = content;
          } catch {
            documentContent = `[Arquivo: ${fileName} - Tipo: ${file.type}]\n\nConteúdo não foi extraído. Use processFile() antes de chamar uploadDocument() para extrair o conteúdo.`;
          }
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
      // Para imagens e outros tipos, lê como data URL
      reader.readAsDataURL(file);
    }
  });
}

