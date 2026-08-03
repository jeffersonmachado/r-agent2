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
 * LIMITES (evita crescimento sem bound):
 * - TTL em memória e disco (default 1h; env RAG_CONTEXT_CACHE_TTL_MS)
 * - Capacidade máxima em memória com evicção do mais antigo
 *   (default 500 entradas; env RAG_CONTEXT_CACHE_MAX; Map preserva ordem de inserção)
 * - Poda oportunista de arquivos de disco mais velhos que 7 dias, no máximo
 *   1x a cada 5 minutos, assíncrona (erro de poda = warn, nunca derruba o fluxo)
 * 
 * NOTA: Em produção, isso pode ser substituído por cache distribuído (Redis, etc.)
 */

const logger = require('../api/utils/logger');
const fs = require('fs');
const path = require('path');

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_ENTRIES = 500;
const DISK_PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const DISK_PRUNE_INTERVAL_MS = 5 * 60 * 1000; // no máximo 1x a cada 5 min

// Cache em memória (por executionId): executionId -> { value, expiresAt }
const contextCache = new Map();

// Diretório para persistência opcional (se necessário)
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'rag-contexts');

// Timestamp da última poda de disco (poda oportunista)
let lastDiskPruneAt = 0;

/**
 * Coerção defensiva de inteiro positivo vindo de env.
 */
function coercePositiveInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function getTtlMs() {
  return coercePositiveInt(process.env.RAG_CONTEXT_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

function getMaxEntries() {
  return coercePositiveInt(process.env.RAG_CONTEXT_CACHE_MAX, DEFAULT_MAX_ENTRIES);
}

/**
 * Garante que o diretório de cache existe.
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Evicção do mais antigo quando a capacidade máxima é atingida.
 * Map preserva ordem de inserção: a primeira chave é a mais antiga.
 */
function evictOldestIfNeeded() {
  const maxEntries = getMaxEntries();
  while (contextCache.size >= maxEntries && contextCache.size > 0) {
    const oldestKey = contextCache.keys().next().value;
    contextCache.delete(oldestKey);
    logger.debug('[ragContextCache] Entrada mais antiga removida por limite de capacidade', {
      evictedExecutionId: oldestKey,
      maxEntries,
    });
  }
}

/**
 * Poda oportunista de arquivos de cache em disco mais velhos que 7 dias.
 * Assíncrona (fire-and-forget), no máximo 1x a cada 5 minutos; erros viram
 * log warn e nunca derrubam o fluxo principal.
 */
function maybePruneDiskCache() {
  const now = Date.now();
  if (now - lastDiskPruneAt < DISK_PRUNE_INTERVAL_MS) {
    return;
  }
  lastDiskPruneAt = now;

  (async () => {
    let files;
    try {
      files = await fs.promises.readdir(CACHE_DIR);
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      logger.warn('[ragContextCache] Erro ao listar diretório para poda de cache', {
        error: err.message,
      });
      return;
    }

    const cutoff = Date.now() - DISK_PRUNE_MAX_AGE_MS;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(CACHE_DIR, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(filePath);
          logger.debug('[ragContextCache] Arquivo de cache expirado removido na poda', { file });
        }
      } catch (err) {
        logger.warn('[ragContextCache] Erro ao podar arquivo de cache', {
          file,
          error: err.message,
        });
      }
    }
  })().catch((err) => {
    logger.warn('[ragContextCache] Falha inesperada na poda de cache em disco', {
      error: err && err.message,
    });
  });
}

/**
 * Lê entrada de memória válida (não expirada). Entrada expirada = miss (e remove).
 */
function getFreshMemoryEntry(executionId) {
  if (!contextCache.has(executionId)) {
    return null;
  }
  const entry = contextCache.get(executionId);
  if (!entry || typeof entry !== 'object' || !('value' in entry)) {
    contextCache.delete(executionId);
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    contextCache.delete(executionId);
    logger.debug('[ragContextCache] Entrada de cache expirada (memória)', { executionId });
    return null;
  }
  return entry.value;
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
  const memoryHit = getFreshMemoryEntry(executionId);
  if (memoryHit) {
    logger.debug('[ragContextCache] Contexto RAG encontrado em cache (memória)', {
      executionId,
      chunksCount: memoryHit.chunks?.length || 0,
      sourcesCount: memoryHit.sources?.length || 0,
    });
    return memoryHit;
  }
  
  // Tenta cache em disco (se habilitado)
  try {
    ensureCacheDir();
    const cacheFile = path.join(CACHE_DIR, `${executionId}.json`);
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      if (stat.mtimeMs + getTtlMs() <= Date.now()) {
        // Arquivo expirado: miss e remove (best-effort)
        try {
          fs.unlinkSync(cacheFile);
        } catch (unlinkErr) {
          logger.warn('[ragContextCache] Erro ao remover cache expirado do disco', {
            executionId,
            error: unlinkErr.message,
          });
        }
        return null;
      }

      const content = fs.readFileSync(cacheFile, 'utf8');
      const cached = JSON.parse(content);
      
      // Restaura no cache em memória (expiração alinhada ao arquivo)
      evictOldestIfNeeded();
      contextCache.set(executionId, {
        value: cached,
        expiresAt: stat.mtimeMs + getTtlMs(),
      });
      
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
  
  // Armazena em memória (com TTL e limite de capacidade)
  if (!contextCache.has(executionId)) {
    evictOldestIfNeeded();
  }
  contextCache.set(executionId, {
    value: ragContext,
    expiresAt: Date.now() + getTtlMs(),
  });
  
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

  // Poda oportunista de arquivos antigos (assíncrona, best-effort)
  maybePruneDiskCache();
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
  
  if (getFreshMemoryEntry(executionId)) {
    return true;
  }
  
  try {
    const cacheFile = path.join(CACHE_DIR, `${executionId}.json`);
    if (!fs.existsSync(cacheFile)) {
      return false;
    }
    const stat = fs.statSync(cacheFile);
    return stat.mtimeMs + getTtlMs() > Date.now();
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
