/**
 * Adaptador RAG para Pipeline
 * 
 * Responsabilidade única: Integrar rag-service ao pipeline de forma determinística.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Sempre envia executionId ao rag-service
 * - Rejeita respostas vazias quando RAG estiver habilitado
 * - Nunca permite fallback silencioso
 * - Garante determinismo por executionId
 * 
 * Este módulo é a ÚNICA interface entre o pipeline e o rag-service.
 */

const logger = require('../api/utils/logger');
const ragService = require('../api/services/ragService');
const fs = require('fs');
const path = require('path');

/**
 * Carrega o contrato RAG.
 * 
 * @returns {Object|null} Contrato RAG ou null
 */
function loadRagContract() {
  try {
    const contractPath = path.join(__dirname, '..', 'contracts', 'rag.contract.json');
    if (!fs.existsSync(contractPath)) {
      logger.warn('[ragPipelineAdapter] Contrato RAG não encontrado');
      return null;
    }
    const content = fs.readFileSync(contractPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    logger.error('[ragPipelineAdapter] Erro ao carregar contrato RAG', err);
    return null;
  }
}

/**
 * Infere categorias a partir do payload.
 * 
 * @param {Object} payload - Payload da execução
 * @returns {string[]} Lista de categorias inferidas
 */
function inferCategories(payload) {
  const categories = [];
  
  // Inferência básica baseada em campos do payload
  if (payload.description) {
    const desc = payload.description.toLowerCase();
    
    if (desc.includes('preço') || desc.includes('preco') || desc.includes('tabela') || desc.includes('valor')) {
      categories.push('tabelas_preco');
    }
    
    if (desc.includes('promoção') || desc.includes('promocao') || desc.includes('desconto') || desc.includes('oferta')) {
      categories.push('promocoes');
    }
    
    if (desc.includes('aviso') || desc.includes('comunicado') || desc.includes('notícia') || desc.includes('noticia')) {
      categories.push('avisos');
    }
  }
  
  // Se não inferiu nenhuma, usa default
  if (categories.length === 0) {
    categories.push('default');
  }
  
  return categories;
}

/**
 * Busca contexto RAG para o pipeline.
 * 
 * Esta é a ÚNICA função que o pipeline deve usar para obter contexto RAG.
 * 
 * @param {Object} params - Parâmetros
 * @param {string} params.executionId - ID da execução (OBRIGATÓRIO)
 * @param {string} params.tenantId - ID do tenant
 * @param {string[]} params.categories - Categorias para filtrar (opcional, será inferido se não fornecido)
 * @param {string} params.query - Query para busca RAG
 * @returns {Promise<{chunks: Array, sources: Array, success: boolean, error?: string}>}
 */
async function fetchRagContext({ executionId, tenantId, categories, query }) {
  // Validação obrigatória
  if (!executionId) {
    throw new Error('executionId é obrigatório para buscar contexto RAG');
  }
  
  if (!query || !query.trim()) {
    throw new Error('query é obrigatória para buscar contexto RAG');
  }
  
  const contract = loadRagContract();
  if (!contract) {
    throw new Error('Contrato RAG não encontrado');
  }
  
  // Verifica se executionId é obrigatório
  if (contract.rag?.requiresExecutionId !== false && !executionId) {
    throw new Error('Contrato RAG exige executionId, mas não foi fornecido');
  }
  
  const tenant = tenantId || 'tenant-demo';
  const cats = categories || inferCategories({ description: query });
  const minChunks = contract.rag?.grounding?.minChunks || 3;
  const mandatoryWhenEnabled = contract.rag?.grounding?.mandatoryWhenEnabled !== false;
  
  // Prepara filtros
  const filters = {
    category: cats[0] || null,
    topK: contract.rag?.chunking?.maxTokens ? Math.ceil(contract.rag.chunking.maxTokens / 100) : 6,
    minScore: 0.45,
    maxTokens: contract.rag?.chunking?.maxTokens || 1000,
  };
  
  logger.info('[ragPipelineAdapter] Buscando contexto RAG', {
    executionId,
    tenantId: tenant,
    query: query.substring(0, 100),
    categories: cats,
    minChunks,
  });
  
  try {
    // Consulta RAG com executionId explícito
    const ragResult = await ragService.queryRag(query, tenant, {
      executionId, // SEMPRE envia executionId
      sessionId: null,
      flowId: null,
    }, filters);
    
    if (!ragResult.success) {
      const errorMsg = `RAG falhou ao buscar contexto: ${ragResult.error || 'erro desconhecido'}`;
      logger.error('[ragPipelineAdapter] RAG falhou', {
        executionId,
        error: ragResult.error,
      });
      
      if (mandatoryWhenEnabled) {
        throw new Error(errorMsg);
      }
      
      return {
        chunks: [],
        sources: [],
        success: false,
        error: errorMsg,
      };
    }
    
    // Processa chunks e sources
    const chunks = (ragResult.sources || []).map((source, index) => ({
      chunkId: `chunk-${executionId}-${index}`,
      sourceFile: source.documentId || source.source || 'unknown',
      category: source.category || cats[0] || 'default',
      executionId, // Vincula chunk ao executionId
      content: source.content || source.text || '',
      score: source.score || 0.0,
      metadata: {
        ...(source.metadata || {}),
        executionId, // Metadata também contém executionId
      },
    }));
    
    const sources = [...new Set(chunks.map(c => c.sourceFile))].map(sourceFile => ({
      documentId: sourceFile,
      executionId, // Vincula source ao executionId
      chunksCount: chunks.filter(c => c.sourceFile === sourceFile).length,
    }));
    
    // Valida mínimo de chunks
    if (chunks.length < minChunks) {
      const errorMsg = `RAG retornou apenas ${chunks.length} chunks, mínimo requerido: ${minChunks}`;
      logger.error('[ragPipelineAdapter] Chunks insuficientes', {
        executionId,
        chunksFound: chunks.length,
        minChunks,
      });
      
      if (mandatoryWhenEnabled) {
        throw new Error(errorMsg);
      }
      
      return {
        chunks,
        sources,
        success: false,
        error: errorMsg,
      };
    }
    
    // Valida que há pelo menos uma fonte
    if (sources.length === 0) {
      const errorMsg = 'RAG não retornou nenhuma fonte. Grounding inválido.';
      logger.error('[ragPipelineAdapter] Nenhuma fonte RAG', {
        executionId,
      });
      
      if (mandatoryWhenEnabled) {
        throw new Error(errorMsg);
      }
      
      return {
        chunks,
        sources,
        success: false,
        error: errorMsg,
      };
    }
    
    logger.info('[ragPipelineAdapter] Contexto RAG obtido com sucesso', {
      executionId,
      chunksCount: chunks.length,
      sourcesCount: sources.length,
      minChunks,
    });
    
    // Log estruturado para auditoria
    logger.info(`[RAG][${executionId}] contextFetched chunks=${chunks.length} sources=${sources.length}`, {
      executionId,
      chunks: chunks.map(c => ({
        chunkId: c.chunkId,
        sourceFile: c.sourceFile,
        category: c.category,
        score: c.score,
      })),
      sources: sources.map(s => ({
        documentId: s.documentId,
        chunksCount: s.chunksCount,
      })),
    });
    
    return {
      chunks,
      sources,
      success: true,
    };
  } catch (error) {
    logger.error('[ragPipelineAdapter] Erro ao buscar contexto RAG', {
      executionId,
      error: error.message,
      stack: error.stack,
    });
    
    if (mandatoryWhenEnabled) {
      throw error;
    }
    
    return {
      chunks: [],
      sources: [],
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  fetchRagContext,
  inferCategories,
};

