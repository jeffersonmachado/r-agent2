/**
 * Serviço de Respostas Rápidas (DB-only).
 *
 * Persistência:
 * - PostgreSQL (tabela quick_replies)
 *
 * Observação:
 * - Mantém cache em memória para operações síncronas do server.
 */

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { QuickReply: QuickReplyGetter } = require('../db/models');

/**
 * @typedef {Object} QuickReply
 * @property {string} id - ID único da resposta rápida
 * @property {string} title - Título/descrição curta
 * @property {string} message - Texto da mensagem
 * @property {string[]} tags - Tags para busca e categorização
 * @property {string} category - Categoria (ex: "saudacao", "despedida", "duvida", "problema")
 * @property {number} usageCount - Contador de uso
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {string|null} createdBy - ID do agente que criou
 * @property {boolean} active - Se está ativa
 */

/** @type {Map<string, QuickReply>} */
const quickReplies = new Map(); // id -> QuickReply

function dbAvailable() {
  return !!getSequelize();
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value).trim();
  } catch (_) {
    return fallback;
  }
}

function safeLowerTrim(value, fallback = '') {
  const s = safeTrim(value, fallback);
  return s ? s.toLowerCase() : s;
}

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }

  if (message !== null && message !== undefined) return safeTrim(message, fallback);
  return safeTrim(err, fallback);
}

function toDbPayload(reply) {
  if (!reply || !reply.tenantId || typeof reply.tenantId !== 'string' || reply.tenantId.trim() === '') {
    throw new Error('tenantId é obrigatório para QuickReply');
  }
  return {
    id: reply.id,
    tenant_key: reply.tenantId,
    title: reply.title,
    message: reply.message,
    tags: Array.isArray(reply.tags) ? reply.tags : [],
    category: reply.category || null,
    usage_count: Number.isFinite(reply.usageCount) ? reply.usageCount : 0,
    created_by: reply.createdBy || null,
    active: reply.active !== false,
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key || null,
    title: row.title,
    message: row.message,
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || 'geral',
    usageCount: Number.isFinite(row.usage_count) ? row.usage_count : 0,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || new Date().toISOString()),
    createdBy: row.created_by || null,
    active: row.active !== false,
  };
}

async function upsertQuickReplyToDb(reply) {
  if (!dbAvailable()) return;
  const QuickReplyModel = typeof QuickReplyGetter === 'function' ? QuickReplyGetter() : QuickReplyGetter;
  const payload = toDbPayload(reply);
  const now = new Date();

  const existing = await QuickReplyModel.findByPk(reply.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
  } else {
    await QuickReplyModel.create({ ...payload, created_at: now, updated_at: now });
  }
}

async function deleteQuickReplyFromDb(id) {
  if (!dbAvailable()) return;
  const QuickReplyModel = typeof QuickReplyGetter === 'function' ? QuickReplyGetter() : QuickReplyGetter;
  await QuickReplyModel.destroy({ where: { id } });
}

function persistQuickReplyBestEffort(reply) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    upsertQuickReplyToDb(reply).catch((err) => {
      logger.warn('[QuickRepliesService] Falha ao persistir quick reply no PostgreSQL', { id: reply.id, error: safeErrorMessage(err) });
    });
  });
}

function deleteQuickReplyBestEffort(id) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteQuickReplyFromDb(id).catch((err) => {
      logger.warn('[QuickRepliesService] Falha ao remover quick reply no PostgreSQL', { id, error: safeErrorMessage(err) });
    });
  });
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 */
async function initialize() {
  if (!dbAvailable()) return;
  try {
    const QuickReplyModel = typeof QuickReplyGetter === 'function' ? QuickReplyGetter() : QuickReplyGetter;
    const rows = await QuickReplyModel.findAll();
    quickReplies.clear();
    for (const row of rows) {
      const reply = fromDbRow(row);
      quickReplies.set(reply.id, reply);
    }

    if (quickReplies.size === 0) {
      // Blindagem: não cria defaults automáticos em produção (multi-tenant obrigatório)
      logger.info('[QuickRepliesService] Nenhuma quick reply encontrada. Nenhum default será criado automaticamente.', { count: 0 });
    } else {
      logger.info('[QuickRepliesService] Cache inicializado do PostgreSQL', { count: quickReplies.size });
    }
  } catch (err) {
    logger.warn('[QuickRepliesService] Falha ao inicializar cache do PostgreSQL', { error: safeErrorMessage(err) });
  }
}

