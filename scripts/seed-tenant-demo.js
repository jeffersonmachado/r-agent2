/**
 * Script de Seed Específico para Tenant Demo
 * 
 * Este script popula APENAS o tenant-demo com dados iniciais:
 * - Agentes (admin, supervisor, agent)
 * - Fluxos de conversa
 * - Filas de atendimento
 * - Departamentos
 * - Respostas rápidas
 * - Webhooks
 * 
 * IMPORTANTE: Este script NÃO sobrescreve tenants.json nem outros tenants.
 * Ele apenas adiciona/atualiza dados relacionados ao tenant-demo, preservando
 * todos os outros dados existentes.
 * 
 * Uso:
 *   node scripts/seed-tenant-demo.js [--reset]
 * 
 * Onde:
 *   --reset: Remove todos os dados do tenant-demo antes de criar novos
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../api/data');
const TENANT_DEMO_ID = 'tenant-demo';

// Cores para departamentos
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

/**
 * Gera hash de senha usando SHA256 + salt
 */
function hashPassword(password, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update(password + actualSalt)
    .digest('hex');
  return { hash, salt: actualSalt };
}

/**
 * Gera ID único
 */
function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Data atual em ISO
 */
function now() {
  return new Date().toISOString();
}

/**
 * Garante que o diretório de dados existe
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Lê um arquivo JSON ou retorna valor padrão
 */
function readJsonFile(filename, defaultValue = null) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.warn(`⚠️  Erro ao ler ${filename}, usando valor padrão:`, err.message);
    return defaultValue;
  }
}

/**
 * Salva um arquivo JSON
 */
