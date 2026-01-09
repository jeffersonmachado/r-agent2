/**
 * Script para criar apenas o seed do tenant (tenant + tenant context)
 * 
 * Este script cria apenas o tenant e seu tenant context, sem criar
 * agentes, fluxos, filas ou outros dados.
 * 
 * Uso:
 *   node scripts/create-tenant-seed.js --tenant=tenant-id --name="Nome do Tenant" --site=https://example.com --ramo="Ramo de Atividade" --objetivo="Objetivo do tenant"
 * 
 * Exemplo:
 *   node scripts/create-tenant-seed.js --tenant=meu-tenant --name="Meu Tenant" --site=https://meusite.com --ramo="Tecnologia" --objetivo="Automatizar processos"
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../api/data');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');
const TENANT_CONTEXTS_FILE = path.join(DATA_DIR, 'tenant_contexts.json');

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
 * Lê arquivo JSON ou retorna array vazio
 */
function readJsonFile(filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }
  return [];
}

/**
 * Salva arquivo JSON
 */
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Cria ou atualiza tenant
 */
function createTenant(tenantId, name, site, ramoAtividade, objetivo) {
  ensureDataDir();
  
  const tenants = readJsonFile(TENANTS_FILE);
  
  // Verifica se tenant já existe
  const existingIndex = tenants.findIndex(t => t.id === tenantId);
  
  const tenant = {
    id: tenantId,
    name: name || `Tenant ${tenantId}`,
    site: site || 'https://example.com',
    ramo_atividade: ramoAtividade || 'Tecnologia e Software',
    objetivo: objetivo || 'Automatizar processos com IA',
    active: true,
    createdAt: existingIndex >= 0 ? tenants[existingIndex].createdAt : now(),
    updatedAt: now(),
  };
  
  // Adiciona campos padrão se não existirem
  if (!tenant.status) tenant.status = 'active';
  if (!tenant.plan) tenant.plan = 'enterprise';
  if (!tenant.limits) {
    tenant.limits = {
      usuarios: -1,
      agentes_ia: -1,
      execucoes_rpa: -1,
      tokens_ia: -1,
      documentos_rag: -1,
      storage_mb: -1
    };
  }
  if (!tenant.settings) tenant.settings = {};
  if (!tenant.branding) tenant.branding = {};
  
  if (existingIndex >= 0) {
    // Atualiza tenant existente
    tenants[existingIndex] = { ...tenants[existingIndex], ...tenant };
    console.log(`   ✅ Tenant "${tenantId}" atualizado`);
  } else {
    // Adiciona novo tenant
    tenants.push(tenant);
    console.log(`   ✅ Tenant "${tenantId}" criado`);
  }
  
  writeJsonFile(TENANTS_FILE, tenants);
  return tenant;
}

/**
 * Cria ou atualiza tenant context
 */
function createTenantContext(tenantId, ramoAtividade, objetivo, site) {
  ensureDataDir();
  
  const contexts = readJsonFile(TENANT_CONTEXTS_FILE);
  
  // Verifica se context já existe
  const existingIndex = contexts.findIndex(c => c.tenantId === tenantId);
  
  const context = {
    tenantId: tenantId,
    ramo_atividade: ramoAtividade || 'Tecnologia e Software',
    objetivo: objetivo || 'Automatizar processos com IA',
    site_oficial: site || 'https://example.com',
    prioridade: 'HIGH',
    escopo: ['rag', 'chatbot', 'classificacao_intencao'],
    createdAt: existingIndex >= 0 ? contexts[existingIndex].createdAt : now(),
    updatedAt: now(),
  };
  
  if (existingIndex >= 0) {
    // Atualiza context existente
    contexts[existingIndex] = { ...contexts[existingIndex], ...context };
    console.log(`   ✅ Tenant context para "${tenantId}" atualizado`);
  } else {
    // Adiciona novo context
    contexts.push(context);
    console.log(`   ✅ Tenant context para "${tenantId}" criado`);
  }
  
  writeJsonFile(TENANT_CONTEXTS_FILE, contexts);
  return context;
}

/**
 * Função principal
 */
function createTenantSeed(tenantId, name, site, ramoAtividade, objetivo) {
  console.log('🌱 Criando seed do tenant...');
  console.log(`📦 Tenant ID: ${tenantId}`);
  
  if (!tenantId) {
    console.error('❌ Erro: --tenant=ID é obrigatório');
    process.exit(1);
  }
  
  // Cria tenant
  console.log('🏢 Criando tenant...');
  const tenant = createTenant(tenantId, name, site, ramoAtividade, objetivo);
  
  // Cria tenant context
  console.log('🧠 Criando tenant context...');
  const context = createTenantContext(tenantId, ramoAtividade, objetivo, site);
  
  console.log('\n✅ Seed do tenant concluído com sucesso!');
  console.log('\n📋 Resumo:');
  console.log(`   Tenant ID: ${tenant.id}`);
  console.log(`   Nome: ${tenant.name}`);
  console.log(`   Site: ${tenant.site}`);
  console.log(`   Ramo: ${tenant.ramo_atividade}`);
  console.log(`   Objetivo: ${tenant.objetivo}`);
}

// Parse argumentos
const args = process.argv.slice(2);
let tenantId = null;
let name = null;
let site = null;
let ramoAtividade = null;
let objetivo = null;

for (const arg of args) {
  if (arg.startsWith('--tenant=')) {
    tenantId = arg.split('=')[1];
  } else if (arg.startsWith('--name=')) {
    name = arg.split('=')[1];
  } else if (arg.startsWith('--site=')) {
    site = arg.split('=')[1];
  } else if (arg.startsWith('--ramo=')) {
    ramoAtividade = arg.split('=')[1];
  } else if (arg.startsWith('--objetivo=')) {
    objetivo = arg.split('=')[1];
  } else if (arg === '--help' || arg === '-h') {
    console.log('Uso: node scripts/create-tenant-seed.js [opções]');
    console.log('');
    console.log('Opções obrigatórias:');
    console.log('  --tenant=ID        ID do tenant (obrigatório)');
    console.log('');
    console.log('Opções opcionais:');
    console.log('  --name="Nome"      Nome do tenant');
    console.log('  --site=URL         URL do site do tenant');
    console.log('  --ramo="Texto"     Ramo de atividade');
    console.log('  --objetivo="Texto" Objetivo do tenant');
    console.log('  --help, -h         Mostra esta ajuda');
    console.log('');
    console.log('Exemplo:');
    console.log('  node scripts/create-tenant-seed.js --tenant=meu-tenant --name="Meu Tenant" --site=https://meusite.com --ramo="Tecnologia" --objetivo="Automatizar processos"');
    process.exit(0);
  }
}

// Executa
try {
  createTenantSeed(tenantId, name, site, ramoAtividade, objetivo);
  process.exit(0);
} catch (error) {
  console.error('❌ Erro ao criar seed do tenant:', error.message);
  console.error(error.stack);
  process.exit(1);
}
