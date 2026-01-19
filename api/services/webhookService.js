/**
 * Serviço de Webhooks Customizados.
 * 
 * Permite que clientes configurem webhooks para receber notificações
 * de eventos do sistema (tickets criados, mensagens recebidas, etc.)
 * 
 * Persistência:
 * - Webhooks: PostgreSQL (tabela webhooks)
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { validateInput, ValidationError } = require('../utils/inputValidator');
const { getSequelize } = require('../db/sequelize');
const { Webhook: WebhookGetter } = require('../db/models');

/**
 * @typedef {Object} Webhook
 * @property {string} id - ID único do webhook
 * @property {string} tenantId - ID do tenant
 * @property {string} url - URL do webhook
 * @property {string[]} events - Eventos que disparam o webhook
 * @property {string} secret - Secret para assinatura HMAC
 * @property {boolean} active - Se o webhook está ativo
 * @property {number} timeout - Timeout em ms (padrão: 5000)
 * @property {number} retries - Número de tentativas em caso de falha (padrão: 3)
 * @property {Object} headers - Headers customizados a enviar
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {Object} stats - Estatísticas do webhook
 * @property {number} stats.totalCalls - Total de chamadas
 * @property {number} stats.successfulCalls - Chamadas bem-sucedidas
 * @property {number} stats.failedCalls - Chamadas falhadas
 * @property {string} stats.lastCallAt - Data da última chamada (ISO string)
 */

// Armazenamento em memória
/** @type {Map<string, Webhook>} */
const webhooks = new Map();

// Eventos disponíveis
const AVAILABLE_EVENTS = [
  'ticket.created',
  'ticket.assigned',
  'ticket.closed',
  'ticket.message.received',
  'ticket.message.sent',
  'agent.login',
  'agent.logout',
  'flow.published',
  'flow.updated',
  'campaign.started',
  'campaign.completed',
  'campaign.failed',
];

function dbAvailable() {
  return !!getSequelize();
}

function toDbPayload(webhook) {
  return {
    id: webhook.id,
    tenant_key: webhook.tenantId,
    url: webhook.url,
    events: Array.isArray(webhook.events) ? webhook.events : [],
    secret: webhook.secret,
    active: webhook.active !== false,
    timeout: Number.isFinite(webhook.timeout) ? webhook.timeout : 5000,
    retries: Number.isFinite(webhook.retries) ? webhook.retries : 3,
    headers: webhook.headers && typeof webhook.headers === 'object' && !Array.isArray(webhook.headers) ? webhook.headers : {},
    stats: webhook.stats && typeof webhook.stats === 'object' ? webhook.stats : {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      lastCallAt: null,
    },
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    url: row.url,
    events: Array.isArray(row.events) ? row.events : [],
    secret: row.secret,
    active: row.active !== false,
    timeout: Number.isFinite(row.timeout) ? row.timeout : 5000,
    retries: Number.isFinite(row.retries) ? row.retries : 3,
    headers: row.headers && typeof row.headers === 'object' && !Array.isArray(row.headers) ? row.headers : {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || new Date().toISOString()),
    stats: row.stats && typeof row.stats === 'object' ? row.stats : {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      lastCallAt: null,
    },
  };
}

async function upsertWebhookToDb(webhook) {
  if (!dbAvailable()) return;
  const WebhookModel = typeof WebhookGetter === 'function' ? WebhookGetter() : WebhookGetter;
  const payload = toDbPayload(webhook);
  const now = new Date();

  const existing = await WebhookModel.findByPk(webhook.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
  } else {
    await WebhookModel.create({ ...payload, created_at: now, updated_at: now });
  }
}

async function deleteWebhookFromDb(id) {
  if (!dbAvailable()) return;
  const WebhookModel = typeof WebhookGetter === 'function' ? WebhookGetter() : WebhookGetter;
  await WebhookModel.destroy({ where: { id } });
}

function persistWebhookBestEffort(webhook) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    upsertWebhookToDb(webhook).catch((err) => {
      logger.warn('[WebhookService] Falha ao persistir webhook no PostgreSQL', { id: webhook.id, error: err.message });
    });
  });
}

function deleteWebhookBestEffort(id) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteWebhookFromDb(id).catch((err) => {
      logger.warn('[WebhookService] Falha ao remover webhook no PostgreSQL', { id, error: err.message });
    });
  });
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 */
async function initialize() {
  if (!dbAvailable()) return;
  try {
    const WebhookModel = typeof WebhookGetter === 'function' ? WebhookGetter() : WebhookGetter;
    const rows = await WebhookModel.findAll();
    webhooks.clear();
    for (const row of rows) {
      const webhook = fromDbRow(row);
      webhooks.set(webhook.id, webhook);
    }
    logger.info('[WebhookService] Cache inicializado do PostgreSQL', { count: webhooks.size });
  } catch (err) {
    logger.warn('[WebhookService] Falha ao inicializar cache do PostgreSQL', { error: err.message });
  }
}

