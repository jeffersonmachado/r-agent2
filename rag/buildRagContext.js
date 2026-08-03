/**
 * Builder de Contexto RAG
 * 
 * Responsável por construir o contexto RAG obrigatório quando useRag=true.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Se useRag=true, DEVE retornar chunks suficientes (minChunks)
 * - Se não houver chunks suficientes, FALHA
 * - Todos os chunks devem ser vinculados ao executionId
 * - Retorna lista explícita de fontes
 * - Garante determinismo: mesma execução = mesmo contexto
 */

const logger = require('../api/utils/logger');
const { fetchRagContext, inferCategories } = require('./ragPipelineAdapter');
const { getCachedContext, setCachedContext } = require('./ragContextCache');
const fs = require('fs');
const path = require('path');

// Contrato RAG é estático por processo: memoiza em nível de módulo para
// evitar readFileSync + JSON.parse a cada execução. `undefined` = ainda não
// carregado; `null` = carga tentada e falhou (também memoizado).
let cachedRagContract;

/**
 * Carrega o contrato RAG.
 * 
 * @returns {Object|null} Contrato RAG ou null
 */
function loadRagContract() {
  if (cachedRagContract !== undefined) {
    return cachedRagContract;
  }
  try {
    const contractPath = path.join(__dirname, '..', 'contracts', 'rag.contract.json');
    if (!fs.existsSync(contractPath)) {
      logger.warn('[buildRagContext] Contrato RAG não encontrado');
      cachedRagContract = null;
      return cachedRagContract;
    }
    const content = fs.readFileSync(contractPath, 'utf8');
    cachedRagContract = JSON.parse(content);
    return cachedRagContract;
  } catch (err) {
    logger.error('[buildRagContext] Erro ao carregar contrato RAG', err);
    cachedRagContract = null;
    return cachedRagContract;
  }
}

// inferCategories agora é importado do adaptador

/**
 * Constrói contexto RAG para uma execução.
 * 
 * @param {string} executionId - ID da execução
 * @param {Object} payload - Payload da execução
 * @param {Object} options - Opções (tenantId, useRag, etc)
 * @returns {Promise<{chunks: Array, sources: Array, success: boolean, error?: string}>}
 */
async function buildRagContext(executionId, payload, options = {}) {
  const tenantId = options.tenantId; // Tenant deve ser fornecido explicitamente
  const useRag = options.useRag !== false && payload.useRag !== false;
  
  // Se RAG não está habilitado, retorna vazio mas sucesso
  if (!useRag) {
    logger.debug('[buildRagContext] RAG não habilitado, retornando contexto vazio', {
      executionId,
    });
    return {
      chunks: [],
      sources: [],
      success: true,
    };
  }
  
  // Carrega contrato RAG
  const contract = loadRagContract();
  if (!contract) {
    throw new Error('Contrato RAG não encontrado');
  }
  
  const minChunks = contract.rag?.grounding?.minChunks || 3;
  const mandatoryWhenEnabled = contract.rag?.grounding?.mandatoryWhenEnabled !== false;
  
  // Infere categorias
  const categories = inferCategories(payload);
  
  // Prepara query baseada na descrição do payload
  const query = payload.description || payload.name || 'contexto geral';
  
  logger.info('[buildRagContext] Construindo contexto RAG', {
    executionId,
    tenantId,
    query: query.substring(0, 100),
    categories,
    minChunks,
  });
  
  try {
    // Verifica cache primeiro (determinismo: mesma execução = mesmo contexto)
    let ragContext = getCachedContext(executionId);
    
    if (ragContext) {
      logger.info('[buildRagContext] Reutilizando contexto RAG do cache (determinismo)', {
        executionId,
        chunksCount: ragContext.chunks.length,
        sourcesCount: ragContext.sources.length,
      });
    } else {
      // Usa adaptador para buscar contexto RAG (garante determinismo e executionId)
      ragContext = await fetchRagContext({
        executionId,
        tenantId,
        categories,
        query,
      });
      
      // Armazena no cache para reutilização
      if (ragContext.success) {
        setCachedContext(executionId, ragContext);
      }
    }
    
    if (!ragContext.success) {
      const errorMsg = ragContext.error || 'Erro desconhecido ao construir contexto RAG';
      logger.error('[buildRagContext] Falha ao construir contexto RAG', {
        executionId,
        error: errorMsg,
      });
      
      if (mandatoryWhenEnabled) {
        throw new Error(errorMsg);
      }
      
      return ragContext;
    }
    
    logger.info('[buildRagContext] Contexto RAG construído com sucesso', {
      executionId,
      chunksCount: ragContext.chunks.length,
      sourcesCount: ragContext.sources.length,
      minChunks,
    });
    
    // Log estruturado para auditoria
    logger.info(`[RAG][${executionId}] contextBuilt chunks=${ragContext.chunks.length} sources=${ragContext.sources.length}`, {
      executionId,
      chunks: ragContext.chunks.map(c => ({
        chunkId: c.chunkId,
        sourceFile: c.sourceFile,
        category: c.category,
        score: c.score,
      })),
      sources: ragContext.sources.map(s => ({
        documentId: s.documentId,
        chunksCount: s.chunksCount,
      })),
    });
    
    return ragContext;
  } catch (error) {
    logger.error('[buildRagContext] Erro ao construir contexto RAG', {
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
  buildRagContext,
};