/**
 * Lista todas as respostas rápidas.
 * @param {Object} filters - Filtros opcionais
 * @param {string} [filters.category] - Filtrar por categoria
 * @param {string} [filters.tag] - Filtrar por tag
 * @param {boolean} [filters.activeOnly] - Apenas ativas
 * @param {string} [filters.search] - Busca por título ou mensagem
 * @returns {QuickReply[]}
 */
function listQuickReplies(filters = {}) {
  let results = Array.from(quickReplies.values());
  const categoryFilter = safeTrim(filters.category);
  const tagFilter = safeTrim(filters.tag);

  if (filters.tenantId) {
    results = results.filter((r) => r.tenantId === filters.tenantId);
  }
  
  if (categoryFilter) {
    results = results.filter(r => r.category === categoryFilter);
  }
  
  if (tagFilter) {
    results = results.filter(r => r.tags && r.tags.includes(tagFilter));
  }
  
  if (filters.activeOnly !== false) {
    results = results.filter(r => r.active !== false);
  }
  
  const searchLower = safeLowerTrim(filters.search);
  if (searchLower) {
    results = results.filter(r => 
      r.title.toLowerCase().includes(searchLower) ||
      r.message.toLowerCase().includes(searchLower) ||
      (r.tags && r.tags.some(tag => tag.toLowerCase().includes(searchLower)))
    );
  }
  
  // Ordena por uso (mais usadas primeiro) e depois por título
  results.sort((a, b) => {
    if (b.usageCount !== a.usageCount) {
      return b.usageCount - a.usageCount;
    }
    return a.title.localeCompare(b.title);
  });
  
  return results;
}

/**
 * Obtém uma resposta rápida por ID.
 * @param {string} id
 * @returns {QuickReply|null}
 */
function getQuickReply(id) {
  return quickReplies.get(id) || null;
}

/**
 * Cria uma nova resposta rápida.
 * @param {Object} data
 * @param {string} data.title
 * @param {string} data.message
 * @param {string[]} [data.tags]
 * @param {string} [data.category]
 * @param {string} [data.createdBy]
 * @returns {{success: boolean, quickReply?: QuickReply, error?: string}}
 */
