/**
 * Serviço de Disparos em Massa (Bulk Messaging).
 *
 * Responsabilidades:
 * - Gerenciar campanhas de disparo em massa
 * - Enviar mensagens para múltiplos contatos
 * - Controlar taxa de envio (rate limiting)
 * - Rastrear status de envio
 * - Persistir dados em arquivo JSON
 *
 * Persistência:
 * - Campanhas: api/data/bulkMessaging.json
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { sendTextMessage } = require('./whatsappService');

/**
 * @typedef {Object} BulkCampaign
 * @property {string} id - ID único da campanha
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

/**
 * Salva campanhas no arquivo JSON.
 */
function saveCampaignsToFile() {
  try {
    ensureDataDir();
    const campaignsArray = Array.from(campaigns.values());
    const data = {
      campaigns: campaignsArray,
      savedAt: new Date().toISOString(),
    };
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(bulkMessagingFile, jsonData, 'utf8');
    logger.debug(`[BulkMessaging] Dados salvos: ${campaignsArray.length} campanha(s)`);
  } catch (err) {
    logger.error('[BulkMessaging] Erro ao salvar dados no arquivo:', err);
  }
}

/**
 * Carrega campanhas do arquivo JSON.
 */
function loadCampaignsFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(bulkMessagingFile)) {
      logger.info(`[BulkMessaging] Arquivo não encontrado: ${bulkMessagingFile}. Iniciando com dados vazios.`);
      return;
    }
    const data = fs.readFileSync(bulkMessagingFile, 'utf8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed.campaigns)) {
      campaigns.clear();
      for (const campaign of parsed.campaigns) {
        if (campaign && campaign.id) {
          campaigns.set(campaign.id, campaign);
        }
      }
    }
    logger.info(`[BulkMessaging] Dados carregados: ${campaigns.size} campanha(s)`);
  } catch (err) {
    logger.error('[BulkMessaging] Erro ao carregar dados do arquivo:', err);
  }
}

// Carrega dados ao iniciar o módulo
loadCampaignsFromFile();

/**
 * Lista todas as campanhas.
 * @param {Object} filters - Filtros opcionais
 * @param {string} [filters.status] - Filtrar por status
 * @param {string} [filters.createdBy] - Filtrar por criador
 * @returns {BulkCampaign[]}
 */
function listCampaigns(filters = {}) {
  let results = Array.from(campaigns.values());
  
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
    name, 
    message, 
    phoneNumbers, 
    scheduledAt = null,
    rateLimit = 20,
    createdBy 
  } = data;
  
  if (!name || name.trim() === '') {
    return { success: false, error: 'Nome da campanha é obrigatório' };
  }
  
  if (!message || message.trim() === '') {
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
    const cleanPhone = String(phone).replace(/\s+/g, '').replace(/[^\d+]/g, '');
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
    name: name.trim(),
    message: message.trim(),
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
  saveCampaignsToFile();
  
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
    updatedAt: new Date().toISOString(),
  };
  
  // Normaliza campos
  if (updated.name) updated.name = updated.name.trim();
  if (updated.message) updated.message = updated.message.trim();
  if (updated.rateLimit) {
    updated.rateLimit = Math.max(1, Math.min(100, updated.rateLimit));
  }
  
  campaigns.set(id, updated);
  saveCampaignsToFile();
  
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
  saveCampaignsToFile();
  
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
  saveCampaignsToFile();
  
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
  saveCampaignsToFile();
  
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
  saveCampaignsToFile();
  
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
    saveCampaignsToFile();
    stopSendingProcess(campaignId);
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
      saveCampaignsToFile();
      stopSendingProcess(campaignId);
      return;
    }
    
    const phoneNumber = pendingPhones[currentIndex];
    currentIndex++;
    
    try {
      await sendTextMessage(phoneNumber, campaign.message);
      campaign.deliveryStatus[phoneNumber] = 'sent';
      campaign.sentCount++;
      campaign.pendingCount--;
      logger.info(`[BulkMessaging] Mensagem enviada: ${phoneNumber} (Campanha: ${campaign.name})`);
    } catch (error) {
      campaign.deliveryStatus[phoneNumber] = 'failed';
      campaign.failedCount++;
      campaign.pendingCount--;
      logger.error(`[BulkMessaging] Erro ao enviar para ${phoneNumber}:`, error.message);
    }
    
    campaign.updatedAt = new Date().toISOString();
    saveCampaignsToFile();
    
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
  loadCampaignsFromFile,
};

