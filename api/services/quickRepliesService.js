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

function toDbPayload(reply) {
  return {
    id: reply.id,
    tenant_key: reply.tenantId || 'tenant-demo',
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
      logger.warn('[QuickRepliesService] Falha ao persistir quick reply no PostgreSQL', { id: reply.id, error: err.message });
    });
  });
}

function deleteQuickReplyBestEffort(id) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteQuickReplyFromDb(id).catch((err) => {
      logger.warn('[QuickRepliesService] Falha ao remover quick reply no PostgreSQL', { id, error: err.message });
    });
  });
}

/**
 * Cria respostas rápidas padrão.
 */
function createDefaultQuickReplies() {
  const defaults = [
    {
      id: 'qr-001',
      tenantId: 'tenant-demo',
      title: 'Saudação Inicial',
      message: 'Olá! Como posso ajudá-lo hoje?',
      tags: ['saudacao', 'inicio', 'boas-vindas'],
      category: 'saudacao',
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
      active: true,
    },
    {
      id: 'qr-002',
      tenantId: 'tenant-demo',
      title: 'Despedida',
      message: 'Obrigado por entrar em contato! Tenha um ótimo dia!',
      tags: ['despedida', 'fim', 'agradecimento'],
      category: 'despedida',
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
      active: true,
    },
    {
      id: 'qr-003',
      tenantId: 'tenant-demo',
      title: 'Transferindo para Especialista',
      message: 'Vou transferir você para um especialista que poderá ajudá-lo melhor.',
      tags: ['transferencia', 'especialista'],
      category: 'transferencia',
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
      active: true,
    },
    {
      id: 'qr-004',
      tenantId: 'tenant-demo',
      title: 'Solicitando Informações',
      message: 'Para que eu possa ajudá-lo melhor, preciso de algumas informações. Pode me informar?',
      tags: ['informacao', 'dados', 'coleta'],
      category: 'coleta',
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
      active: true,
    },
    {
      id: 'qr-005',
      tenantId: 'tenant-demo',
      title: 'Problema Resolvido',
      message: 'Fico feliz em saber que conseguimos resolver seu problema! Se precisar de mais alguma coisa, estou à disposição.',
      tags: ['resolucao', 'sucesso', 'satisfacao'],
      category: 'resolucao',
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
      active: true,
    },
  ];
  
  for (const reply of defaults) {
    quickReplies.set(reply.id, reply);
    persistQuickReplyBestEffort(reply);
  }
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 * Se não houver dados, cria defaults para tenant-demo.
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
      createDefaultQuickReplies();
      logger.info('[QuickRepliesService] Nenhuma quick reply encontrada. Defaults criados.', { count: quickReplies.size });
    } else {
      logger.info('[QuickRepliesService] Cache inicializado do PostgreSQL', { count: quickReplies.size });
    }
  } catch (err) {
    logger.warn('[QuickRepliesService] Falha ao inicializar cache do PostgreSQL', { error: err.message });
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

  if (filters.tenantId) {
    results = results.filter((r) => r.tenantId === filters.tenantId);
  }
  
  if (filters.category) {
    results = results.filter(r => r.category === filters.category);
  }
  
  if (filters.tag) {
    results = results.filter(r => r.tags && r.tags.includes(filters.tag));
  }
  
  if (filters.activeOnly !== false) {
    results = results.filter(r => r.active !== false);
  }
  
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
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
  const { title, message, tags = [], category = 'geral', createdBy = null, tenantId = 'tenant-demo' } = data;
  
  if (!title || !message) {
    return { success: false, error: 'Título e mensagem são obrigatórios' };
  }
  
  const id = `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  const quickReply = {
    id,
    tenantId: tenantId || 'tenant-demo',
    title: title.trim(),
    message: message.trim(),
    tags: Array.isArray(tags) ? tags.map(t => t.trim().toLowerCase()) : [],
    category: category.trim().toLowerCase(),
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
  
  // Valida campos obrigatórios
  if (updated.title && updated.title.trim() === '') {
    return { success: false, error: 'Título não pode estar vazio' };
  }
  if (updated.message && updated.message.trim() === '') {
    return { success: false, error: 'Mensagem não pode estar vazia' };
  }
  
  // Normaliza campos
  if (updated.title) updated.title = updated.title.trim();
  if (updated.message) updated.message = updated.message.trim();
  if (updated.tags) {
    updated.tags = Array.isArray(updated.tags) ? updated.tags.map(t => t.trim().toLowerCase()) : [];
  }
  if (updated.category) {
    updated.category = updated.category.trim().toLowerCase();
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
function searchByContext(context, limit = 5) {
  if (!context || typeof context !== 'string') {
    return [];
  }
  
  const contextLower = context.toLowerCase();
  const words = contextLower.split(/\s+/).filter(w => w.length > 2);
  
  // Calcula score para cada resposta rápida
  const scored = Array.from(quickReplies.values())
    .filter(r => r.active !== false)
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