function createQuickReply(data) {
  const { title, message, tags = [], category = 'geral', createdBy = null, tenantId = null } = data;
  const normalizedTitle = safeTrim(title);
  const normalizedMessage = safeTrim(message);
  const normalizedCategory = safeLowerTrim(category, 'geral') || 'geral';
  const normalizedTags = Array.isArray(tags)
    ? tags.map((t) => safeLowerTrim(t)).filter(Boolean)
    : [];
  
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    return { success: false, error: 'tenantId é obrigatório' };
  }
  
  if (!normalizedTitle || !normalizedMessage) {
    return { success: false, error: 'Título e mensagem são obrigatórios' };
  }
  
  const id = `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  const quickReply = {
    id,
    tenantId,
    title: normalizedTitle,
    message: normalizedMessage,
    tags: normalizedTags,
    category: normalizedCategory,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy,
    active: true,
  };
  
  quickReplies.set(id, quickReply);
  persistQuickReplyBestEffort(quickReply);
  
  return { success: true, quickReply };
}

/**
 * Atualiza uma resposta rápida.
 * @param {string} id
 * @param {Object} updates
 * @returns {{success: boolean, quickReply?: QuickReply, error?: string}}
 */
function updateQuickReply(id, updates) {
  const existing = quickReplies.get(id);
  if (!existing) {
    return { success: false, error: 'Resposta rápida não encontrada' };
  }
  
  const updated = {
    ...existing,
    ...updates,
    id, // Garante que o ID não seja alterado
    updatedAt: new Date().toISOString(),
  };
  const hasTitle = Object.prototype.hasOwnProperty.call(updates || {}, 'title');
  const hasMessage = Object.prototype.hasOwnProperty.call(updates || {}, 'message');
  
  // Valida campos obrigatórios
  if (hasTitle && safeTrim(updated.title) === '') {
    return { success: false, error: 'Título não pode estar vazio' };
  }
  if (hasMessage && safeTrim(updated.message) === '') {
    return { success: false, error: 'Mensagem não pode estar vazia' };
  }
  
  // Normaliza campos
  if (updated.title) updated.title = safeTrim(updated.title);
  if (updated.message) updated.message = safeTrim(updated.message);
  if (updated.tags) {
    updated.tags = Array.isArray(updated.tags)
      ? updated.tags.map((t) => safeLowerTrim(t)).filter(Boolean)
      : [];
  }
  if (updated.category) {
    updated.category = safeLowerTrim(updated.category);
  }
  
  quickReplies.set(id, updated);
  persistQuickReplyBestEffort(updated);
  
  return { success: true, quickReply: updated };
}

/**
 * Remove uma resposta rápida.
 * @param {string} id
 * @returns {{success: boolean, error?: string}}
 */
function deleteQuickReply(id) {
  const existing = quickReplies.get(id);
  if (!existing) {
    return { success: false, error: 'Resposta rápida não encontrada' };
  }
  
  quickReplies.delete(id);
  deleteQuickReplyBestEffort(id);
  
  return { success: true };
}

/**
 * Incrementa o contador de uso de uma resposta rápida.
 * @param {string} id
 */
function incrementUsage(id) {
  const reply = quickReplies.get(id);
  if (reply) {
    reply.usageCount = (reply.usageCount || 0) + 1;
    reply.updatedAt = new Date().toISOString();
    persistQuickReplyBestEffort(reply);
  }
}

/**
 * Busca respostas rápidas por palavras-chave no contexto da conversa.
 * @param {string} context - Contexto da conversa (última mensagem do usuário)
 * @param {number} [limit=5] - Limite de resultados
 * @returns {QuickReply[]}
 */
function searchByContext(context, tenantIdOrLimit = 5, maybeLimit = 5) {
  if (!context || typeof context !== 'string') {
    return [];
  }

  const tenantId = typeof tenantIdOrLimit === 'string' ? tenantIdOrLimit : null;
  const limit = typeof tenantIdOrLimit === 'number' ? tenantIdOrLimit : (typeof maybeLimit === 'number' ? maybeLimit : 5);
  if (!tenantId) {
    // Blindagem: sem tenant, não retorna nada (evita vazamento cross-tenant)
    return [];
  }
  
  const contextLower = context.toLowerCase();
  const words = contextLower.split(/\s+/).filter(w => w.length > 2);
  
  // Calcula score para cada resposta rápida
  const scored = Array.from(quickReplies.values())
    .filter(r => r.active !== false && r.tenantId === tenantId)
    .map(reply => {
      let score = 0;
      const replyText = `${reply.title} ${reply.message} ${(reply.tags || []).join(' ')}`.toLowerCase();
      
      // Pontua por palavras-chave encontradas
      for (const word of words) {
        if (replyText.includes(word)) {
          score += 1;
        }
      }
      
      // Bônus por uso frequente
      score += Math.log(reply.usageCount + 1) * 0.1;
      
      return { reply, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.reply);
  
  return scored;
}

/**
 * Obtém categorias disponíveis.
 * @returns {string[]}
 */
function getCategories() {
  const categories = new Set();
  for (const reply of quickReplies.values()) {
    if (reply.category) {
      categories.add(reply.category);
    }
  }
  return Array.from(categories).sort();
}

/**
 * Obtém tags disponíveis.
 * @returns {string[]}
 */
function getTags() {
  const tags = new Set();
  for (const reply of quickReplies.values()) {
    if (Array.isArray(reply.tags)) {
      for (const tag of reply.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags).sort();
}

module.exports = {
  initialize,
  listQuickReplies,
  getQuickReply,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  incrementUsage,
  searchByContext,
  getCategories,
  getTags,
};

