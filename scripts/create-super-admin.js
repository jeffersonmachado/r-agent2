/**
 * Script para criar Super Admin
 * 
 * Uso: node scripts/create-super-admin.js
 */

const { createTenant } = require('../api/services/tenantService');
const { createAgent } = require('../api/services/authService');
const { getTenant } = require('../api/services/tenantService');

async function createSuperAdmin() {
  console.log('🔐 Criando Super Admin...\n');

  // 1. Verificar/criar tenant system
  let systemTenant = getTenant('system');
  
  if (!systemTenant) {
    console.log('📦 Criando tenant "system"...');
    const tenantResult = createTenant({
      id: 'system', // ID fixo para o tenant system
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
  const agentResult = createAgent({
    tenantId: 'system',
    username: 'systemadmin',
    email: 'systemadmin@exemplo.com',
    password: 'Admin123!',
    role: 'owner',
    name: 'Administrador do Sistema',
  });

  if (agentResult.success) {
    console.log('\n✅ Super Admin criado com sucesso!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Credenciais:');
    console.log('   Username: systemadmin');
    console.log('   Email: systemadmin@exemplo.com');
    console.log('   Senha: Admin123!');
    console.log('   Role: owner');
    console.log('   Tenant: system');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🔗 Acesse: http://localhost:5173/login');
    console.log('📊 Após login, acesse: http://localhost:5173/super-admin');
  } else {
    console.error('❌ Erro ao criar super admin:', agentResult.error);
    
    if (agentResult.error.includes('já existe')) {
      console.log('\n💡 O agente já existe. Você pode:');
      console.log('   1. Usar as credenciais existentes');
      console.log('   2. Editar api/data/agents.json para alterar a senha');
    }
  }
}

// Executa
createSuperAdmin().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
