/**
 * Serviço de Disparos em Massa (Bulk Messaging).
 *
 * Responsabilidades:
 * - Gerenciar campanhas de disparo em massa
 * - Enviar mensagens para múltiplos contatos
 * - Controlar taxa de envio (rate limiting)
 * - Rastrear status de envio
 * - Persistir dados em PostgreSQL
 *
 * Persistência:
 * - Campanhas: PostgreSQL (tabela campaigns ou similar)
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const outboundQueueService = require('./outboundQueueService');
const { emitEvent } = require('./websocketService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value).trim();
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  try {
    const message = safeToString(err.message, '');
    return message || safeToString(err, fallback) || fallback;
  } catch (_) {
    return safeToString(err, fallback);
  }
}

/**
 * @typedef {Object} BulkCampaign
 * @property {string} id - ID único da campanha
 * @property {string} tenantId - ID do tenant (obrigatório)
 * @property {string} name - Nome da campanha
 * @property {string} message - Mensagem a ser enviada
 * @property {string[]} phoneNumbers - Lista de números de telefone
 * @property {string} status - Status: "draft" | "scheduled" | "sending" | "completed" | "paused" | "cancelled"
 * @property {string} scheduledAt - Data/hora agendada (ISO string)
 * @property {number} totalRecipients - Total de destinatários
 * @property {number} sentCount - Quantidade enviada
 * @property {number} failedCount - Quantidade falhada
 * @property {number} pendingCount - Quantidade pendente
 * @property {Object} deliveryStatus - Status por número: { phoneNumber: "sent" | "failed" | "pending" }
 * @property {number} rateLimit - Mensagens por minuto (padrão: 20)
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {string} createdBy - ID do agente que criou
 * @property {string|null} completedAt - Data de conclusão (ISO string)
 */

// Armazenamento em memória
/** @type {Map<string, BulkCampaign>} */
const campaigns = new Map();

// Controle de envio ativo
/** @type {Map<string, NodeJS.Timeout>} */
const activeSenders = new Map();

// ---------------------------------------------------------------------------
// Realtime: `campaign.updated` via WebSocket (padrão channel.health.alert).
// Emitido apenas em transições de estado e em progresso agregado com throttle
// (nunca por destinatário — o pacing envia mensagem a mensagem).
// ---------------------------------------------------------------------------
const CAMPAIGN_PROGRESS_EMIT_INTERVAL_MS = 5000;

/** @type {Map<string, number>} campaignId -> timestamp do último emit de progresso */
const lastProgressEmitAt = new Map();

function emitCampaignUpdated(campaign, action) {
  if (!campaign) return;
  const tenantId = safeTrim(campaign.tenantId);
  if (!tenantId) return;
  try {
    emitEvent('campaign.updated', {
      tenantId,
      campaignId: campaign.id,
      status: campaign.status,
      action,
      counters: {
        totalRecipients: campaign.totalRecipients,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        pendingCount: campaign.pendingCount,
      },
    }, { tenantId });
  } catch (err) {
    logger.warn('[BulkMessaging] Falha ao emitir campaign.updated', { campaignId: campaign.id, error: safeErrorMessage(err) });
  }
}

function emitCampaignProgressThrottled(campaign) {
  const now = Date.now();
  const last = lastProgressEmitAt.get(campaign.id) || 0;
  if (now - last < CAMPAIGN_PROGRESS_EMIT_INTERVAL_MS) return;
  lastProgressEmitAt.set(campaign.id, now);
  emitCampaignUpdated(campaign, 'progress');
}

// ---------------------------------------------------------------------------
// Evicção de campanhas concluídas (TTL 24h, padrão do auto-cleanup de tickets).
// Campanhas com pacing ativo nunca são removidas.
// ---------------------------------------------------------------------------
const COMPLETED_CAMPAIGN_TTL_MS = 24 * 60 * 60 * 1000;
const CAMPAIGN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function sweepCompletedCampaigns(now = Date.now()) {
  let removed = 0;
  for (const [id, campaign] of campaigns.entries()) {
    if (campaign.status !== 'completed') continue;
    if (activeSenders.has(id)) continue;

    const completedAt = new Date(campaign.completedAt || campaign.updatedAt).getTime();
    if (Number.isNaN(completedAt) || now - completedAt <= COMPLETED_CAMPAIGN_TTL_MS) continue;

    campaigns.delete(id);
    removed += 1;
  }

  if (removed > 0) {
    logger.debug('[BulkMessaging] Sweeper: campanhas concluídas removidas da memória', { removed });
  }
  return removed;
}

