const fs = require('fs');
const path = require('path');
const net = require('net');

const config = require('./rpaConfig');
const { getOrCreateRpaToken } = require('./utils/rpaTokenManager');
const { resolveSystemBrowserPath } = require('./utils/browserLaunchOptions');

const SEEDS_DIR = path.join(__dirname, 'seeds');
const REPORTS_DIR = path.join(__dirname, 'reports');
const SEED_RECORDINGS = [
  {
    key: 'login',
    filename: 'seed-platform-login.json',
    purpose: 'Smoke público da tela de login',
    dependencies: ['frontend', 'browser'],
    action: 'Executar smoke público de login',
    executionType: 'smoke',
  },
  {
    key: 'flow',
    filename: 'seed-platform-create-flow.json',
    purpose: 'Smoke autenticado da rota do editor de fluxos',
    dependencies: ['frontend', 'browser', 'api'],
    action: 'Validar acesso autenticado ao editor antes do seed funcional via API',
    executionType: 'smoke',
  },
  {
    key: 'queue',
    filename: 'seed-platform-create-queue.json',
    purpose: 'Smoke autenticado da área operacional ligada a filas',
    dependencies: ['frontend', 'browser', 'api'],
    action: 'Validar acesso autenticado ao suporte/filas antes do seed funcional via API',
    executionType: 'smoke',
  },
  {
    key: 'department',
    filename: 'seed-platform-create-department.json',
    purpose: 'Smoke autenticado da tela de departamentos',
    dependencies: ['frontend', 'browser', 'api'],
    action: 'Validar acesso autenticado à tela de departamentos antes do seed funcional via API',
    executionType: 'smoke',
  },
  {
    key: 'agent',
    filename: 'seed-platform-create-agent.json',
    purpose: 'Smoke autenticado da tela de agentes',
    dependencies: ['frontend', 'browser', 'api'],
    action: 'Validar acesso autenticado à tela de agentes antes do seed funcional via API',
    executionType: 'smoke',
  },
];

