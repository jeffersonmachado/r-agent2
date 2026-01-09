/**
 * Utilitários para normalização de conteúdo.
 * 
 * Usado ANTES de qualquer hash para garantir consistência na detecção de duplicatas.
 */

/**
 * Normaliza texto para comparação e hash.
 * 
 * Regras:
 * - Converte para lowercase
 * - Remove espaços duplicados
 * - Faz trim
 * - Normaliza quebras de linha
 * - Preserva pontuação relevante
 * 
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizeContent(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    // Converte para lowercase
    .toLowerCase()
    // Normaliza quebras de linha (Windows, Unix, Mac)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove múltiplas quebras de linha consecutivas (máximo 2)
    .replace(/\n{3,}/g, '\n\n')
    // Remove espaços duplicados (mas preserva quebras de linha)
    .replace(/[ \t]+/g, ' ')
    // Remove espaços no início e fim de linhas
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    // Remove espaços antes e depois de quebras de linha
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    // Trim final
    .trim();
}

/**
 * Gera hash SHA-256 de um texto.
 * 
 * @param {string} text - Texto para hash
 * @returns {Promise<string>} Hash hexadecimal
 */
async function generateContentHash(text) {
  const crypto = require('crypto');
  const normalized = normalizeContent(text);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Gera hash SHA-256 de forma síncrona (para casos onde não precisa ser async).
 * 
 * @param {string} text - Texto para hash
 * @returns {string} Hash hexadecimal
 */
function generateContentHashSync(text) {
  const crypto = require('crypto');
  const normalized = normalizeContent(text);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Gera chunk_id determinístico.
 * 
 * chunk_id = SHA-256(document_id + section_title + chunk_index)
 * 
 * @param {string} documentId - ID do documento
 * @param {string} sectionTitle - Título da seção (ou '' se não houver)
 * @param {number} chunkIndex - Índice do chunk (0-based)
 * @returns {string} chunk_id determinístico
 */
function generateChunkId(documentId, sectionTitle = '', chunkIndex = 0) {
  const crypto = require('crypto');
  const input = `${documentId}|${sectionTitle}|${chunkIndex}`;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Gera hash semântico a partir de um embedding normalizado.
 * 
 * @param {Array<number>} embedding - Vetor de embedding (já normalizado L2)
 * @returns {string} Hash hexadecimal do embedding
 */
function generateSemanticHash(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding deve ser um array não vazio');
  }

  const crypto = require('crypto');
  // Converte embedding para string fixa (precisão de 6 casas decimais)
  const embeddingStr = embedding
    .map(v => v.toFixed(6))
    .join(',');
  
  return crypto.createHash('sha256').update(embeddingStr, 'utf8').digest('hex');
}

/**
 * Normaliza embedding usando L2 normalization.
 * 
 * @param {Array<number>} embedding - Vetor de embedding
 * @returns {Array<number>} Embedding normalizado
 */
function normalizeEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding deve ser um array não vazio');
  }

  // Calcula norma L2
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  
  if (norm === 0) {
    throw new Error('Embedding não pode ter norma zero');
  }

  // Normaliza
  return embedding.map(val => val / norm);
}

/**
 * Calcula similaridade cosseno entre dois embeddings.
 * 
 * @param {Array<number>} embedding1 - Primeiro embedding
 * @param {Array<number>} embedding2 - Segundo embedding
 * @returns {number} Similaridade cosseno (0 a 1)
 */
function cosineSimilarity(embedding1, embedding2) {
  if (!Array.isArray(embedding1) || !Array.isArray(embedding2)) {
    throw new Error('Embeddings devem ser arrays');
  }

  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings devem ter a mesma dimensão');
  }

  // Produto escalar
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }

  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
}

module.exports = {
  normalizeContent,
  generateContentHash,
  generateContentHashSync,
  generateChunkId,
  generateSemanticHash,
  normalizeEmbedding,
  cosineSimilarity,
};
