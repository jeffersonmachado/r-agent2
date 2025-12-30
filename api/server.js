/**
 * Servidor HTTP mínimo para expor a engine via API.
 *
 * Importante:
 * - Não depende de nenhuma biblioteca externa (sem Express).
 * - Exponde endpoints de health/version + CRUD de fluxos, validação,
 *   simulação e replay.
 * - Fluxos são persistidos em arquivo JSON (api/data/flows.json).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');
const { validateFlow, addUiMessage } = require('../engine/validator');
const { simulateFlow } = require('../engine/flowSimulation');
const { buildConversationReplay } = require('../engine/replay');
const { verifyWebhook, sendTextMessage } = require('./services/whatsappService');
const { processWhatsAppMessage } = require('./services/messageProcessor');
const { initializeAiProviders, generateAiResponse } = require('./services/aiProviderService');
const {
  listQueue,
  listQueues,
  createQueue,
  deleteQueue,
  getQueueInfo,
  getTicket,
  getTicketBySession,
  assignTicket,
  closeTicket,
  listAllTickets,
  startAutoCleanup,
  getMetrics,
} = require('./services/queueService');

const port = Number(config.get('api.port', 3000));
const defaultTenantId = config.get('api.defaultTenantId', 'tenant-demo');

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, 'data');
const flowsFile = path.join(dataDir, 'flows.json');
const configFile = path.join(dataDir, 'config.json');

/**
 * Storage em memória com persistência em arquivo JSON.
 * - flows: FlowDefinition por id
 * - sessionEvents: EngineEvent[] por sessionId
 */
const flows = new Map();
const sessionEvents = new Map();

// Limpeza periódica de sessionEvents para evitar memory leak
// Remove sessões mais antigas que 24 horas
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hora
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Limpa sessões antigas do cache de eventos.
 */
function cleanupOldSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const [sessionId, events] of sessionEvents.entries()) {
    if (Array.isArray(events) && events.length > 0) {
      // Pega o timestamp do primeiro evento (mais antigo)
      const firstEvent = events[0];
      if (firstEvent && firstEvent.timestamp) {
        // Converte timestamp ISO string para número
        const eventTimestamp = new Date(firstEvent.timestamp).getTime();
        if (!Number.isNaN(eventTimestamp)) {
          const sessionAge = now - eventTimestamp;
          if (sessionAge > SESSION_MAX_AGE) {
            sessionEvents.delete(sessionId);
            cleaned++;
          }
        }
      }
    }
  }
  if (cleaned > 0) {
    // eslint-disable-next-line no-console
    console.log(`Limpeza de sessões: ${cleaned} sessão(ões) antiga(s) removida(s)`);
  }
}

// Inicia limpeza periódica de sessões
setInterval(cleanupOldSessions, SESSION_CLEANUP_INTERVAL);

// Inicia limpeza periódica de tickets fechados antigos
// Remove tickets fechados com mais de 7 dias, a cada 1 hora
const TICKET_CLEANUP_INTERVAL_HOURS = Number(config.get('api.ticketCleanup.intervalHours', 1));
const TICKET_MAX_AGE_DAYS = Number(config.get('api.ticketCleanup.maxAgeDays', 7));
startAutoCleanup(TICKET_CLEANUP_INTERVAL_HOURS, TICKET_MAX_AGE_DAYS);

// Inicializa providers de IA
initializeAiProviders();

// ---------------------------------------------------------------------------
// Persistência em arquivo JSON
// ---------------------------------------------------------------------------

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Carrega fluxos do arquivo JSON.
 */