/**
 * Gera secret aleatório para assinatura HMAC.
 * 
 * @returns {string}
 */
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calcula assinatura HMAC para payload.
 * 
 * @param {string} payload - Payload JSON stringificado
 * @param {string} secret - Secret do webhook
 * @returns {string}
 */
function calculateSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Faz requisição HTTP para webhook.
 * 
 * @param {Webhook} webhook - Webhook a ser chamado
 * @param {Object} payload - Payload a ser enviado
 * @returns {Promise<{success: boolean, statusCode?: number, error?: string}>}
 */
function callWebhook(webhook, payload) {
  return new Promise((resolve) => {
    try {
      const url = new URL(webhook.url);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const payloadString = JSON.stringify(payload);
      const signature = calculateSignature(payloadString, webhook.secret);

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadString),
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': payload.event,
          'X-Webhook-Id': webhook.id,
          'User-Agent': 'R-Agent2-Webhook/1.0',
          ...webhook.headers,
        },
        timeout: webhook.timeout || 5000,
      };

      const req = httpModule.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          const success = res.statusCode >= 200 && res.statusCode < 300;
          
          // Atualiza estatísticas
          webhook.stats.totalCalls++;
          if (success) {
            webhook.stats.successfulCalls++;
          } else {
            webhook.stats.failedCalls++;
          }
          webhook.stats.lastCallAt = new Date().toISOString();
          persistWebhookBestEffort(webhook);

          resolve({
            success,
            statusCode: res.statusCode,
            response: responseData,
          });
        });
      });

      req.on('error', (err) => {
        webhook.stats.totalCalls++;
        webhook.stats.failedCalls++;
        webhook.stats.lastCallAt = new Date().toISOString();
        persistWebhookBestEffort(webhook);

        resolve({
          success: false,
          error: err.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        webhook.stats.totalCalls++;
        webhook.stats.failedCalls++;
        webhook.stats.lastCallAt = new Date().toISOString();
        persistWebhookBestEffort(webhook);

        resolve({
          success: false,
          error: 'Timeout',
        });
      });

      req.write(payloadString);
      req.end();
    } catch (err) {
      resolve({
        success: false,
        error: err.message,
      });
    }
  });
}

/**
 * Dispara webhooks para um evento específico.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} event - Nome do evento
 * @param {Object} data - Dados do evento
 */
async function triggerWebhooks(tenantId, event, data) {
  const matchingWebhooks = Array.from(webhooks.values()).filter(
    (webhook) =>
      webhook.active &&
      webhook.tenantId === tenantId &&
      webhook.events.includes(event)
  );

  if (matchingWebhooks.length === 0) {
    return;
  }

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    tenantId,
    data,
  };

  // Dispara todos os webhooks em paralelo
  const promises = matchingWebhooks.map(async (webhook) => {
    let attempts = 0;
    const maxRetries = webhook.retries || 3;

    while (attempts < maxRetries) {
      const result = await callWebhook(webhook, payload);

      if (result.success) {
        logger.debug(`[WebhookService] Webhook ${webhook.id} disparado com sucesso`);
        return;
      }

      attempts++;

      if (attempts < maxRetries) {
        // Espera antes de tentar novamente (backoff exponencial)
        const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.warn(
          `[WebhookService] Webhook ${webhook.id} falhou após ${maxRetries} tentativas: ${result.error || result.statusCode}`
        );
      }
    }
  });

  await Promise.allSettled(promises);
}

/**
 * Cria um novo webhook.
 * 
 * @param {Object} data - Dados do webhook
 * @returns {{success: boolean, webhook?: Webhook, error?: string}}
 */
