/**
 * Serviço de Webhooks Customizados.
 * 
 * Permite que clientes configurem webhooks para receber notificações
 * de eventos do sistema (tickets criados, mensagens recebidas, etc.)
 * 
 * Persistência:
 * - Webhooks: api/data/webhooks.json
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { validateInput, ValidationError } = require('../utils/inputValidator');

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

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, '..', 'data');
const webhooksFile = path.join(dataDir, 'webhooks.json');

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

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Salva webhooks no arquivo JSON.
 */
function saveWebhooksToFile() {
  try {
    ensureDataDir();
    const webhooksArray = Array.from(webhooks.values());
    const data = JSON.stringify(webhooksArray, null, 2);
    fs.writeFileSync(webhooksFile, data, 'utf8');
    logger.debug(`[WebhookService] Webhooks salvos: ${webhooksArray.length} webhook(s)`);
  } catch (err) {
    logger.error('[WebhookService] Erro ao salvar webhooks:', err);
  }
}

/**
 * Carrega webhooks do arquivo JSON.
 */
function loadWebhooksFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(webhooksFile)) {
      logger.info(`[WebhookService] Arquivo de webhooks não encontrado: ${webhooksFile}. Iniciando com dados vazios.`);
      return;
    }

    const data = fs.readFileSync(webhooksFile, 'utf8');
    const webhooksArray = JSON.parse(data);

    if (Array.isArray(webhooksArray)) {
      webhooks.clear();
      for (const webhook of webhooksArray) {
        webhooks.set(webhook.id, webhook);
      }
      logger.info(`[WebhookService] Carregados ${webhooks.size} webhook(s)`);
    }
  } catch (err) {
    logger.error('[WebhookService] Erro ao carregar webhooks:', err);
    webhooks.clear();
  }
}

// Carrega webhooks ao inicializar
loadWebhooksFromFile();

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
          saveWebhooksToFile();

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
        saveWebhooksToFile();

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
        saveWebhooksToFile();

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
    saveWebhooksToFile();

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
    saveWebhooksToFile();

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
  saveWebhooksToFile();

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
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  triggerWebhooks,
  getAvailableEvents,
  calculateSignature, // Exportado para validação de assinatura
};