const SEED_DATA = {
  flows: [
    { id: 'rpa-seed-flow-boas-vindas', name: 'Fluxo de Boas-Vindas', description: 'Fluxo básico de boas-vindas' },
    { id: 'rpa-seed-flow-suporte', name: 'Fluxo de Suporte', description: 'Fluxo de atendimento ao cliente' },
    { id: 'rpa-seed-flow-vendas', name: 'Fluxo de Vendas', description: 'Fluxo para atendimento de vendas' },
  ],
  agents: [
    { username: 'supervisor', email: 'supervisor@example.com', password: 'supervisor123', role: 'manager', name: 'Supervisor Seed' },
    { username: 'atendente1', email: 'atendente1@example.com', password: 'atendente123', role: 'operator', name: 'Atendente Seed 1' },
    { username: 'atendente2', email: 'atendente2@example.com', password: 'atendente123', role: 'operator', name: 'Atendente Seed 2' },
  ],
  queues: [
    { name: 'suporte' },
    { name: 'vendas' },
    { name: 'tecnico' },
    { name: 'financeiro' },
  ],
  departments: [
    { name: 'Atendimento Geral', description: 'Departamento de atendimento geral', queueNames: ['suporte'] },
    { name: 'Vendas', description: 'Departamento de vendas e comercial', queueNames: ['vendas'] },
    { name: 'Suporte Técnico', description: 'Departamento de suporte técnico', queueNames: ['tecnico'] },
    { name: 'Financeiro', description: 'Departamento financeiro', queueNames: ['financeiro'] },
  ],
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonFileIfMissing(filename, content) {
  ensureDir(SEEDS_DIR);
  const fullPath = path.join(SEEDS_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  }
  return fullPath;
}

function ensureSeedRecordings() {
  const created = [];
  const seedDefinitions = [
    {
      filename: 'seed-platform-login.json',
      payload: {
        id: 'seed-platform-login',
        name: 'seed-platform-login',
        version: '1.0.0',
        metadata: {
          autoLogin: false,
          publicRoute: true,
          purpose: 'Verificar que a tela de login está acessível',
        },
        steps: [
          { type: 'navigate', url: '{{urls.frontend}}/login' },
          {
            type: 'assert',
            page: {
              url: { contains: '/login' },
              landmarks: [
                { selector: 'input[name="username"], input[autocomplete="username"], input[id*="username" i]', exists: true },
                { selector: 'input[type="password"], input[name="password"]', exists: true },
              ],
            },
          },
        ],
        data: {},
      },
    },
    {
      filename: 'seed-platform-create-flow.json',
      payload: {
        id: 'seed-platform-create-flow',
        name: 'seed-platform-create-flow',
        version: '1.0.0',
        metadata: {
          autoLogin: true,
          requiresAuth: true,
          purpose: 'Verificar acesso autenticado ao editor de fluxos',
        },
        steps: [
          { type: 'navigate', url: '{{urls.frontend}}/editor' },
          { type: 'assert', page: { url: { contains: '/editor' } } },
        ],
        data: {},
      },
    },
    {
      filename: 'seed-platform-create-queue.json',
      payload: {
        id: 'seed-platform-create-queue',
        name: 'seed-platform-create-queue',
        version: '1.0.0',
        metadata: {
          autoLogin: true,
          requiresAuth: true,
          purpose: 'Verificar acesso autenticado à área operacional relacionada a filas',
        },
        steps: [
          { type: 'navigate', url: '{{urls.frontend}}/support' },
          { type: 'assert', page: { url: { contains: '/support' } } },
        ],
        data: {},
      },
    },
    {
      filename: 'seed-platform-create-department.json',
      payload: {
        id: 'seed-platform-create-department',
        name: 'seed-platform-create-department',
        version: '1.0.0',
        metadata: {
          autoLogin: true,
          requiresAuth: true,
          purpose: 'Verificar acesso autenticado à tela de departamentos',
        },
        steps: [
          { type: 'navigate', url: '{{urls.frontend}}/departments' },
          { type: 'assert', page: { url: { contains: '/departments' } } },
        ],
        data: {},
      },
    },
    {
      filename: 'seed-platform-create-agent.json',
      payload: {
        id: 'seed-platform-create-agent',
        name: 'seed-platform-create-agent',
        version: '1.0.0',
        metadata: {
          autoLogin: true,
          requiresAuth: true,
          purpose: 'Verificar acesso autenticado à tela de agentes',
        },
        steps: [
          { type: 'navigate', url: '{{urls.frontend}}/agents' },
          { type: 'assert', page: { url: { contains: '/agents' } } },
        ],
        data: {},
      },
    },
  ];

  for (const definition of seedDefinitions) {
    const fullPath = path.join(SEEDS_DIR, definition.filename);
    if (!fs.existsSync(fullPath)) {
      writeJsonFileIfMissing(definition.filename, definition.payload);
      created.push(definition.filename);
    }
  }

  return {
    created,
    files: SEED_RECORDINGS.map((item) => path.join(SEEDS_DIR, item.filename)),
  };
}

function parseDatabaseTarget() {
  try {
    const databaseUrl = config && config.urls ? null : null;
    void databaseUrl;
  } catch (_) {}

  try {
    const mainConfig = require('../../api/utils/config');
    const dbUrl = mainConfig.getDatabaseUrl();
    const parsed = new URL(dbUrl);
    return {
      url: dbUrl,
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port || 5432),
      database: parsed.pathname.replace(/^\//, ''),
    };
  } catch (error) {
    return {
      url: null,
      host: 'localhost',
      port: 5432,
      database: null,
      parseError: error.message,
    };
  }
}

function probeTcp(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize({ reachable: true }));
    socket.once('timeout', () => finalize({ reachable: false, error: `timeout:${timeoutMs}ms` }));
    socket.once('error', (error) => finalize({ reachable: false, error: error.message }));

    try {
      socket.connect(port, host);
    } catch (error) {
      finalize({ reachable: false, error: error.message });
    }
  });
}

