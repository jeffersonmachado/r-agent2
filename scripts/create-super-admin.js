/**
 * Script para criar Super Admin
 * 
 * Uso: node scripts/create-super-admin.js
 */

const { runMigrations } = require('../api/db/migrate');
const { defineRelationships } = require('../api/db/models');
const { createTenant, getTenant } = require('../api/services/tenantService');
const { createAgent } = require('../api/services/authService');

async function createSuperAdmin() {
  console.log('🔐 Criando Super Admin (PostgreSQL)...\n');

  // Garante schema atualizado
  await runMigrations();
  defineRelationships();

  // 1. Verificar/criar tenant system
  let systemTenant = await getTenant('system');
  
  if (!systemTenant) {
    console.log('📦 Criando tenant "system"...');
    const tenantResult = await createTenant({
      tenant_key: 'system',
      name: 'Sistema',
      site: 'https://sistema.com',
      ramo_atividade: 'Sistema de Administração',
      objetivo: 'Administração global do sistema',
      plan: 'enterprise',
    });

    if (!tenantResult.success) {
      console.error('❌ Erro ao criar tenant system:', tenantResult.error);
      return;
    }

    systemTenant = tenantResult.tenant;
    console.log('✅ Tenant "system" criado com sucesso!');
  } else {
    console.log('✅ Tenant "system" já existe');
  }

  // 2. Criar agente owner do tenant system
  console.log('\n👤 Criando agente super admin...');
  const agentResult = await createAgent({
    tenantId: 'system',
    username: 'systemadmin',
    email: 'systemadmin@exemplo.com',
    password: 'Admin123!',
    role: 'super_admin',
    name: 'Administrador do Sistema',
  });

  if (agentResult.success) {
    console.log('\n✅ Super Admin criado com sucesso!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Credenciais:');
    console.log('   Username: systemadmin');
    console.log('   Email: systemadmin@exemplo.com');
    console.log('   Senha: Admin123!');
    console.log('   Role: super_admin');
    console.log('   Tenant: system');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🔗 Acesse: http://localhost:5173/login');
    console.log('📊 Após login, acesse: http://localhost:5173/super-admin');
  } else {
    console.error('❌ Erro ao criar super admin:', agentResult.error);
    
    if (agentResult.error.includes('já existe')) {
      console.log('\n💡 O agente já existe. Você pode:');
      console.log('   1. Usar as credenciais existentes');
      console.log('   2. Resetar a senha via API /auth ou diretamente no PostgreSQL (tabela users)');
    }
  }
}

// Executa
createSuperAdmin().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
