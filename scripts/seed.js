/**
 * Script de Seed Completo para r-agent2
 * 
 * Este script popula o sistema com dados iniciais completos:
 * - Agentes (admin, supervisor, agent)
 * - Fluxos de conversa
 * - Filas de atendimento
 * - Departamentos
 * - Respostas rápidas
 * - Configurações
 * - Webhooks
 * 
 * Uso:
 *   node scripts/seed.js [--reset] [--tenant=tenant-id]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../api/data');
// Removido DEFAULT_TENANT_ID - tenant deve ser fornecido explicitamente via --tenant=ID

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
 * Cria agentes iniciais
 */
function createAgents(tenantId) {
  const agents = [
    {
      id: 'admin-001',
      tenantId,
      username: 'admin',
      email: 'admin@example.com',
      ...hashPassword('Admin123!'),
      role: 'admin',
      name: 'Administrador',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'supervisor-001',
      tenantId,
      username: 'supervisor',
      email: 'supervisor@example.com',
      ...hashPassword('supervisor123'),
      role: 'supervisor',
      name: 'Supervisor',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'agent-001',
      tenantId,
      username: 'atendente1',
      email: 'atendente1@example.com',
      ...hashPassword('atendente123'),
      role: 'agent',
      name: 'Atendente 1',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'agent-002',
      tenantId,
      username: 'atendente2',
      email: 'atendente2@example.com',
      ...hashPassword('atendente123'),
      role: 'agent',
      name: 'Atendente 2',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
  ];

  return agents;
}

/**
 * Cria tenants iniciais
 */
function createTenants() {
  const tenants = [
    {
      id: 'tenant-default',
      name: 'Tenant Demo',
      site: 'https://example.com',
      ramo_atividade: 'Tecnologia e Software - Desenvolvimento de soluções de automação e inteligência artificial para atendimento ao cliente',
      objetivo: 'Automatizar o atendimento ao cliente com IA, reduzindo tempo de resposta e melhorando a satisfação do cliente através de chatbots inteligentes e RPA',
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: 'tenant-ecommerce',
      name: 'E-commerce Store',
      site: 'https://ecommerce-example.com',
      ramo_atividade: 'E-commerce e Varejo Online - Venda de produtos físicos e digitais através de plataforma online',
      objetivo: 'Melhorar a experiência de compra online, reduzir abandono de carrinho e aumentar conversão através de atendimento proativo e personalizado',
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: 'tenant-saude',
      name: 'Clínica de Saúde',
      site: 'https://clinica-saude-example.com',
      ramo_atividade: 'Saúde e Bem-estar - Clínica médica especializada em atendimento ambulatorial e consultas',
      objetivo: 'Agilizar agendamentos, fornecer informações sobre serviços e tratamentos, e melhorar a comunicação com pacientes através de assistente virtual',
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  return tenants;
}

/**
 * Cria tenant contexts iniciais
 */
function createTenantContexts() {
  const contexts = [
    {
      tenantId: 'tenant-default',
      ramo_atividade: 'Tecnologia e Software - Desenvolvimento de soluções de automação e inteligência artificial para atendimento ao cliente',
      objetivo: 'Automatizar o atendimento ao cliente com IA, reduzindo tempo de resposta e melhorando a satisfação do cliente através de chatbots inteligentes e RPA',
      site_oficial: 'https://example.com',
      prioridade: 'HIGH',
      escopo: ['rag', 'chatbot', 'classificacao_intencao'],
      createdAt: now(),
      updatedAt: now(),
    },
    {
      tenantId: 'tenant-ecommerce',
      ramo_atividade: 'E-commerce e Varejo Online - Venda de produtos físicos e digitais através de plataforma online',
      objetivo: 'Melhorar a experiência de compra online, reduzir abandono de carrinho e aumentar conversão através de atendimento proativo e personalizado',
      site_oficial: 'https://ecommerce-example.com',
      prioridade: 'HIGH',
      escopo: ['rag', 'chatbot', 'classificacao_intencao'],
      createdAt: now(),
      updatedAt: now(),
    },
    {
      tenantId: 'tenant-saude',
      ramo_atividade: 'Saúde e Bem-estar - Clínica médica especializada em atendimento ambulatorial e consultas',
      objetivo: 'Agilizar agendamentos, fornecer informações sobre serviços e tratamentos, e melhorar a comunicação com pacientes através de assistente virtual',
      site_oficial: 'https://clinica-saude-example.com',
      prioridade: 'HIGH',
      escopo: ['rag', 'chatbot', 'classificacao_intencao'],
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  return contexts;
}

/**
 * Cria fluxos iniciais
 */
function createFlows(tenantId) {
  const flows = [
    {
      tenantId,
      id: 'flow-welcome',
      name: 'Fluxo de Boas-Vindas',
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
        tags: ['welcome', 'basic'],
      },
    },
    {
      tenantId,
      id: 'flow-support',
      name: 'Fluxo de Suporte',
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
        tags: ['support', 'escalation'],
      },
    },
  ];

  return flows;
}

/**
 * Cria filas iniciais
 */
function createQueues(tenantId) {
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
 * Cria departamentos iniciais
 */
function createDepartments(tenantId) {
  const now = new Date().toISOString();
  
  return {
    departments: [
      {
        id: 'dept-001',
        name: 'Atendimento Geral',
        description: 'Departamento de atendimento geral ao cliente',
        agentIds: ['agent-001', 'agent-002'],
        queueNames: ['suporte'],
        color: COLORS[0],
        active: true,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      },
      {
        id: 'dept-002',
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
        id: 'dept-003',
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
        id: 'dept-004',
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
 * Cria respostas rápidas iniciais
 */
function createQuickReplies(tenantId) {
  const now = new Date().toISOString();
  
  return {
    quickReplies: [
      {
        id: 'qr-001',
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
        id: 'qr-002',
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
        id: 'qr-003',
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
        id: 'qr-004',
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
        id: 'qr-005',
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
        id: 'qr-006',
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
 * Cria configurações iniciais
 */
function createConfig(tenantId) {
  return {
    api: {
      port: 3000,
      defaultTenantId: tenantId,
      sessionTimeout: 3600000, // 1 hora
      maxRetries: 3,
    },
    chatbot: {
      defaultFlowId: 'flow-welcome',
      enableFallback: true,
      fallbackMaxAttempts: 3,
      enableEmotionCheck: true,
    },
    queues: {
      defaultQueue: 'suporte',
      autoAssign: true,
      maxTicketsPerAgent: 10,
    },
    features: {
      enableRAG: false,
      enableWebhooks: true,
      enableBulkMessaging: false,
    },
  };
}

/**
 * Cria webhooks iniciais
 */
function createWebhooks(tenantId) {
  const now = new Date().toISOString();
  
  return {
    webhooks: [
      {
        id: 'webhook-001',
        tenantId,
        name: 'Webhook de Notificações',
        url: 'https://example.com/webhook',
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
 * Cria sessões vazias
 */
function createSessions() {
  return [];
}

/**
 * Cria audit log vazio
 */
function createAudit() {
  return {
    logs: [],
    savedAt: new Date().toISOString(),
  };
}

/**
 * Cria documentos RAG vazios
 */
function createRAGDocuments(tenantId) {
  return {
    documents: [],
    savedAt: new Date().toISOString(),
  };
}

/**
 * Cria prompts RAG vazios
 */
function createRAGPrompts(tenantId) {
  return {
    prompts: [],
    savedAt: new Date().toISOString(),
  };
}

/**
 * Cria audit RAG vazio
 */
function createRAGAudit() {
  return {
    queries: [],
    savedAt: new Date().toISOString(),
  };
}

/**
 * Função principal de seed
 */
function seed(tenantId = DEFAULT_TENANT_ID, reset = false) {
  console.log('🌱 Iniciando seed completo...');
  console.log(`📦 Tenant ID: ${tenantId}`);
  
  ensureDataDir();
  
  if (reset) {
    console.log('⚠️  Modo RESET: dados existentes serão sobrescritos');
  }
  
  // Tenants
  console.log('🏢 Criando tenants...');
  const tenants = createTenants();
  fs.writeFileSync(
    path.join(DATA_DIR, 'tenants.json'),
    JSON.stringify(tenants, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${tenants.length} tenant(s) criado(s)`);

  // Tenant Contexts
  console.log('🧠 Criando tenant contexts...');
  const tenantContexts = createTenantContexts();
  fs.writeFileSync(
    path.join(DATA_DIR, 'tenant_contexts.json'),
    JSON.stringify(tenantContexts, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${tenantContexts.length} contexto(s) criado(s)`);

  // Agentes
  console.log('👤 Criando agentes...');
  const agents = createAgents(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'agents.json'),
    JSON.stringify(agents, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${agents.length} agente(s) criado(s)`);
  
  // Fluxos
  console.log('🔄 Criando fluxos...');
  const flows = createFlows(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'flows.json'),
    JSON.stringify(flows, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${flows.length} fluxo(s) criado(s)`);
  
  // Filas
  console.log('📋 Criando filas...');
  const queues = createQueues(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'queues.json'),
    JSON.stringify(queues, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${Object.keys(queues.queues).length} fila(s) criada(s)`);
  
  // Departamentos
  console.log('🏢 Criando departamentos...');
  const departments = createDepartments(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'departments.json'),
    JSON.stringify(departments, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${departments.departments.length} departamento(s) criado(s)`);
  
  // Respostas Rápidas
  console.log('💬 Criando respostas rápidas...');
  const quickReplies = createQuickReplies(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'quickReplies.json'),
    JSON.stringify(quickReplies, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${quickReplies.quickReplies.length} resposta(s) rápida(s) criada(s)`);
  
  // Configurações
  console.log('⚙️  Criando configurações...');
  const config = createConfig(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf8'
  );
  console.log('   ✅ Configurações criadas');
  
  // Webhooks
  console.log('🔗 Criando webhooks...');
  const webhooks = createWebhooks(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'webhooks.json'),
    JSON.stringify(webhooks, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${webhooks.webhooks.length} webhook(s) criado(s)`);
  
  // Sessões (vazio)
  console.log('🔐 Criando sessões...');
  const sessions = createSessions();
  fs.writeFileSync(
    path.join(DATA_DIR, 'sessions.json'),
    JSON.stringify(sessions, null, 2),
    'utf8'
  );
  console.log('   ✅ Arquivo de sessões criado');
  
  // Audit (vazio)
  console.log('📝 Criando audit log...');
  const audit = createAudit();
  fs.writeFileSync(
    path.join(DATA_DIR, 'audit.json'),
    JSON.stringify(audit, null, 2),
    'utf8'
  );
  console.log('   ✅ Arquivo de audit criado');
  
  // RAG Documents (vazio)
  console.log('📚 Criando documentos RAG...');
  const ragDocuments = createRAGDocuments(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'rag_documents.json'),
    JSON.stringify(ragDocuments, null, 2),
    'utf8'
  );
  console.log('   ✅ Arquivo de documentos RAG criado');
  
  // RAG Prompts (vazio)
  console.log('🤖 Criando prompts RAG...');
  const ragPrompts = createRAGPrompts(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'rag_prompts.json'),
    JSON.stringify(ragPrompts, null, 2),
    'utf8'
  );
  console.log('   ✅ Arquivo de prompts RAG criado');
  
  // RAG Audit (vazio)
  console.log('📊 Criando audit RAG...');
  const ragAudit = createRAGAudit();
  fs.writeFileSync(
    path.join(DATA_DIR, 'rag_audit.json'),
    JSON.stringify(ragAudit, null, 2),
    'utf8'
  );
  console.log('   ✅ Arquivo de audit RAG criado');
  
  console.log('\n✅ Seed completo concluído com sucesso!');
  console.log(`📁 Dados salvos em: ${DATA_DIR}`);
  console.log('\n📋 Resumo:');
  console.log(`   - ${agents.length} agente(s)`);
  console.log(`   - ${flows.length} fluxo(s)`);
  console.log(`   - ${Object.keys(queues.queues).length} fila(s)`);
  console.log(`   - ${departments.departments.length} departamento(s)`);
  console.log(`   - ${quickReplies.quickReplies.length} resposta(s) rápida(s)`);
  console.log(`   - ${webhooks.webhooks.length} webhook(s)`);
  console.log('\n🔑 Credenciais padrão:');
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
let tenantId = null;
let reset = false;

for (const arg of args) {
  if (arg === '--reset') {
    reset = true;
  } else if (arg.startsWith('--tenant=')) {
    tenantId = arg.split('=')[1];
  } else if (arg === '--help' || arg === '-h') {
    console.log('Uso: node scripts/seed.js [--reset] --tenant=tenant-id');
    console.log('');
    console.log('Opções:');
    console.log('  --reset          Sobrescreve dados existentes');
    console.log('  --tenant=ID      Define o tenant ID (OBRIGATÓRIO)');
    console.log('  --help, -h       Mostra esta ajuda');
    process.exit(0);
  }
}

if (!tenantId) {
  console.error('❌ Erro: --tenant=ID é obrigatório');
  console.error('   Use --help para ver as opções disponíveis');
  process.exit(1);
}

// Executa seed
try {
  seed(tenantId, reset);
  process.exit(0);
} catch (error) {
  console.error('❌ Erro ao executar seed:', error.message);
  console.error(error.stack);
  process.exit(1);
}