async function probeHttp(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      reachable: true,
      status: response.status,
      ok: response.ok,
      url,
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      url,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function collectInfraStatus() {
  const frontendUrl = String(config.urls.frontend || 'http://localhost:5173').replace(/\/$/, '');
  const apiUrl = String(config.urls.api || 'http://localhost:3001').replace(/\/$/, '');
  const db = parseDatabaseTarget();
  const browser = resolveSystemBrowserPath();

  const [frontend, apiReady, apiHealth, dbProbe] = await Promise.all([
    probeHttp(frontendUrl),
    probeHttp(`${apiUrl}/health/ready`),
    probeHttp(`${apiUrl}/health`),
    probeTcp(db.host, db.port),
  ]);

  return {
    frontend: { url: frontendUrl, ...frontend },
    api: {
      url: apiUrl,
      reachable: apiReady.reachable || apiHealth.reachable,
      preferredProbe: apiReady.reachable ? apiReady : apiHealth,
      probes: [apiReady, apiHealth],
    },
    db: {
      ...db,
      reachable: dbProbe.reachable,
      error: dbProbe.error || null,
    },
    browser: {
      systemPath: browser.path,
      candidates: browser.candidates,
      playwrightFallbackAvailable: true,
    },
  };
}

function getBlockersForDependencies(dependencies, infra) {
  const blockers = [];
  if (dependencies.includes('frontend') && !infra.frontend.reachable) blockers.push(`frontend indisponível em ${infra.frontend.url}`);
  if (dependencies.includes('api') && !infra.api.reachable) blockers.push(`API indisponível em ${infra.api.url}`);
  if (dependencies.includes('db') && !infra.db.reachable) blockers.push(`PostgreSQL indisponível em ${infra.db.host}:${infra.db.port}`);
  return blockers;
}

function buildSeedMatrix(infra) {
  const matrix = SEED_RECORDINGS.map((recording) => {
    const fullPath = path.join(SEEDS_DIR, recording.filename);
    const blockers = getBlockersForDependencies(recording.dependencies, infra);
    return {
      seed: recording.filename,
      executionType: recording.executionType,
      purpose: recording.purpose,
      dependencies: recording.dependencies,
      exists: fs.existsSync(fullPath),
      status: blockers.length === 0 ? 'ready' : 'blocked',
      blockers,
      action: recording.action,
    };
  });

  const functionalEntries = [
    {
      seed: 'api:create-queues',
      executionType: 'functional-api',
      purpose: 'Criar filas da plataforma de forma idempotente',
      dependencies: ['api', 'db'],
      action: 'Criar filas via POST /queues',
    },
    {
      seed: 'api:create-departments',
      executionType: 'functional-api',
      purpose: 'Criar departamentos referenciando as filas seedadas',
      dependencies: ['api', 'db'],
      action: 'Criar departamentos via POST /departments',
    },
    {
      seed: 'api:create-agents',
      executionType: 'functional-api',
      purpose: 'Criar agentes de seed com credenciais determinísticas',
      dependencies: ['api', 'db'],
      action: 'Criar agentes via POST /auth/agents',
    },
    {
      seed: 'api:create-flows',
      executionType: 'functional-api',
      purpose: 'Criar fluxos mínimos válidos e reutilizáveis',
      dependencies: ['api', 'db'],
      action: 'Criar fluxos via POST /flows',
    },
  ].map((entry) => {
    const blockers = getBlockersForDependencies(entry.dependencies, infra);
    return {
      ...entry,
      exists: true,
      status: blockers.length === 0 ? 'ready' : 'blocked',
      blockers,
    };
  });

  return [...matrix, ...functionalEntries];
}

async function authenticateRpa({ apiBaseUrl, tenantId = 'system' }) {
  const token = getOrCreateRpaToken();
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/rpa/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, tenantId }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok || !payload || !payload.token) {
    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Falha ao autenticar via /auth/rpa/login: ${message}`);
  }

  return payload;
}

async function apiRequest(method, pathname, { apiBaseUrl, token, body } = {}) {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    const error = new Error(`${method} ${pathname} falhou: ${message}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function buildFlowPayload(flow, tenantId = 'system') {
  return {
    id: flow.id,
    tenantId,
    name: flow.name,
    kind: 'chat',
    metadata: {
      generatedBy: 'rpa-seed',
      generated: false,
      status: 'active',
    },
    nodes: [
      { id: 'start', type: 'message', config: { text: flow.description || 'Olá! Como posso ajudar?' }, next: 'collect' },
      { id: 'collect', type: 'user_input', config: { variable: 'customer_need' }, next: 'end-message' },
      { id: 'end-message', type: 'message', config: { text: 'Perfeito, seguimos daqui.' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };
}

async function ensureQueues(seedData, requestContext) {
  const existing = await apiRequest('GET', '/queues', requestContext);
  const existingSet = new Set((Array.isArray(existing) ? existing : []).map((item) => String(item).toLowerCase()));
  const results = [];

  for (const queue of seedData.queues) {
    if (existingSet.has(String(queue.name).toLowerCase())) {
      results.push({ name: queue.name, success: true, status: 'existing' });
      continue;
    }

    const payload = await apiRequest('POST', '/queues', {
      ...requestContext,
      body: { name: queue.name },
    });
    results.push({ name: queue.name, success: true, status: payload?.message === 'Fila já existe' ? 'existing' : 'created' });
  }

  return results;
}

async function ensureDepartments(seedData, requestContext) {
  const existingResponse = await apiRequest('GET', '/departments?activeOnly=false', requestContext);
  const existingDepartments = Array.isArray(existingResponse?.departments) ? existingResponse.departments : [];
  const existingByName = new Map(existingDepartments.map((dept) => [String(dept.name).toLowerCase(), dept]));
  const results = [];

  for (const department of seedData.departments) {
    if (existingByName.has(String(department.name).toLowerCase())) {
      results.push({ name: department.name, success: true, status: 'existing' });
      continue;
    }

    await apiRequest('POST', '/departments', {
      ...requestContext,
      body: {
        name: department.name,
        description: department.description,
        queueNames: department.queueNames,
        color: '#3B82F6',
      },
    });
    results.push({ name: department.name, success: true, status: 'created' });
  }

  return results;
}

async function ensureAgents(seedData, requestContext) {
  const existingResponse = await apiRequest('GET', '/auth/agents', requestContext);
  const existingAgents = Array.isArray(existingResponse?.agents) ? existingResponse.agents : [];
  const existingByUsername = new Map(existingAgents.map((agent) => [String(agent.username).toLowerCase(), agent]));
  const results = [];

  for (const agent of seedData.agents) {
    if (existingByUsername.has(String(agent.username).toLowerCase())) {
      results.push({ username: agent.username, success: true, status: 'existing' });
      continue;
    }

    await apiRequest('POST', '/auth/agents', {
      ...requestContext,
      body: {
        username: agent.username,
        email: agent.email,
        password: agent.password,
        role: agent.role,
        name: agent.name,
      },
    });
    results.push({ username: agent.username, success: true, status: 'created' });
  }

  return results;
}

async function ensureFlows(seedData, requestContext, tenantId = 'system') {
  const existingResponse = await apiRequest('GET', '/flows', requestContext);
  const existingFlows = Array.isArray(existingResponse) ? existingResponse : [];
  const existingById = new Map(existingFlows.map((flow) => [String(flow.id), flow]));
  const results = [];

  for (const flow of seedData.flows) {
    if (existingById.has(flow.id)) {
      results.push({ id: flow.id, name: flow.name, success: true, status: 'existing' });
      continue;
    }

    await apiRequest('POST', '/flows', {
      ...requestContext,
      body: buildFlowPayload(flow, tenantId),
    });
    results.push({ id: flow.id, name: flow.name, success: true, status: 'created' });
  }

  return results;
}

function saveExecutionArtifacts(report, fixedPaths = null) {
  ensureDir(REPORTS_DIR);
  const paths = fixedPaths || (() => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
      jsonPath: path.join(REPORTS_DIR, `seed-platform-${timestamp}.json`),
      mdPath: path.join(REPORTS_DIR, `seed-platform-${timestamp}.md`),
      latestMdPath: path.join(REPORTS_DIR, 'seed-platform-latest.md'),
    };
  })();

  fs.writeFileSync(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const markdown = buildMarkdownReport(report, {
    jsonPath: paths.jsonPath,
    mdPath: paths.mdPath,
    latestMdPath: paths.latestMdPath,
  });
  fs.writeFileSync(paths.mdPath, markdown, 'utf8');
  fs.writeFileSync(paths.latestMdPath, markdown, 'utf8');

  return paths;
}

function buildMarkdownReport(report, paths = {}) {
  const lines = [];
  lines.push('# Relatório Seed/RPA');
  lines.push('');
  if (report.executionId) lines.push(`- Execução: ${report.executionId}`);
  if (report.startedAt) lines.push(`- Início: ${report.startedAt}`);
  if (report.finishedAt) lines.push(`- Fim: ${report.finishedAt}`);
  if (typeof report.durationMs === 'number') lines.push(`- Duração total: ${report.durationMs} ms`);
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- Frontend: ${report.infra.frontend.url} (${report.infra.frontend.reachable ? 'reachable' : 'indisponível'})`);
  lines.push(`- API: ${report.infra.api.url} (${report.infra.api.reachable ? 'reachable' : 'indisponível'})`);
  lines.push(`- PostgreSQL: ${report.infra.db.host}:${report.infra.db.port} (${report.infra.db.reachable ? 'reachable' : 'indisponível'})`);
  lines.push(`- Browser fallback do sistema: ${report.infra.browser.systemPath || 'não encontrado'}`);
  if (paths.jsonPath) lines.push(`- Evidência JSON: ${paths.jsonPath}`);
  if (paths.mdPath) lines.push(`- Evidência Markdown: ${paths.mdPath}`);
  if (paths.latestMdPath) lines.push(`- Evidência Markdown latest: ${paths.latestMdPath}`);
  lines.push('');
  lines.push('## Resumo');
  if (report.smokeSummary) {
    lines.push(`- Smoke total: ${report.smokeSummary.total}`);
    lines.push(`- Smoke executados: ${report.smokeSummary.executed}`);
    lines.push(`- Smoke pulados: ${report.smokeSummary.skipped}`);
    lines.push(`- Smoke pass: ${report.smokeSummary.passed}`);
    lines.push(`- Smoke fail: ${report.smokeSummary.failed}`);
  }
  if (report.functionalResults) {
    const status = report.functionalResults.skipped
      ? 'SKIPPED'
      : (report.functionalResults.failed ? 'FAIL' : 'PASS');
    lines.push(`- Seed funcional: ${status}`);
    if (Array.isArray(report.functionalResults.reasons) && report.functionalResults.reasons.length > 0) {
      lines.push(`- Seed funcional motivos: ${report.functionalResults.reasons.join('; ')}`);
    }
  }
  lines.push('');
  lines.push('## Problemas Encontrados');
  for (const item of report.problemsFound) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Correções Aplicadas');
  for (const item of report.fixesApplied) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Matriz Seed');
  lines.push('| Seed | Tipo | Status | Dependências | Bloqueios | Ação corretiva |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const item of report.matrix) {
    lines.push(`| ${item.seed} | ${item.executionType} | ${item.status} | ${item.dependencies.join(', ')} | ${(item.blockers || []).join('; ') || '-'} | ${item.action} |`);
  }
  lines.push('');
  lines.push('## Testes Executados');
  for (const item of report.testsExecuted) {
    lines.push(`- ${item.name}: ${item.result}${item.details ? ` (${item.details})` : ''}`);
  }
  lines.push('');
  lines.push('## Evidências');
  for (const item of report.evidence) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Pendências Reais');
  if ((report.remainingLimitations || []).length === 0) {
    lines.push('- Nenhuma pendência estrutural adicional identificada nesta rodada.');
  } else {
    for (const item of report.remainingLimitations) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');
  lines.push('## Como Executar');
  lines.push('- Smoke local RPA: `node tests/rpa/seedPlatformRPA.js --smoke-only`');
  lines.push('- Seed funcional completo: `node tests/rpa/seedPlatformRPA.js`');
  lines.push('- Seed completo com resumo expandido: `node tests/rpa/seedPlatformCompleto.js --yes`');
  lines.push('- Testes unitários do motor/RPA: `npm run test:rpa:jest -- --runInBand`');
  lines.push('');
  lines.push('## Diferenças de Escopo');
  lines.push('- Unit tests do engine: validam runner, asserts, gravação e fallbacks sem depender da stack completa.');
  lines.push('- Smoke RPA: valida login público e rotas críticas autenticadas com Playwright.');
  lines.push('- Seed funcional: cria filas, departamentos, agentes e fluxos pela API autenticada, de forma idempotente.');
  lines.push('');
  lines.push('## Próxima Gravação de Seed');
  lines.push('- Use `node tests/rpa/gravar-seed-rpa.js <nome> <url>` para gravar novos seeds de UI.');
  lines.push('- Prefira asserts de URL e seletores estáveis (`name`, `data-testid`) para reduzir fragilidade.');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  REPORTS_DIR,
  SEED_DATA,
  SEED_RECORDINGS,
  ensureSeedRecordings,
  collectInfraStatus,
  buildSeedMatrix,
  authenticateRpa,
  ensureQueues,
  ensureDepartments,
  ensureAgents,
  ensureFlows,
  saveExecutionArtifacts,
  buildMarkdownReport,
};
