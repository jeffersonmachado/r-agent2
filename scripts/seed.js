/**
 * Script de Seed Completo para r-agent2
 * 
 * Este script popula o sistema com dados iniciais completos:
 * - Tenants (apenas tenant-demo, remove os demais)
 * - Agentes (admin, manager, operator) com todos os campos necessários
 * - Fluxos de conversa
 * - Filas de atendimento
 * - Departamentos
 * - Respostas rápidas
 * - Configurações
 * - Webhooks
 * - Tenant contexts
 * 
 * IMPORTANTE:
 * - Cria apenas o tenant-demo no arquivo tenants.json (mantém o tenant "system")
 * - Remove todos os outros tenants existentes
 * - Agentes são criados com role 'manager' (não 'supervisor') e 'operator' (não 'agent')
 * - Agentes usam 'passwordHash' (não 'hash') para compatibilidade com authService
 * - SEM MIGRAÇÕES: Este script sempre sobrescreve dados existentes
 * - Dados de outros tenants serão perdidos se existirem
 * 
 * Uso:
 *   node scripts/seed.js [--tenant=tenant-id] [--reset]
 * 
 * Se --tenant não for especificado, usa 'tenant-demo' como padrão.
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
  // Senhas seguem padrão similar: [Nome]123!
  const adminPwd = hashPassword('Admin123!');
  const supervisorPwd = hashPassword('Supervisor123!');
  const agentPwd = hashPassword('Atendente123!');
  
  const agents = [
    {
      id: 'admin-001',
      tenantId,
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: adminPwd.hash,
      salt: adminPwd.salt,
      role: 'admin',
      name: 'Administrador',
      active: true,
      status: 'active',
      mfaEnabled: false,
      invitationToken: null,
      invitationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'supervisor-001',
      tenantId,
      username: 'supervisor',
      email: 'supervisor@example.com',
      passwordHash: supervisorPwd.hash,
      salt: supervisorPwd.salt,
      role: 'manager', // supervisor migra para manager
      name: 'Supervisor',
      active: true,
      status: 'active',
      mfaEnabled: false,
      invitationToken: null,
      invitationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'agent-001',
      tenantId,
      username: 'atendente1',
      email: 'atendente1@example.com',
      passwordHash: agentPwd.hash,
      salt: agentPwd.salt,
      role: 'operator', // agent migra para operator
      name: 'Atendente 1',
      active: true,
      status: 'active',
      mfaEnabled: false,
      invitationToken: null,
      invitationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
    {
      id: 'agent-002',
      tenantId,
      username: 'atendente2',
      email: 'atendente2@example.com',
      passwordHash: agentPwd.hash,
      salt: agentPwd.salt,
      role: 'operator', // agent migra para operator
      name: 'Atendente 2',
      active: true,
      status: 'active',
      mfaEnabled: false,
      invitationToken: null,
      invitationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    },
  ];

  return agents;
}

/**
 * Cria apenas o tenant-demo, removendo os demais
 */
function createTenants() {
  const now = new Date().toISOString();
  const trialExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 dias
  
  const tenants = [
    {
      id: 'tenant-demo',
      name: 'Tenant Demo',
      site: 'https://demo.example.com',
      ramo_atividade: 'Tecnologia e Software - Plataforma de demonstração',
      objetivo: 'Demonstração e desenvolvimento da plataforma',
      active: true,
      status: 'trial',
      plan: 'trial',
      limits: {
        usuarios: 3,
        agentes_ia: 2,
        execucoes_rpa: 50,
        tokens_ia: 50000,
        documentos_rag: 50,
        storage_mb: 500
      },
      settings: {},
      branding: {},
      createdAt: now,
      updatedAt: now,
      suspendedAt: null,
      trialExpiresAt: trialExpiresAt
    },
    {
      id: 'system',
      name: 'Sistema',
      site: 'https://sistema.com',
      ramo_atividade: 'Sistema de Administração',
      objetivo: 'Administração global do sistema',
      active: true,
      status: 'active',
      plan: 'enterprise',
      limits: {
        usuarios: -1,
        agentes_ia: -1,
        execucoes_rpa: -1,
        tokens_ia: -1,
        documentos_rag: -1,
        storage_mb: -1
      },
      settings: {},
      branding: {},
      createdAt: now,
      updatedAt: now,
      suspendedAt: null,
      trialExpiresAt: null
    }
  ];
  
  return tenants;
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
 * Cria tenant context (sem migração - sempre sobrescreve)
 */
function createTenantContext(tenantId) {
  const now = new Date().toISOString();
  
  return [
    {
      tenantId,
      ramo_atividade: 'Tecnologia e Software - Desenvolvimento de soluções de automação e inteligência artificial para atendimento ao cliente',
      objetivo: 'Automatizar o atendimento ao cliente com IA, reduzindo tempo de resposta e melhorando a satisfação do cliente através de chatbots inteligentes e RPA',
      site_oficial: 'https://example.com',
      prioridade: 'HIGH',
      escopo: ['rag', 'chatbot', 'classificacao_intencao'],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * Função principal de seed
 */
function seed(tenantId = 'tenant-demo', reset = false) {
  console.log('🌱 Iniciando seed completo...');
  console.log(`📦 Tenant ID: ${tenantId}`);
  
  ensureDataDir();
  
  // SEM MIGRAÇÕES: Sempre sobrescreve dados existentes
  // Isso pode causar erros se houver dados de outros tenants
  if (reset) {
    console.log('⚠️  Modo RESET: dados existentes serão sobrescritos');
  } else {
    console.log('⚠️  ATENÇÃO: Dados existentes serão sobrescritos (sem migração)');
  }
  
  // Cria apenas o tenant-demo (e mantém o tenant system)
  console.log('🏢 Criando tenants (apenas tenant-demo)...');
  const tenants = createTenants();
  fs.writeFileSync(
    path.join(DATA_DIR, 'tenants.json'),
    JSON.stringify(tenants, null, 2),
    'utf8'
  );
  console.log(`   ✅ ${tenants.length} tenant(s) criado(s) (tenant-demo + system)`);

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
  
  // Tenant Context
  console.log('🏢 Criando tenant context...');
  const tenantContexts = createTenantContext(tenantId);
  fs.writeFileSync(
    path.join(DATA_DIR, 'tenant_contexts.json'),
    JSON.stringify(tenantContexts, null, 2),
    'utf8'
  );
  console.log('   ✅ Tenant context criado');
  
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
  console.log('   Admin (role: admin):');
  console.log('     Username: admin');
  console.log('     Password: Admin123!');
  console.log('   Supervisor (role: manager):');
  console.log('     Username: supervisor');
  console.log('     Password: Supervisor123!');
  console.log('   Atendente (role: operator):');
  console.log('     Username: atendente1 ou atendente2');
  console.log('     Password: Atendente123!');
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
    console.log('Uso: node scripts/seed.js [--reset] [--tenant=tenant-id]');
    console.log('');
    console.log('Opções:');
    console.log('  --reset          Sobrescreve dados existentes');
    console.log('  --tenant=ID      Define o tenant ID (padrão: tenant-demo)');
    console.log('  --help, -h       Mostra esta ajuda');
    console.log('');
    console.log('Nota: Este script cria apenas o tenant-demo no arquivo tenants.json,');
    console.log('      removendo todos os outros tenants (exceto o tenant "system").');
    process.exit(0);
  }
}

if (!tenantId) {
  tenantId = 'tenant-demo';
  console.log('ℹ️  Tenant não especificado, usando tenant-demo como padrão');
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

