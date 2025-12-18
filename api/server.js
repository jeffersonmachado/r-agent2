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
const { validateFlow } = require('../engine/validator');
const { simulateFlow } = require('../engine/flowSimulation');
const { buildConversationReplay } = require('../engine/replay');

const port = Number(process.env.API_PORT || 3000);
const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'tenant-demo';

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, 'data');
const flowsFile = path.join(dataDir, 'flows.json');

/**
 * Storage em memória com persistência em arquivo JSON.
 * - flows: FlowDefinition por id
 * - sessionEvents: EngineEvent[] por sessionId
 */
const flows = new Map();
const sessionEvents = new Map();

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
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
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

  if (!flow.tenantId || typeof flow.tenantId !== 'string') {
    flow.tenantId = defaultTenantId;
  }

  if (!flow.id || typeof flow.id !== 'string') {
    const baseName = flow.name && typeof flow.name === 'string' ? flow.name : 'flow';
    flow.id = `${baseName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  }

  if (!flow.name || typeof flow.name !== 'string') {
    flow.name = 'Fluxo sem nome';
  }

  if (typeof flow.version !== 'number' || Number.isNaN(flow.version)) {
    flow.version = 1;
  }

  return flow;
}

// ---------------------------------------------------------------------------
// Roteador principal
// ---------------------------------------------------------------------------

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
      env: process.env.NODE_ENV || 'development',
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
    try {
      const body = await parseJsonBody(req);
      const flow = ensureFlowHasMeta(body);
      flows.set(flow.id, flow);
      saveFlowsToFile(); // Salva no arquivo após criar
      sendJson(res, 200, flow);
    } catch (err) {
      badRequest(res, 'JSON inválido no corpo da requisição');
    }
    return;
  }

  // PUT /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'PUT' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    try {
      const body = await parseJsonBody(req);
      const merged = {
        ...(flows.get(id) || {}),
        ...(body && typeof body === 'object' ? body : {}),
        id,
      };
      const flow = ensureFlowHasMeta(merged);
      flows.set(id, flow);
      saveFlowsToFile(); // Salva no arquivo após atualizar
      sendJson(res, 200, flow);
    } catch (err) {
      badRequest(res, 'JSON inválido no corpo da requisição');
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
    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto FlowDefinition');
        return;
      }
      const result = validateFlow(body);
      sendJson(res, 200, {
        valid: Boolean(result && result.valid),
        errors: Array.isArray(result && result.errors) ? result.errors : [],
      });
    } catch (err) {
      badRequest(res, 'Body inválido para validação de fluxo');
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Simulação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/simulate
  if (method === 'POST' && pathname === '/flows/simulate') {
    try {
      const body = await parseJsonBody(req);
      const { flowId, ...options } = body || {};

      if (!flowId || typeof flowId !== 'string') {
        badRequest(res, 'Campo "flowId" é obrigatório');
        return;
      }

      const flow = flows.get(flowId);
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found' });
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
      badRequest(res, 'Erro ao simular fluxo');
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
    flows,
    sessionEvents,
    defaultTenantId,
  },
};