function writeJsonFile(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Cria agentes padrão para tenant-demo
 */
function createDemoAgents() {
  return [
    {
      id: 'demo-admin-001',
      tenantId: TENANT_DEMO_ID,
      username: 'admin',
      email: 'admin@demo.example.com',
      ...hashPassword('Admin123!'),
      role: 'admin',
      name: 'Administrador Demo',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'demo-supervisor-001',
      tenantId: TENANT_DEMO_ID,
      username: 'supervisor',
      email: 'supervisor@demo.example.com',
      ...hashPassword('supervisor123'),
      role: 'supervisor',
      name: 'Supervisor Demo',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'demo-agent-001',
      tenantId: TENANT_DEMO_ID,
      username: 'atendente1',
      email: 'atendente1@demo.example.com',
      ...hashPassword('atendente123'),
      role: 'agent',
      name: 'Atendente 1 Demo',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'demo-agent-002',
      tenantId: TENANT_DEMO_ID,
      username: 'atendente2',
      email: 'atendente2@demo.example.com',
      ...hashPassword('atendente123'),
      role: 'agent',
      name: 'Atendente 2 Demo',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
  ];
}

/**
 * Cria fluxos padrão para tenant-demo
 */
function createDemoFlows() {
  return [
    {
      tenantId: TENANT_DEMO_ID,
      id: 'demo-flow-welcome',
      name: 'Fluxo de Boas-Vindas Demo',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'welcome_message',
        },
        {
          id: 'welcome_message',
          type: 'message',
          config: {
            text: 'Olá! 👋 Bem-vindo ao nosso atendimento.\n\nComo posso ajudá-lo hoje?',
          },
          next: 'user_input',
        },
        {
          id: 'user_input',
          type: 'user_input',
          config: {},
          next: 'router',
        },
        {
          id: 'router',
          type: 'router',
          config: {
            rules: [
              {
                condition: '{{userResponse}}',
                contains: ['ajuda', 'suporte', 'problema'],
                next: 'support_flow',
              },
              {
                condition: '{{userResponse}}',
                contains: ['venda', 'comprar', 'produto'],
                next: 'sales_flow',
              },
            ],
            defaultNext: 'default_response',
          },
          next: 'default_response',
        },
        {
          id: 'support_flow',
          type: 'message',
          config: {
            text: 'Vou te ajudar com suporte. Qual é o seu problema?',
          },
          next: 'end',
        },
        {
          id: 'sales_flow',
          type: 'message',
          config: {
            text: 'Ótimo! Vou te ajudar com vendas. O que você gostaria de comprar?',
          },
          next: 'end',
        },
        {
          id: 'default_response',
          type: 'message',
          config: {
            text: 'Entendi. Como posso ajudá-lo melhor?',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {
        description: 'Fluxo básico de boas-vindas com roteamento',
        tags: ['welcome', 'basic', 'demo'],
      },
    },
    {
      tenantId: TENANT_DEMO_ID,
      id: 'demo-flow-support',
      name: 'Fluxo de Suporte Demo',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'greeting',
        },
        {
          id: 'greeting',
          type: 'message',
          config: {
            text: 'Olá! Sou o assistente de suporte. Em que posso ajudá-lo?',
          },
          next: 'collect_issue',
        },
        {
          id: 'collect_issue',
          type: 'user_input',
          config: {},
          next: 'analyze_issue',
        },
        {
          id: 'analyze_issue',
          type: 'router',
          config: {
            rules: [
              {
                condition: '{{userResponse}}',
                contains: ['urgente', 'crítico', 'não funciona'],
                next: 'escalate_human',
              },
            ],
            defaultNext: 'provide_solution',
          },
          next: 'provide_solution',
        },
        {
          id: 'provide_solution',
          type: 'message',
          config: {
            text: 'Vou verificar sua solicitação e retornar em breve.',
          },
          next: 'end',
        },
        {
          id: 'escalate_human',
          type: 'handoff',
          config: {
            queue: 'suporte',
            message: 'Transferindo para atendimento humano...',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {
        description: 'Fluxo de suporte com escalação para humano',
        tags: ['support', 'escalation', 'demo'],
      },
    },
  ];
}

/**
 * Cria filas padrão para tenant-demo
 */
function createDemoQueues() {
  return {
    tickets: [],
    queues: {
      suporte: [],
      vendas: [],
      tecnico: [],
      financeiro: [],
    },
  };
}

/**
 * Cria departamentos padrão para tenant-demo
 */
function createDemoDepartments() {
  const now = new Date().toISOString();
  
  return {
    departments: [
      {
        id: 'demo-dept-001',
        name: 'Atendimento Geral',
        description: 'Departamento de atendimento geral ao cliente',
        agentIds: ['demo-agent-001', 'demo-agent-002'],
        queueNames: ['suporte'],
        color: COLORS[0],
        active: true,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      },
      {
        id: 'demo-dept-002',
        name: 'Vendas',
        description: 'Departamento de vendas e comercial',
        agentIds: [],
        queueNames: ['vendas'],
        color: COLORS[1],
        active: true,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      },
      {
        id: 'demo-dept-003',
        name: 'Suporte Técnico',
        description: 'Departamento de suporte técnico',
        agentIds: [],
        queueNames: ['tecnico'],
        color: COLORS[2],
        active: true,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      },
      {
        id: 'demo-dept-004',
        name: 'Financeiro',
        description: 'Departamento financeiro',
        agentIds: [],
        queueNames: ['financeiro'],
        color: COLORS[3],
        active: true,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      },
    ],
    savedAt: now,
  };
}

/**
 * Cria respostas rápidas padrão para tenant-demo
 */
function createDemoQuickReplies() {
  const now = new Date().toISOString();
  
  return {
    quickReplies: [
      {
        id: 'demo-qr-001',
        title: 'Saudação Inicial',
        message: 'Olá! Como posso ajudá-lo hoje?',
        tags: ['saudacao', 'inicio', 'boas-vindas'],
        category: 'saudacao',
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        active: true,
      },
      {
        id: 'demo-qr-002',
        title: 'Despedida',
        message: 'Obrigado por entrar em contato! Tenha um ótimo dia!',
        tags: ['despedida', 'fim', 'agradecimento'],
        category: 'despedida',
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        active: true,
      },
      {
        id: 'demo-qr-003',
        title: 'Transferindo para Especialista',
        message: 'Vou transferir você para um especialista que poderá ajudá-lo melhor.',
        tags: ['transferencia', 'especialista'],
        category: 'transferencia',
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        active: true,
      },
      {
        id: 'demo-qr-004',
        title: 'Aguardando Informações',
        message: 'Estou verificando as informações. Por favor, aguarde um momento.',
        tags: ['aguardando', 'verificando'],
        category: 'informacao',
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        active: true,
      },
      {
        id: 'demo-qr-005',
        title: 'Problema Resolvido',
        message: 'Problema resolvido! Há mais alguma coisa em que posso ajudá-lo?',
        tags: ['resolvido', 'sucesso'],
        category: 'resolucao',
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        active: true,
      },
      {
        id: 'demo-qr-006',
        title: 'Solicitar Mais Informações',
        message: 'Para melhor atendê-lo, preciso de mais algumas informações. Pode me ajudar?',
        tags: ['informacao', 'dados'],
        category: 'informacao',
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        active: true,
      },
    ],
    savedAt: now,
  };
}

/**
 * Cria webhooks padrão para tenant-demo
 */
function createDemoWebhooks() {
  const now = new Date().toISOString();
  
  return {
    webhooks: [
      {
        id: 'demo-webhook-001',
        tenantId: TENANT_DEMO_ID,
        name: 'Webhook de Notificações Demo',
        url: 'https://demo.example.com/webhook',
        events: ['ticket.created', 'ticket.assigned', 'ticket.closed'],
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    savedAt: now,
  };
}

/**
 * Função principal de seed para tenant-demo
 */
function seedTenantDemo(reset = false) {
  console.log('🌱 Iniciando seed do tenant-demo...');
  console.log(`📦 Tenant ID: ${TENANT_DEMO_ID}`);
  
  ensureDataDir();
  
  if (reset) {
    console.log('⚠️  Modo RESET: removendo dados existentes do tenant-demo');
  }
  
  // ============================================
  // AGENTES
  // ============================================
  console.log('👤 Processando agentes...');
  const existingAgents = readJsonFile('agents.json', []);
  const demoAgents = createDemoAgents();
  
  let agentsArray = Array.isArray(existingAgents) ? [...existingAgents] : [];
  
  if (reset) {
    // Remove agentes do tenant-demo existentes
    agentsArray = agentsArray.filter(a => a.tenantId !== TENANT_DEMO_ID);
  } else {
    // Remove apenas agentes com IDs que serão recriados
    const demoAgentIds = demoAgents.map(a => a.id);
    agentsArray = agentsArray.filter(a => 
      a.tenantId !== TENANT_DEMO_ID || !demoAgentIds.includes(a.id)
    );
  }
  
  // Adiciona novos agentes
  agentsArray.push(...demoAgents);
  writeJsonFile('agents.json', agentsArray);
  console.log(`   ✅ ${demoAgents.length} agente(s) do tenant-demo processado(s)`);
  
  // ============================================
  // FLUXOS
  // ============================================
  console.log('🔄 Processando fluxos...');
  const existingFlows = readJsonFile('flows.json', []);
  const demoFlows = createDemoFlows();
  
  let flowsArray = Array.isArray(existingFlows) ? [...existingFlows] : [];
  
  if (reset) {
    // Remove fluxos do tenant-demo existentes
    flowsArray = flowsArray.filter(f => f.tenantId !== TENANT_DEMO_ID);
  } else {
    // Remove apenas fluxos com IDs que serão recriados
    const demoFlowIds = demoFlows.map(f => f.id);
    flowsArray = flowsArray.filter(f => 
      f.tenantId !== TENANT_DEMO_ID || !demoFlowIds.includes(f.id)
    );
  }
  
  // Adiciona novos fluxos
  flowsArray.push(...demoFlows);
  writeJsonFile('flows.json', flowsArray);
  console.log(`   ✅ ${demoFlows.length} fluxo(s) do tenant-demo processado(s)`);
  
  // ============================================
  // FILAS
  // ============================================
  console.log('📋 Processando filas...');
  const existingQueues = readJsonFile('queues.json', { tickets: [], queues: {} });
  const demoQueues = createDemoQueues();
  
  // Para filas, mantemos a estrutura existente e apenas garantimos que as filas do demo existam
  // Nota: O sistema de filas pode ser compartilhado ou por tenant, dependendo da implementação
  // Por segurança, não sobrescrevemos filas existentes
  if (!existingQueues.queues || Object.keys(existingQueues.queues).length === 0) {
    writeJsonFile('queues.json', demoQueues);
    console.log(`   ✅ Filas do tenant-demo criadas`);
  } else {
    console.log(`   ℹ️  Filas já existem, mantendo estrutura atual`);
  }
  
  // ============================================
  // DEPARTAMENTOS
  // ============================================
  console.log('🏢 Processando departamentos...');
  const existingDepartments = readJsonFile('departments.json', { departments: [], savedAt: now() });
  const demoDepartments = createDemoDepartments();
  
  let departmentsArray = Array.isArray(existingDepartments.departments) 
    ? [...existingDepartments.departments] 
    : [];
  
  if (reset) {
    // Remove departamentos do tenant-demo existentes (assumindo que há campo tenantId)
    departmentsArray = departmentsArray.filter(d => 
      !d.id || !d.id.startsWith('demo-')
    );
  } else {
    // Remove apenas departamentos com IDs que serão recriados
    const demoDeptIds = demoDepartments.departments.map(d => d.id);
    departmentsArray = departmentsArray.filter(d => 
      !demoDeptIds.includes(d.id)
    );
  }
  
  // Adiciona novos departamentos
  departmentsArray.push(...demoDepartments.departments);
  const updatedDepartments = {
    departments: departmentsArray,
    savedAt: now(),
  };
  writeJsonFile('departments.json', updatedDepartments);
  console.log(`   ✅ ${demoDepartments.departments.length} departamento(s) do tenant-demo processado(s)`);
  
  // ============================================
  // RESPOSTAS RÁPIDAS
  // ============================================
  console.log('💬 Processando respostas rápidas...');
  const existingQuickReplies = readJsonFile('quickReplies.json', { quickReplies: [], savedAt: now() });
  const demoQuickReplies = createDemoQuickReplies();
  
  let quickRepliesArray = Array.isArray(existingQuickReplies.quickReplies) 
    ? [...existingQuickReplies.quickReplies] 
    : [];
  
  if (reset) {
    // Remove respostas rápidas do tenant-demo existentes
    quickRepliesArray = quickRepliesArray.filter(qr => 
      !qr.id || !qr.id.startsWith('demo-')
    );
  } else {
    // Remove apenas respostas rápidas com IDs que serão recriados
    const demoQrIds = demoQuickReplies.quickReplies.map(qr => qr.id);
    quickRepliesArray = quickRepliesArray.filter(qr => 
      !demoQrIds.includes(qr.id)
    );
  }
  
  // Adiciona novas respostas rápidas
  quickRepliesArray.push(...demoQuickReplies.quickReplies);
  const updatedQuickReplies = {
    quickReplies: quickRepliesArray,
    savedAt: now(),
  };
  writeJsonFile('quickReplies.json', updatedQuickReplies);
  console.log(`   ✅ ${demoQuickReplies.quickReplies.length} resposta(s) rápida(s) do tenant-demo processada(s)`);
  
  // ============================================
  // WEBHOOKS
  // ============================================
  console.log('🔗 Processando webhooks...');
  const existingWebhooks = readJsonFile('webhooks.json', { webhooks: [], savedAt: now() });
  const demoWebhooks = createDemoWebhooks();
  
  let webhooksArray = Array.isArray(existingWebhooks.webhooks) 
    ? [...existingWebhooks.webhooks] 
    : [];
  
  if (reset) {
    // Remove webhooks do tenant-demo existentes
    webhooksArray = webhooksArray.filter(wh => wh.tenantId !== TENANT_DEMO_ID);
  } else {
    // Remove apenas webhooks com IDs que serão recriados
    const demoWebhookIds = demoWebhooks.webhooks.map(wh => wh.id);
    webhooksArray = webhooksArray.filter(wh => 
      wh.tenantId !== TENANT_DEMO_ID || !demoWebhookIds.includes(wh.id)
    );
  }
  
  // Adiciona novos webhooks
  webhooksArray.push(...demoWebhooks.webhooks);
  const updatedWebhooks = {
    webhooks: webhooksArray,
    savedAt: now(),
  };
  writeJsonFile('webhooks.json', updatedWebhooks);
  console.log(`   ✅ ${demoWebhooks.webhooks.length} webhook(s) do tenant-demo processado(s)`);
  
  console.log('\n✅ Seed do tenant-demo concluído com sucesso!');
  console.log(`📁 Dados salvos em: ${DATA_DIR}`);
  console.log('\n📋 Resumo:');
  console.log(`   - ${demoAgents.length} agente(s)`);
  console.log(`   - ${demoFlows.length} fluxo(s)`);
  console.log(`   - ${Object.keys(demoQueues.queues).length} fila(s)`);
  console.log(`   - ${demoDepartments.departments.length} departamento(s)`);
  console.log(`   - ${demoQuickReplies.quickReplies.length} resposta(s) rápida(s)`);
  console.log(`   - ${demoWebhooks.webhooks.length} webhook(s)`);
  console.log('\n🔑 Credenciais padrão do tenant-demo:');
  console.log('   Admin:');
  console.log('     Username: admin');
  console.log('     Password: Admin123!');
  console.log('   Supervisor:');
  console.log('     Username: supervisor');
  console.log('     Password: supervisor123');
  console.log('   Atendente:');
  console.log('     Username: atendente1 ou atendente2');
  console.log('     Password: atendente123');
}

// Parse argumentos
const args = process.argv.slice(2);
let reset = false;

for (const arg of args) {
  if (arg === '--reset') {
    reset = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log('Uso: node scripts/seed-tenant-demo.js [--reset]');
    console.log('');
    console.log('Opções:');
    console.log('  --reset          Remove todos os dados do tenant-demo antes de criar novos');
    console.log('  --help, -h       Mostra esta ajuda');
    process.exit(0);
  }
}

// Executa seed
try {
  seedTenantDemo(reset);
  process.exit(0);
} catch (error) {
  console.error('❌ Erro ao executar seed do tenant-demo:', error.message);
  console.error(error.stack);
  process.exit(1);
}
