/**
 * Cache de Contexto RAG por ExecutionId
 * 
 * Garante determinismo: mesma execução = mesmo contexto RAG.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Reexecução com mesmo executionId reutiliza o mesmo contexto
 * - Nunca gera contexto novo se já existe cache
 * - Cache persiste durante a execução do processo
 * 
 * NOTA: Em produção, isso pode ser substituído por cache distribuído (Redis, etc.)
 */

const logger = require('../api/utils/logger');
const fs = require('fs');
const path = require('path');

// Cache em memória (por executionId)
const contextCache = new Map();

// Diretório para persistência opcional (se necessário)
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'rag-contexts');

/**
 * Garante que o diretório de cache existe.
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Obtém contexto RAG do cache (se existir).
 * 
 * @param {string} executionId - ID da execução
 * @returns {Object|null} Contexto RAG em cache ou null
 */
function getCachedContext(executionId) {
  if (!executionId) {
    return null;
  }
  
  // Tenta cache em memória primeiro
  if (contextCache.has(executionId)) {
    const cached = contextCache.get(executionId);
    logger.debug('[ragContextCache] Contexto RAG encontrado em cache (memória)', {
      executionId,
      chunksCount: cached.chunks?.length || 0,
      sourcesCount: cached.sources?.length || 0,
    });
    return cached;
  }
  
  // Tenta cache em disco (se habilitado)
  try {
    ensureCacheDir();
    const cacheFile = path.join(CACHE_DIR, `${executionId}.json`);
    if (fs.existsSync(cacheFile)) {
      const content = fs.readFileSync(cacheFile, 'utf8');
      const cached = JSON.parse(content);
      
      // Restaura no cache em memória
      contextCache.set(executionId, cached);
      
      logger.debug('[ragContextCache] Contexto RAG encontrado em cache (disco)', {
        executionId,
        chunksCount: cached.chunks?.length || 0,
        sourcesCount: cached.sources?.length || 0,
      });
      
      return cached;
    }
  } catch (err) {
    logger.warn('[ragContextCache] Erro ao ler cache do disco', {
      executionId,
      error: err.message,
    });
  }
  
  return null;
}

/**
 * Armazena contexto RAG no cache.
 * 
 * @param {string} executionId - ID da execução
 * @param {Object} ragContext - Contexto RAG a ser armazenado
 */
function setCachedContext(executionId, ragContext) {
  if (!executionId || !ragContext) {
    return;
  }
  
  // Armazena em memória
  contextCache.set(executionId, ragContext);
  
  logger.debug('[ragContextCache] Contexto RAG armazenado em cache', {
    executionId,
    chunksCount: ragContext.chunks?.length || 0,
    sourcesCount: ragContext.sources?.length || 0,
  });
  
  // Opcional: persiste em disco (para sobrevivência entre reinicializações)
  try {
    ensureCacheDir();
    const cacheFile = path.join(CACHE_DIR, `${executionId}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(ragContext, null, 2), 'utf8');
  } catch (err) {
    logger.warn('[ragContextCache] Erro ao persistir cache no disco', {
      executionId,
      error: err.message,
    });
  }
}

/**
 * Limpa contexto RAG do cache.
 * 
 * @param {string} executionId - ID da execução (opcional, se não fornecido limpa tudo)
 */
function clearCachedContext(executionId = null) {
  if (executionId) {
    contextCache.delete(executionId);
    
    // Remove do disco também
    try {
      const cacheFile = path.join(CACHE_DIR, `${executionId}.json`);
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }
    } catch (err) {
      logger.warn('[ragContextCache] Erro ao remover cache do disco', {
        executionId,
        error: err.message,
      });
    }
  } else {
    // Limpa tudo
    contextCache.clear();
    
    // Limpa disco também
    try {
      if (fs.existsSync(CACHE_DIR)) {
        const files = fs.readdirSync(CACHE_DIR);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(CACHE_DIR, file));
          }
        });
      }
    } catch (err) {
      logger.warn('[ragContextCache] Erro ao limpar cache do disco', {
        error: err.message,
      });
    }
  }
}

/**
 * Verifica se existe contexto RAG em cache.
 * 
 * @param {string} executionId - ID da execução
 * @returns {boolean} True se existe cache
 */
function hasCachedContext(executionId) {
  if (!executionId) {
    return false;
  }
  
  if (contextCache.has(executionId)) {
    return true;
  }
  
  try {
    const cacheFile = path.join(CACHE_DIR, `${executionId}.json`);
    return fs.existsSync(cacheFile);
  } catch {
    return false;
  }
}

module.exports = {
  getCachedContext,
  setCachedContext,
  clearCachedContext,
  hasCachedContext,
};