const campaignSweepTimer = setInterval(sweepCompletedCampaigns, CAMPAIGN_SWEEP_INTERVAL_MS);
if (typeof campaignSweepTimer.unref === 'function') {
  campaignSweepTimer.unref();
}

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, '..', 'data');
const bulkMessagingFile = path.join(dataDir, 'bulkMessaging.json');

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
 * Lista todas as campanhas.
 * @param {Object} filters - Filtros opcionais
 * @param {string} [filters.status] - Filtrar por status
 * @param {string} [filters.createdBy] - Filtrar por criador
 * @returns {BulkCampaign[]}
 */
function listCampaigns(filters = {}) {
  let results = Array.from(campaigns.values());
  const normalizedTenantId = safeTrim(filters.tenantId);

  // Blindagem: listagem sempre deve ser tenant-aware
  if (!filters.tenantId || typeof filters.tenantId !== 'string' || normalizedTenantId === '') {
    return [];
  }
  results = results.filter((c) => c.tenantId === normalizedTenantId);
  
  if (filters.status) {
    results = results.filter(c => c.status === filters.status);
  }
  
  if (filters.createdBy) {
    results = results.filter(c => c.createdBy === filters.createdBy);
  }
  
  // Ordena por data de criação (mais recentes primeiro)
  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return results;
}

/**
 * Obtém uma campanha por ID.
 * @param {string} id
 * @returns {BulkCampaign|null}
 */
function getCampaign(id) {
  return campaigns.get(id) || null;
}

/**
 * Cria uma nova campanha.
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.message
 * @param {string[]} data.phoneNumbers
 * @param {string} [data.scheduledAt]
 * @param {number} [data.rateLimit]
 * @param {string} data.createdBy
 * @returns {{success: boolean, campaign?: BulkCampaign, error?: string}}
 */
