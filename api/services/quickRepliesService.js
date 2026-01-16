/**
 * Serviço de Respostas Rápidas (Quick Replies).
 *
 * Responsabilidades:
 * - Gerenciar mensagens pré-definidas e templates
 * - Organizar respostas por categorias/tags
 * - Buscar respostas por palavras-chave
 * - Persistir dados em PostgreSQL
 *
 * Persistência:
 * - Respostas rápidas: PostgreSQL (tabela quick_replies)
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

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

// Armazenamento em memória
/** @type {Map<string, QuickReply>} */
const quickReplies = new Map();

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, '..', 'data');
const quickRepliesFile = path.join(dataDir, 'quickReplies.json');

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL
// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo

/**
 * Cria respostas rápidas padrão.
 */
function createDefaultQuickReplies() {
  const defaults = [
    {
      id: 'qr-001',
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
  }
  // Dados agora estão no banco de dados PostgreSQL
}

// Carrega dados ao iniciar o módulo
// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo

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
  const { title, message, tags = [], category = 'geral', createdBy = null } = data;
  
  if (!title || !message) {
    return { success: false, error: 'Título e mensagem são obrigatórios' };
  }
  
  const id = `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  const quickReply = {
    id,
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
  // Dados agora estão no banco de dados PostgreSQL
  
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
  // Dados agora estão no banco de dados PostgreSQL
  
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
  // Dados agora estão no banco de dados PostgreSQL
  
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
    // Dados agora estão no banco de dados PostgreSQL
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