function loadFlowsFromFile() {
  try {
    ensureDataDir();
    if (fs.existsSync(flowsFile)) {
      const data = fs.readFileSync(flowsFile, 'utf8');
      const flowsArray = JSON.parse(data);
      if (Array.isArray(flowsArray)) {
        flows.clear();
        for (const flow of flowsArray) {
          if (flow && flow.id) {
            flows.set(flow.id, flow);
          }
        }
        // eslint-disable-next-line no-console
        console.log(`Carregados ${flows.size} fluxo(s) do arquivo ${flowsFile}`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`Arquivo de fluxos não encontrado: ${flowsFile}. Criando novo arquivo.`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Erro ao carregar fluxos do arquivo:', err.message);
    // Continua com Map vazio se houver erro
  }
}

/**
 * Salva todos os fluxos no arquivo JSON.
 */
function saveFlowsToFile() {
  try {
    ensureDataDir();
    const flowsArray = Array.from(flows.values());
    const data = JSON.stringify(flowsArray, null, 2);
    fs.writeFileSync(flowsFile, data, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Fluxos salvos no arquivo ${flowsFile} (${flows.size} fluxo(s))`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Erro ao salvar fluxos no arquivo:', err.message);
  }
}

// Carrega fluxos do arquivo ao iniciar o servidor
loadFlowsFromFile();

// ---------------------------------------------------------------------------
// Helpers HTTP básicos
// ---------------------------------------------------------------------------

/**
 * Faz o parse do body JSON da requisição.
 * Inclui limite de tamanho para prevenir DoS.
 *
 * @param {http.IncomingMessage} req
 * @param {number} [maxSize=10*1024*1024] - Tamanho máximo em bytes (padrão: 10MB)
 * @returns {Promise<any>}
 */
function parseJsonBody(req, maxSize = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy();
        reject(new Error(`Body excede o tamanho máximo de ${maxSize} bytes`));
        return;
      }
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const json = JSON.parse(data);
        resolve(json);
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Adiciona headers CORS à resposta.
 *
 * @param {http.ServerResponse} res
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
}

/**
 * Envia resposta JSON com status code.
 *
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Responde 404 padrão.
 *
 * @param {http.ServerResponse} res
 */
function notFound(res) {
  sendJson(res, 404, { error: 'not_found' });
}

/**
 * Responde 400 padrão.
 *
 * @param {http.ServerResponse} res
 * @param {string} msg
 */
function badRequest(res, msg) {
  sendJson(res, 400, { error: 'bad_request', message: msg });
}

// ---------------------------------------------------------------------------
// Helpers de domínio (FlowDefinition)
// ---------------------------------------------------------------------------

/**
 * Valida a estrutura básica de um FlowDefinition antes de processar.
 *
 * @param {any} rawFlow
 * @returns {{ valid: boolean, error?: string, flow?: any }}
 */
function validateFlowStructure(rawFlow) {
  if (!rawFlow || typeof rawFlow !== 'object') {
    return { valid: false, error: 'Flow deve ser um objeto' };
  }

  if (!Array.isArray(rawFlow.nodes)) {
    return { valid: false, error: 'Flow deve ter um campo "nodes" do tipo array' };
  }

  if (rawFlow.nodes.length === 0) {
    return { valid: false, error: 'Flow deve ter pelo menos um nó' };
  }

  if (rawFlow.nodes.length > 1000) {
    return { valid: false, error: 'Flow excede o limite máximo de 1000 nós' };
  }

  // Validação de tamanho do JSON (limite de 10MB)
  const jsonString = JSON.stringify(rawFlow);
  if (jsonString.length > 10 * 1024 * 1024) {
    return { valid: false, error: 'Flow excede o tamanho máximo de 10MB' };
  }

  return { valid: true, flow: rawFlow };
}

/**
 * Garante metadados mínimos de FlowDefinition.
 *
 * - tenantId: sempre presente (cai no DEFAULT_TENANT_ID se não vier)
 * - id: se não vier, gera um id simples com timestamp
 * - name: valor default amigável
 * - version: default 1 se não vier ou não for número
 *
 * @param {any} rawFlow
 * @returns {any}
 */
function ensureFlowHasMeta(rawFlow) {
  const flow = rawFlow && typeof rawFlow === 'object' ? { ...rawFlow } : {};

  if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
    flow.tenantId = defaultTenantId;
  } else {
    // Sanitiza tenantId
    flow.tenantId = flow.tenantId.trim();
    if (flow.tenantId.length > 100) {
      flow.tenantId = flow.tenantId.substring(0, 100);
    }
  }

  if (!flow.id || typeof flow.id !== 'string' || flow.id.trim() === '') {
    const baseName = flow.name && typeof flow.name === 'string' ? flow.name : 'flow';
    flow.id = `${baseName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${Date.now()}`;
  } else {
    // Sanitiza id
    flow.id = flow.id.trim();
    if (flow.id.length > 200) {
      flow.id = flow.id.substring(0, 200);
    }
  }

  if (!flow.name || typeof flow.name !== 'string' || flow.name.trim() === '') {
    flow.name = 'Fluxo sem nome';
  } else {
    // Sanitiza name
    flow.name = flow.name.trim();
    if (flow.name.length > 500) {
      flow.name = flow.name.substring(0, 500);
    }
  }

  if (typeof flow.version !== 'number' || Number.isNaN(flow.version) || flow.version < 1 || !Number.isInteger(flow.version)) {
    flow.version = 1;
  } else if (flow.version > 999999) {
    // Limite razoável de versão
    flow.version = 999999;
  }

  return flow;
}

// ---------------------------------------------------------------------------
// Roteador principal
// ---------------------------------------------------------------------------

/**
 * Valida se o Content-Type é application/json para requisições com body.
 *
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function hasJsonContentType(req) {
  const contentType = req.headers['content-type'] || '';
  return contentType.toLowerCase().includes('application/json');
}

/**
 * Handler principal da API.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function requestHandler(req, res) {
  const method = (req.method || 'GET').toUpperCase();

  // Handle CORS preflight requests
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // URL é relativa; usamos base fictícia apenas para parse
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname } = url;

  // Healthcheck básico
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Versão / ambiente
  if (method === 'GET' && pathname === '/version') {
    sendJson(res, 200, {
      name: 'chatbot-engine-api',
      env: config.get('nodeEnv', 'development'),
    });
    return;
  }

  // -----------------------------------------------------------------------
  // CRUD de fluxos
  // -----------------------------------------------------------------------

  // GET /flows
  if (method === 'GET' && pathname === '/flows') {
    sendJson(res, 200, Array.from(flows.values()));
    return;
  }

  // GET /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial (validate, simulate) antes de processar
  if (method === 'GET' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    const flow = flows.get(id);
    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return;
    }
    sendJson(res, 200, flow);
    return;
  }

  // POST /flows
  if (method === 'POST' && pathname === '/flows') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);

      // Validação estrutural básica
      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      // Validação completa usando o validador da engine
      const validationResult = validateFlow(body);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        // ✅ Mapeia erros técnicos para mensagens amigáveis
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors, // ✅ Já vem com messageUi do validator
        });
        return;
      }

      const flow = ensureFlowHasMeta(body);

      // Verifica se já existe um fluxo com o mesmo id
      if (flows.has(flow.id)) {
        sendJson(res, 409, {
          error: 'flow_already_exists',
          message: `Já existe um fluxo com o id "${flow.id}". Use PUT para atualizar.`,
        });
        return;
      }

      flows.set(flow.id, flow);
      saveFlowsToFile(); // Salva no arquivo após criar
      sendJson(res, 201, flow);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao criar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // PUT /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'PUT' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));

    // Validação básica do ID
    if (!id || id.trim() === '') {
      badRequest(res, 'ID do fluxo é obrigatório');
      return;
    }

    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);

      // Verifica se o fluxo existe
      const existingFlow = flows.get(id);
      if (!existingFlow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${id}" não encontrado` });
        return;
      }

      // Valida consistência: se body.id existe, deve corresponder ao id da URL
      if (body && typeof body === 'object' && body.id && body.id !== id) {
        badRequest(res, `O ID do fluxo no body ("${body.id}") não corresponde ao ID da URL ("${id}")`);
        return;
      }

      const merged = {
        ...existingFlow,
        ...(body && typeof body === 'object' ? body : {}),
        id, // Garante que o ID não seja alterado
      };

      // Validação estrutural básica
      const structureValidation = validateFlowStructure(merged);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      // Validação completa usando o validador da engine
      const validationResult = validateFlow(merged);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        // ✅ Mapeia erros técnicos para mensagens amigáveis
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors, // ✅ Já vem com messageUi do validator
        });
        return;
      }

      const flow = ensureFlowHasMeta(merged);
      flows.set(id, flow);
      saveFlowsToFile(); // Salva no arquivo após atualizar
      sendJson(res, 200, flow);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao atualizar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // DELETE /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'DELETE' && pathname.startsWith('/flows/')) {
    // Verificar se não é um endpoint especial
    if (pathname === '/flows/validate' || pathname === '/flows/simulate') {
      notFound(res);
      return;
    }
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    const flow = flows.get(id);
    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return;
    }
    flows.delete(id);
    saveFlowsToFile(); // Salva no arquivo após deletar
    sendJson(res, 200, { success: true, deletedId: id });
    return;
  }

  // -----------------------------------------------------------------------
  // Validação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/validate
  if (method === 'POST' && pathname === '/flows/validate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto FlowDefinition');
        return;
      }

      // Validação estrutural básica primeiro
      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        // ✅ Mapeia erro estrutural também
        const structureError = addUiMessage({
          code: 'INVALID_FLOW_STRUCTURE',
          message: structureValidation.error || 'Estrutura do fluxo inválida',
          nodeIds: [],
        });
        sendJson(res, 200, {
          valid: false,
          errors: [structureError], // ✅ Já vem com messageUi do validator
        });
        return;
      }

      const result = validateFlow(body);
      
      sendJson(res, 200, {
        valid: Boolean(result && result.valid),
        errors: result.errors || [], // ✅ Já vem com messageUi do validator
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao validar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao validar fluxo' });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Simulação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/simulate
  if (method === 'POST' && pathname === '/flows/simulate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { flowId, ...options } = body || {};

      if (!flowId || typeof flowId !== 'string' || flowId.trim() === '') {
        badRequest(res, 'Campo "flowId" é obrigatório e deve ser uma string não vazia');
        return;
      }

      // Validação de opções
      if (options.maxSteps !== undefined) {
        if (typeof options.maxSteps !== 'number' || !Number.isInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > 1000) {
          badRequest(res, 'Campo "maxSteps" deve ser um número inteiro entre 1 e 1000');
          return;
        }
      }

      const flow = flows.get(flowId.trim());
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return;
      }

      // Valida o fluxo antes de simular
      const validationResult = validateFlow(flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'flow_invalid',
          message: 'O fluxo não passou na validação e não pode ser simulado',
          errors: validationResult.errors,
        });
        return;
      }

      const result = await simulateFlow(flow, options || {});

      // Guarda eventos por sessão para permitir /replay/:sessionId
      const sessionId =
        result &&
        result.replay &&
        typeof result.replay.sessionId === 'string'
          ? result.replay.sessionId
          : null;

      if (sessionId) {
        sessionEvents.set(sessionId, Array.isArray(result.events) ? result.events : []);
      }

      // Retorna resultado completo da simulação (SimulationResultUi)
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao simular fluxo:', err);
        sendJson(res, 500, {
          error: 'simulation_error',
          message: err && err.message ? err.message : 'Erro interno ao simular fluxo',
        });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  // GET /replay/:sessionId
  if (method === 'GET' && pathname.startsWith('/replay/')) {
    const sessionId = decodeURIComponent(pathname.slice('/replay/'.length));
    const events = sessionEvents.get(sessionId);
    if (!events) {
      sendJson(res, 404, { error: 'session_not_found' });
      return;
    }

    const replay = buildConversationReplay(events);
    sendJson(res, 200, replay);
    return;
  }

  // -----------------------------------------------------------------------
  // Sistema de Filas e Tickets
  // -----------------------------------------------------------------------

  // GET /queues - Lista todas as filas disponíveis
  if (method === 'GET' && pathname === '/queues') {
    const queuesList = listQueues();
    sendJson(res, 200, queuesList);
    return;
  }

  // POST /queues - Cria uma nova fila
  if (method === 'POST' && pathname === '/queues') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const queueName = body && body.name ? String(body.name) : null;

      if (!queueName) {
        badRequest(res, 'Campo "name" é obrigatório');
        return;
      }

      const result = createQueue(queueName);
      
      if (result.success) {
        sendJson(res, result.message === 'Fila já existe' ? 200 : 201, result);
      } else {
        badRequest(res, result.message);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao criar fila:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // GET /queues/:name - Obtém informações sobre uma fila
  if (method === 'GET' && pathname.startsWith('/queues/') && !pathname.endsWith('/tickets')) {
    const queueName = decodeURIComponent(pathname.slice('/queues/'.length));
    const info = getQueueInfo(queueName);
    
    if (info === null) {
      badRequest(res, 'Nome da fila inválido');
      return;
    }
    
    sendJson(res, 200, info);
    return;
  }

  // DELETE /queues/:name - Exclui uma fila
  if (method === 'DELETE' && pathname.startsWith('/queues/') && !pathname.endsWith('/tickets')) {
    const queueName = decodeURIComponent(pathname.slice('/queues/'.length));
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const force = urlObj.searchParams.get('force') === 'true';

    const result = deleteQueue(queueName, force);
    
    if (result.success) {
      sendJson(res, 200, result);
    } else {
      if (result.message.includes('não encontrada')) {
        sendJson(res, 404, result);
      } else {
        sendJson(res, 400, result);
      }
    }
    return;
  }

  // GET /queues/:queue/tickets - Lista tickets de uma fila
  if (method === 'GET' && pathname.startsWith('/queues/') && pathname.endsWith('/tickets')) {
    const queue = decodeURIComponent(pathname.slice('/queues/'.length, -'/tickets'.length));
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status'); // opcional: ?status=waiting

    const tickets = listQueue(queue, status ? { status } : {});
    sendJson(res, 200, tickets);
    return;
  }

  // GET /tickets - Lista todos os tickets (com filtros opcionais e paginação)
  if (method === 'GET' && pathname === '/tickets') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status');
    const queue = urlObj.searchParams.get('queue');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    const result = listAllTickets({ 
      status, 
      queue,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    sendJson(res, 200, result);
    return;
  }

  // GET /tickets/:id - Obtém um ticket específico
  if (method === 'GET' && pathname.startsWith('/tickets/')) {
    const id = decodeURIComponent(pathname.slice('/tickets/'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }
    sendJson(res, 200, ticket);
    return;
  }

  // GET /tickets/session/:sessionId - Obtém ticket ativo de uma sessão
  if (method === 'GET' && pathname.startsWith('/tickets/session/')) {
    const sessionId = decodeURIComponent(pathname.slice('/tickets/session/'.length));
    const ticket = getTicketBySession(sessionId);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }
    sendJson(res, 200, ticket);
    return;
  }

  // POST /tickets/:id/assign - Atribui um ticket para um atendente
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/assign')) {
    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/assign'.length));

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const assignedTo = body && body.assignedTo ? String(body.assignedTo) : 'unknown';

      const ticket = assignTicket(id, assignedTo);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }

      sendJson(res, 200, ticket);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao atribuir ticket:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return;
  }

  // POST /tickets/:id/close - Fecha um ticket
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/close')) {
    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/close'.length));

    const ticket = closeTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return;
    }

    sendJson(res, 200, ticket);
    return;
  }

  // GET /metrics/queues - Obtém métricas do sistema de filas
  if (method === 'GET' && pathname === '/metrics/queues') {
    const metrics = getMetrics();
    sendJson(res, 200, metrics);
    return;
  }

  // POST /tickets/:id/message - Envia mensagem do atendente para o usuário
  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/message')) {
    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/message'.length));

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const message = body && body.message ? String(body.message) : null;

      if (!message || message.trim() === '') {
        badRequest(res, 'Campo "message" é obrigatório e não pode estar vazio');
        return;
      }

      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }

      if (ticket.status === 'closed') {
        badRequest(res, 'Não é possível enviar mensagem para um ticket fechado');
        return;
      }

      // Envia mensagem via WhatsApp
      const phoneNumber = ticket.phoneNumber;
      if (!phoneNumber) {
        badRequest(res, 'Número de telefone não encontrado no ticket');
        return;
      }

      await sendTextMessage(phoneNumber, message);

      sendJson(res, 200, {
        success: true,
        ticketId: id,
        message,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao enviar mensagem:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao enviar mensagem via WhatsApp',
        });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // API de IA
  // -----------------------------------------------------------------------

  // POST /api/ai/generate - Gera resposta de IA
  if (method === 'POST' && pathname === '/api/ai/generate') {
    if (!hasJsonContentType(req)) {
      // eslint-disable-next-line no-console
      console.error('[ERROR] Requisição de IA sem Content-Type JSON');
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { prompt, sessionId, flowId, nodeId, tenantId } = body || {};

      // eslint-disable-next-line no-console
      console.log('[INFO] Requisição de IA recebida', {
        promptLength: prompt?.length,
        sessionId,
        flowId,
        nodeId,
        tenantId,
      });

      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        // eslint-disable-next-line no-console
        console.error('[ERROR] Prompt inválido na requisição de IA', { prompt, type: typeof prompt });
        badRequest(res, 'Campo "prompt" é obrigatório e deve ser uma string não vazia');
        return;
      }

      const effectiveTenantId = tenantId || defaultTenantId;
      // eslint-disable-next-line no-console
      console.log('[DEBUG] Usando tenant para IA', { effectiveTenantId, defaultTenantId });

      try {
        // eslint-disable-next-line no-console
        console.log('[INFO] Gerando resposta de IA...', {
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });
        
        const result = await generateAiResponse(prompt, effectiveTenantId, {
          sessionId,
          flowId,
          nodeId,
        });

        // eslint-disable-next-line no-console
        console.log('[INFO] Resposta de IA gerada com sucesso', {
          hasText: !!result?.text,
          textLength: result?.text?.length,
          hasUsage: !!result?.usage,
        });

        sendJson(res, 200, {
          text: typeof result === 'string' ? result : result.text,
          usage: result.usage || null,
        });
      } catch (aiError) {
        // eslint-disable-next-line no-console
        console.error('[ERROR] Erro ao gerar resposta de IA:', {
          message: aiError.message,
          stack: aiError.stack,
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });
        sendJson(res, 500, {
          error: 'ai_generation_failed',
          message: aiError.message || 'Erro ao gerar resposta de IA',
          details: process.env.NODE_ENV === 'development' ? aiError.stack : undefined,
        });
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        // eslint-disable-next-line no-console
        console.error('[ERROR] JSON inválido na requisição de IA:', err.message);
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('[ERROR] Erro ao processar requisição de IA:', {
          message: err.message,
          stack: err.stack,
        });
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao processar requisição',
        });
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Webhook do WhatsApp
  // -----------------------------------------------------------------------

  // GET /webhooks/whatsapp - verificação do webhook (setup no painel Meta)
  if (method === 'GET' && pathname === '/webhooks/whatsapp') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyWebhook(mode, token)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  // POST /webhooks/whatsapp - mensagens recebidas do WhatsApp
  if (method === 'POST' && pathname === '/webhooks/whatsapp') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            if (change.field === 'messages') {
              const value = change.value || {};
              const messages = value.messages || [];
              for (const msg of messages) {
                // Processa cada mensagem
                // eslint-disable-next-line no-await-in-loop
                await processWhatsAppMessage(msg, value, {
                  flows,
                  sessionEvents,
                });
              }
            }
          }
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro no webhook WhatsApp:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Gerenciamento de Templates
  // -----------------------------------------------------------------------

  // GET /templates - Lista todos os templates disponíveis
  if (method === 'GET' && pathname === '/templates') {
    try {
      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      
      if (!fs.existsSync(templatesDir)) {
        sendJson(res, 200, []);
        return;
      }

      const files = fs.readdirSync(templatesDir);
      const templates = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(templatesDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const template = JSON.parse(content);
            
            // Valida estrutura básica do template
            if (template && template.id && template.name && template.flow) {
              templates.push({
                id: template.id,
                name: template.name,
                description: template.description || '',
                icon: template.icon || '📋',
              });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`Erro ao ler template ${file}:`, err.message);
          }
        }
      }

      sendJson(res, 200, templates);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao listar templates:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar templates' });
    }
    return;
  }

  // POST /templates - Salva um novo template
  if (method === 'POST' && pathname === '/templates') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Valida estrutura básica
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto');
        return;
      }

      if (!body.id || typeof body.id !== 'string' || body.id.trim() === '') {
        badRequest(res, 'Campo "id" é obrigatório e deve ser uma string não vazia');
        return;
      }

      if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        badRequest(res, 'Campo "name" é obrigatório e deve ser uma string não vazia');
        return;
      }

      if (!body.flow || typeof body.flow !== 'object') {
        badRequest(res, 'Campo "flow" é obrigatório e deve ser um objeto');
        return;
      }

      // Valida o fluxo antes de salvar como template
      const validationResult = validateFlow(body.flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors,
        });
        return;
      }

      // Sanitiza o ID do template (usado como nome do arquivo)
      const templateId = body.id.trim().replace(/[^a-z0-9-]/g, '-').toLowerCase();
      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${templateId}.json`);

      // Garante que o diretório existe
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }

      // Prepara o template
      const template = {
        id: templateId,
        name: body.name.trim(),
        description: (body.description || '').trim() || `Template: ${body.name.trim()}`,
        icon: (body.icon || '📋').trim().substring(0, 2),
        flow: body.flow,
      };

      // Salva o arquivo JSON
      fs.writeFileSync(templateFile, JSON.stringify(template, null, 2), 'utf8');

      // eslint-disable-next-line no-console
      console.log(`Template salvo: ${templateFile}`);

      sendJson(res, 201, {
        success: true,
        template: template,
        message: `Template "${template.name}" salvo com sucesso`,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        // eslint-disable-next-line no-console
        console.error('Erro ao salvar template:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao salvar template' });
      }
    }
    return;
  }

  // DELETE /templates/:id - Remove um template
  if (method === 'DELETE' && pathname.startsWith('/templates/')) {
    try {
      let templateId = decodeURIComponent(pathname.slice('/templates/'.length));
      // Remove .json se presente
      if (templateId.endsWith('.json')) {
        templateId = templateId.slice(0, -'.json'.length);
      }
      
      if (!templateId || templateId.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return;
      }

      // Sanitiza o ID do template (mesmo processo usado no POST)
      const sanitizedId = templateId.trim().replace(/[^a-z0-9-]/g, '-').toLowerCase();
      const templatesDir = path.join(__dirname, '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${sanitizedId}.json`);

      // Verifica se o arquivo existe
      if (!fs.existsSync(templateFile)) {
        sendJson(res, 404, {
          error: 'not_found',
          message: `Template "${sanitizedId}" não encontrado`,
        });
        return;
      }

      // Remove o arquivo
      fs.unlinkSync(templateFile);

      // eslint-disable-next-line no-console
      console.log(`Template removido: ${templateFile}`);

      sendJson(res, 200, {
        success: true,
        deletedId: sanitizedId,
        message: `Template "${sanitizedId}" removido com sucesso`,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao remover template:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro interno ao remover template',
      });
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Gerenciamento de configuração
  // -----------------------------------------------------------------------

  // GET /config - Lê a configuração atual
  if (method === 'GET' && pathname === '/config') {
    try {
      const configData = config.getAll();
      sendJson(res, 200, configData);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao ler configuração:', err);
      sendJson(res, 500, { error: 'Erro ao ler configuração' });
    }
    return;
  }

  // PUT /config - Atualiza a configuração
  if (method === 'PUT' && pathname === '/config') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);
      
      // Valida que é um objeto
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return;
      }

      // Salva no arquivo
      ensureDataDir();
      const configData = JSON.stringify(body, null, 2);
      fs.writeFileSync(configFile, configData, 'utf8');
      
      // Recarrega a configuração
      config.reload();
      
      // eslint-disable-next-line no-console
      console.log('Configuração atualizada via API');
      
      sendJson(res, 200, { success: true, message: 'Configuração atualizada com sucesso' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao atualizar configuração:', err);
      sendJson(res, 500, { error: 'Erro ao atualizar configuração', message: err.message });
    }
    return;
  }

  // Qualquer outro endpoint: 404 genérico
  notFound(res);
}

/**
 * Cria um servidor HTTP da API.
 *
 * Exportamos a factory para facilitar testes.
 *
 * @returns {http.Server}
 */
function createServer() {
  return http.createServer((req, res) => {
    // Garante que erros não derrubem o processo.
    requestHandler(req, res).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Erro inesperado ao processar requisição', err);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });
}

const server = createServer();

if (require.main === module) {
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://0.0.0.0:${port}`);
  });
}

module.exports = {
  createServer,
  server,
  // também exportamos helpers principais para facilitar testes isolados, se preciso
  _internal: {
    parseJsonBody,
    sendJson,
    notFound,
    badRequest,
    ensureFlowHasMeta,
    validateFlowStructure,
    flows,
    sessionEvents,
    defaultTenantId,
  },
};