function createWebhook(data) {
  try {
    const schema = {
      type: 'object',
      fields: {
        tenantId: {
          type: 'string',
          required: true,
          minLength: 1,
          maxLength: 100,
        },
        url: {
          type: 'url',
          required: true,
          allowedProtocols: ['http:', 'https:'],
        },
        events: {
          type: 'array',
          required: true,
          minLength: 1,
          maxLength: 50,
          itemValidator: (event) => {
            if (!AVAILABLE_EVENTS.includes(event)) {
              throw new ValidationError(
                `Evento '${event}' não é válido. Eventos disponíveis: ${AVAILABLE_EVENTS.join(', ')}`,
                'events',
                'INVALID_EVENT'
              );
            }
            return event;
          },
        },
        active: {
          type: 'boolean',
          required: false,
          default: true,
        },
        timeout: {
          type: 'number',
          required: false,
          integer: true,
          min: 1000,
          max: 30000,
          default: 5000,
        },
        retries: {
          type: 'number',
          required: false,
          integer: true,
          min: 0,
          max: 10,
          default: 3,
        },
        headers: {
          type: 'object',
          required: false,
          default: {},
        },
      },
    };

    const validated = validateInput(data, schema);

    const id = `webhook-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const webhook = {
      id,
      tenantId: validated.tenantId,
      url: validated.url,
      events: validated.events,
      secret: generateSecret(),
      active: validated.active,
      timeout: validated.timeout,
      retries: validated.retries,
      headers: validated.headers || {},
      createdAt: now,
      updatedAt: now,
      stats: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        lastCallAt: null,
      },
    };

    webhooks.set(id, webhook);
    persistWebhookBestEffort(webhook);

    // Remove secret do retorno por segurança
    const { secret, ...webhookSafe } = webhook;

    return { success: true, webhook: webhookSafe };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { success: false, error: err.message };
    }
    logger.error('[WebhookService] Erro ao criar webhook:', err);
    return { success: false, error: 'Erro interno ao criar webhook' };
  }
}

/**
 * Lista webhooks de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Webhook[]}
 */
function listWebhooks(tenantId) {
  return Array.from(webhooks.values())
    .filter((webhook) => webhook.tenantId === tenantId)
    .map((webhook) => {
      const { secret, ...webhookSafe } = webhook;
      return webhookSafe;
    });
}

/**
 * Obtém um webhook por ID.
 * 
 * @param {string} id - ID do webhook
 * @returns {Webhook|null}
 */
function getWebhook(id) {
  const webhook = webhooks.get(id);
  if (!webhook) {
    return null;
  }
  const { secret, ...webhookSafe } = webhook;
  return webhookSafe;
}

/**
 * Atualiza um webhook.
 * 
 * @param {string} id - ID do webhook
 * @param {Object} updates - Atualizações
 * @returns {{success: boolean, webhook?: Webhook, error?: string}}
 */
function updateWebhook(id, updates) {
  const webhook = webhooks.get(id);
  if (!webhook) {
    return { success: false, error: 'Webhook não encontrado' };
  }

  try {
    if (updates.url !== undefined) {
      const validatedUrl = validateInput(updates.url, {
        type: 'url',
        allowedProtocols: ['http:', 'https:'],
      });
      webhook.url = validatedUrl;
    }

    if (updates.events !== undefined) {
      const validatedEvents = validateInput(updates.events, {
        type: 'array',
        minLength: 1,
        maxLength: 50,
        itemValidator: (event) => {
          if (!AVAILABLE_EVENTS.includes(event)) {
            throw new ValidationError(
              `Evento '${event}' não é válido`,
              'events',
              'INVALID_EVENT'
            );
          }
          return event;
        },
      });
      webhook.events = validatedEvents;
    }

    if (updates.active !== undefined) {
      webhook.active = Boolean(updates.active);
    }

    if (updates.timeout !== undefined) {
      webhook.timeout = validateInput(updates.timeout, {
        type: 'number',
        integer: true,
        min: 1000,
        max: 30000,
      });
    }

    if (updates.retries !== undefined) {
      webhook.retries = validateInput(updates.retries, {
        type: 'number',
        integer: true,
        min: 0,
        max: 10,
      });
    }

    if (updates.headers !== undefined) {
      if (typeof updates.headers === 'object' && !Array.isArray(updates.headers)) {
        webhook.headers = updates.headers;
      }
    }

    webhook.updatedAt = new Date().toISOString();
    persistWebhookBestEffort(webhook);

    const { secret, ...webhookSafe } = webhook;
    return { success: true, webhook: webhookSafe };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { success: false, error: err.message };
    }
    logger.error('[WebhookService] Erro ao atualizar webhook:', err);
    return { success: false, error: 'Erro interno ao atualizar webhook' };
  }
}

/**
 * Deleta um webhook.
 * 
 * @param {string} id - ID do webhook
 * @returns {{success: boolean, error?: string}}
 */
function deleteWebhook(id) {
  if (!webhooks.has(id)) {
    return { success: false, error: 'Webhook não encontrado' };
  }

  webhooks.delete(id);
  deleteWebhookBestEffort(id);

  return { success: true };
}

/**
 * Obtém eventos disponíveis.
 * 
 * @returns {string[]}
 */
function getAvailableEvents() {
  return [...AVAILABLE_EVENTS];
}

module.exports = {
  initialize,
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  triggerWebhooks,
  getAvailableEvents,
  calculateSignature, // Exportado para validação de assinatura
};