function createCampaign(data) {
  const { 
    tenantId,
    name, 
    message, 
    phoneNumbers, 
    scheduledAt = null,
    rateLimit = 20,
    createdBy 
  } = data;
  const normalizedName = safeTrim(name);
  const normalizedMessage = safeTrim(message);
  const normalizedTenantId = safeTrim(tenantId);
  
  if (!tenantId || typeof tenantId !== 'string' || normalizedTenantId === '') {
    return { success: false, error: 'tenantId é obrigatório' };
  }

  if (!normalizedName) {
    return { success: false, error: 'Nome da campanha é obrigatório' };
  }
  
  if (!normalizedMessage) {
    return { success: false, error: 'Mensagem é obrigatória' };
  }
  
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return { success: false, error: 'Lista de números de telefone é obrigatória' };
  }
  
  if (!createdBy) {
    return { success: false, error: 'Criador é obrigatório' };
  }
  
  // Valida e normaliza números de telefone
  const validPhoneNumbers = [];
  const phoneRegex = /^\+?[1-9]\d{10,14}$/;
  
  for (const phone of phoneNumbers) {
    const cleanPhone = safeToString(phone).replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (phoneRegex.test(cleanPhone)) {
      const normalized = cleanPhone.replace(/^\+/, '');
      if (!validPhoneNumbers.includes(normalized)) {
        validPhoneNumbers.push(normalized);
      }
    }
  }
  
  if (validPhoneNumbers.length === 0) {
    return { success: false, error: 'Nenhum número de telefone válido encontrado' };
  }
  
  const id = `campaign-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  // Inicializa status de entrega
  const deliveryStatus = {};
  for (const phone of validPhoneNumbers) {
    deliveryStatus[phone] = 'pending';
  }
  
  const campaign = {
    id,
    tenantId: normalizedTenantId,
    name: normalizedName,
    message: normalizedMessage,
    phoneNumbers: validPhoneNumbers,
    status: scheduledAt && new Date(scheduledAt) > new Date() ? 'scheduled' : 'draft',
    scheduledAt: scheduledAt || null,
    totalRecipients: validPhoneNumbers.length,
    sentCount: 0,
    failedCount: 0,
    pendingCount: validPhoneNumbers.length,
    deliveryStatus,
    rateLimit: Math.max(1, Math.min(100, rateLimit)), // Limita entre 1 e 100 por minuto
    createdAt: now,
    updatedAt: now,
    createdBy,
    completedAt: null,
  };
  
  campaigns.set(id, campaign);
  // Dados agora estão no banco de dados PostgreSQL

  emitCampaignUpdated(campaign, 'created');

  return { success: true, campaign };
}

/**
 * Atualiza uma campanha.
 * @param {string} id
 * @param {Object} updates
 * @returns {{success: boolean, campaign?: BulkCampaign, error?: string}}
 */
function updateCampaign(id, updates) {
  const existing = campaigns.get(id);
  if (!existing) {
    return { success: false, error: 'Campanha não encontrada' };
  }
  
  // Não permite atualizar campanha que está sendo enviada
  if (existing.status === 'sending') {
    return { success: false, error: 'Não é possível atualizar uma campanha que está sendo enviada' };
  }
  
  const updated = {
    ...existing,
    ...updates,
    id, // Garante que o ID não seja alterado
    tenantId: existing.tenantId, // Blindagem: tenant não pode ser alterado
    updatedAt: new Date().toISOString(),
  };
  
  // Normaliza campos
  if (updated.name) updated.name = safeTrim(updated.name);
  if (updated.message) updated.message = safeTrim(updated.message);
  if (updated.rateLimit) {
    updated.rateLimit = Math.max(1, Math.min(100, updated.rateLimit));
  }
  
  campaigns.set(id, updated);
  // Dados agora estão no banco de dados PostgreSQL

  emitCampaignUpdated(updated, 'updated');

  return { success: true, campaign: updated };
}

/**
 * Remove uma campanha.
 * @param {string} id
 * @returns {{success: boolean, error?: string}}
 */
function deleteCampaign(id) {
  const existing = campaigns.get(id);
  if (!existing) {
    return { success: false, error: 'Campanha não encontrada' };
  }
  
  // Cancela envio se estiver ativo
  if (existing.status === 'sending' || existing.status === 'scheduled') {
    pauseCampaign(id);
  }
  
  campaigns.delete(id);
  lastProgressEmitAt.delete(id);
  // Dados agora estão no banco de dados PostgreSQL

  emitCampaignUpdated(existing, 'deleted');

  return { success: true };
}

/**
 * Inicia o envio de uma campanha.
 * @param {string} id
 * @returns {{success: boolean, error?: string}}
 */
async function startCampaign(id) {
  const campaign = campaigns.get(id);
  if (!campaign) {
    return { success: false, error: 'Campanha não encontrada' };
  }
  
  if (campaign.status === 'sending') {
    return { success: false, error: 'Campanha já está sendo enviada' };
  }
  
  if (campaign.status === 'completed') {
    return { success: false, error: 'Campanha já foi concluída' };
  }
  
  if (campaign.status === 'cancelled') {
    return { success: false, error: 'Campanha foi cancelada' };
  }
  
  campaign.status = 'sending';
  campaign.updatedAt = new Date().toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  emitCampaignUpdated(campaign, 'started');

  // Inicia processo de envio assíncrono
  startSendingProcess(id);
  
  return { success: true };
}

/**
 * Pausa o envio de uma campanha.
 * @param {string} id
 * @returns {{success: boolean, error?: string}}
 */
function pauseCampaign(id) {
  const campaign = campaigns.get(id);
  if (!campaign) {
    return { success: false, error: 'Campanha não encontrada' };
  }
  
  if (campaign.status !== 'sending') {
    return { success: false, error: 'Campanha não está sendo enviada' };
  }
  
  campaign.status = 'paused';
  campaign.updatedAt = new Date().toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  emitCampaignUpdated(campaign, 'paused');

  // Para o processo de envio
  stopSendingProcess(id);
  
  return { success: true };
}

/**
 * Retoma o envio de uma campanha pausada.
 * @param {string} id
 * @returns {{success: boolean, error?: string}}
 */
function resumeCampaign(id) {
  const campaign = campaigns.get(id);
  if (!campaign) {
    return { success: false, error: 'Campanha não encontrada' };
  }
  
  if (campaign.status !== 'paused') {
    return { success: false, error: 'Campanha não está pausada' };
  }
  
  campaign.status = 'sending';
  campaign.updatedAt = new Date().toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  emitCampaignUpdated(campaign, 'resumed');

  // Retoma processo de envio
  startSendingProcess(id);
  
  return { success: true };
}

/**
 * Processo de envio assíncrono.
 * @param {string} campaignId
 */
async function startSendingProcess(campaignId) {
  const campaign = campaigns.get(campaignId);
  if (!campaign || campaign.status !== 'sending') {
    return;
  }

  const normalizedTenantId = safeTrim(campaign.tenantId);

  if (!campaign.tenantId || typeof campaign.tenantId !== 'string' || normalizedTenantId === '') {
    logger.error('[BulkMessaging] tenantId ausente na campanha; abortando envio', { campaignId });
    campaign.status = 'paused';
    campaign.updatedAt = new Date().toISOString();
    stopSendingProcess(campaignId);
    return;
  }
  
  // Calcula intervalo entre envios (em ms)
  const intervalMs = (60 * 1000) / campaign.rateLimit; // Mensagens por minuto
  
  let currentIndex = 0;
  const pendingPhones = campaign.phoneNumbers.filter(
    phone => campaign.deliveryStatus[phone] === 'pending'
  );
  
  if (pendingPhones.length === 0) {
    // Nenhuma mensagem pendente, marca como concluída
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
    campaign.updatedAt = new Date().toISOString();
    // Dados agora estão no banco de dados PostgreSQL
    stopSendingProcess(campaignId);
    emitCampaignUpdated(campaign, 'completed');
    return;
  }
  
  const sendNext = async () => {
    if (campaign.status !== 'sending') {
      stopSendingProcess(campaignId);
      return;
    }
    
    if (currentIndex >= pendingPhones.length) {
      // Todas as mensagens foram processadas
      campaign.status = 'completed';
      campaign.completedAt = new Date().toISOString();
      campaign.updatedAt = new Date().toISOString();
      // Dados agora estão no banco de dados PostgreSQL
      stopSendingProcess(campaignId);
      emitCampaignUpdated(campaign, 'completed');
      return;
    }
    
    const phoneNumber = pendingPhones[currentIndex];
    currentIndex++;
    
    try {
      // Regra (Fase 2): qualquer envio WhatsApp deve passar pela fila.
      await outboundQueueService.enqueueOutbound({
        tenantId: campaign.tenantId,
        channelType: 'whatsapp',
        conversationId: null,
        message: {
          to: phoneNumber,
          type: 'text',
          body: { text: campaign.message },
          meta: { campaignId },
        },
      });
      // Mantém compatibilidade do serviço: "sent" aqui significa "enfileirado para envio".
      campaign.deliveryStatus[phoneNumber] = 'sent';
      campaign.sentCount++;
      campaign.pendingCount--;
      logger.info(`[BulkMessaging] Mensagem enviada: ${phoneNumber} (Campanha: ${campaign.name})`);
    } catch (error) {
      campaign.deliveryStatus[phoneNumber] = 'failed';
      campaign.failedCount++;
      campaign.pendingCount--;
      logger.error(`[BulkMessaging] Erro ao enviar para ${phoneNumber}:`, safeErrorMessage(error));
    }
    
    campaign.updatedAt = new Date().toISOString();
    // Dados agora estão no banco de dados PostgreSQL

    // Progresso agregado com throttle (nunca 1 evento por destinatário)
    emitCampaignProgressThrottled(campaign);

    // Agenda próximo envio
    const timeout = setTimeout(sendNext, intervalMs);
    activeSenders.set(campaignId, timeout);
  };
  
  // Inicia o primeiro envio
  sendNext();
}

/**
 * Para o processo de envio.
 * @param {string} campaignId
 */
function stopSendingProcess(campaignId) {
  const timeout = activeSenders.get(campaignId);
  if (timeout) {
    clearTimeout(timeout);
    activeSenders.delete(campaignId);
  }
}

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  _internal: {
    campaigns,
    activeSenders,
    lastProgressEmitAt,
    sweepCompletedCampaigns,
    COMPLETED_CAMPAIGN_TTL_MS,
    CAMPAIGN_PROGRESS_EMIT_INTERVAL_MS,
  },
};

