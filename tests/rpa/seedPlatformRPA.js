/**
 * Seed da Plataforma usando RPA
 * 
 * Popula a plataforma através da interface web usando RPA
 * Execute: node tests/rpa/seedPlatformRPA.js
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const config = require('./rpaConfig');
const fs = require('fs');
const path = require('path');

// Dados para popular - Expandido com todos os tipos
const SEED_DATA = {
  flows: [
    { name: 'Fluxo de Boas-Vindas', description: 'Fluxo básico de boas-vindas' },
    { name: 'Fluxo de Suporte', description: 'Fluxo de atendimento ao cliente' },
    { name: 'Fluxo de Vendas', description: 'Fluxo para atendimento de vendas' },
  ],
  agents: [
    { username: 'admin', email: 'admin@example.com', password: 'admin123', role: 'admin' },
    { username: 'supervisor', email: 'supervisor@example.com', password: 'supervisor123', role: 'supervisor' },
    { username: 'atendente1', email: 'atendente1@example.com', password: 'atendente123', role: 'agent' },
    { username: 'atendente2', email: 'atendente2@example.com', password: 'atendente123', role: 'agent' },
  ],
  queues: [
    { name: 'suporte' },
    { name: 'vendas' },
    { name: 'tecnico' },
    { name: 'financeiro' },
  ],
  departments: [
    { name: 'Atendimento Geral', description: 'Departamento de atendimento geral', queueNames: 'suporte' },
    { name: 'Vendas', description: 'Departamento de vendas e comercial', queueNames: 'vendas' },
    { name: 'Suporte Técnico', description: 'Departamento de suporte técnico', queueNames: 'tecnico' },
    { name: 'Financeiro', description: 'Departamento financeiro', queueNames: 'financeiro' },
  ],
};

async function seedPlatform() {
  console.log('🌱 Seed da Plataforma via RPA\n');
  console.log('='.repeat(70));
  console.log('⚠️  ATENÇÃO: Esta operação criará dados na plataforma!');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando...\n');

  const runner = new RpaTestRunner({
    headless: false, // Mostra o navegador
    slowMo: 500,     // Delay entre ações
  });

  const results = {
    login: null,
    flows: [],
    agents: [],
    queues: [],
    departments: [],
    errors: [],
  };

  try {
    // 1. Login
    console.log('1️⃣  Fazendo login...\n');
    await runner.init();
    
    const loginRecording = require('./seeds/seed-platform-login.json');
    results.login = await runner.playback(loginRecording, {
      admin: {
        username: 'admin', // Usa username, não email
        email: config.credentials.admin.email,
        password: config.credentials.admin.password,
      },
      urls: {
        frontend: config.urls.frontend,
      },
    });

    if (!results.login.success) {
      throw new Error('Falha no login. Verifique as credenciais.');
    }

    console.log('✅ Login realizado com sucesso!\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. Criar Fluxos
    console.log('2️⃣  Criando fluxos...\n');
    
    for (const flow of SEED_DATA.flows) {
      console.log(`   📝 Criando fluxo: ${flow.name}...`);
      
      const createFlowRecording = require('./seeds/seed-platform-create-flow.json');
      const result = await runner.playback(createFlowRecording, {
        flow: {
          name: flow.name,
        },
        urls: {
          frontend: config.urls.frontend,
        },
      });

      results.flows.push({
        name: flow.name,
        success: result.success,
        errors: result.errors,
      });

      if (result.success) {
        console.log(`   ✅ Fluxo "${flow.name}" criado com sucesso!`);
      } else {
        console.log(`   ❌ Erro ao criar fluxo "${flow.name}":`, result.errors);
        results.errors.push({
          type: 'flow',
          name: flow.name,
          errors: result.errors,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 3. Criar Filas
    console.log('3️⃣  Criando filas...\n');
    
    for (const queue of SEED_DATA.queues) {
      console.log(`   📋 Criando fila: ${queue.name}...`);
      
      try {
        const createQueueRecording = require('./seeds/seed-platform-create-queue.json');
        const result = await runner.playback(createQueueRecording, {
          queue: {
            name: queue.name,
          },
          urls: {
            frontend: config.urls.frontend,
          },
        });

        results.queues.push({
          name: queue.name,
          success: result.success,
          errors: result.errors,
        });

        if (result.success) {
          console.log(`   ✅ Fila "${queue.name}" criada com sucesso!`);
        } else {
          console.log(`   ❌ Erro ao criar fila "${queue.name}":`, result.errors);
          results.errors.push({
            type: 'queue',
            name: queue.name,
            errors: result.errors,
          });
        }
      } catch (error) {
        console.log(`   ⚠️  Gravação não disponível para fila "${queue.name}"`);
        results.queues.push({
          name: queue.name,
          success: false,
          errors: [{ error: 'Gravação não disponível' }],
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // 4. Criar Departamentos
    console.log('4️⃣  Criando departamentos...\n');
    
    for (const dept of SEED_DATA.departments) {
      console.log(`   🏢 Criando departamento: ${dept.name}...`);
      
      try {
        const createDeptRecording = require('./seeds/seed-platform-create-department.json');
        const result = await runner.playback(createDeptRecording, {
          department: {
            name: dept.name,
            description: dept.description,
            queueNames: dept.queueNames,
          },
          urls: {
            frontend: config.urls.frontend,
          },
        });

        results.departments.push({
          name: dept.name,
          success: result.success,
          errors: result.errors,
        });

        if (result.success) {
          console.log(`   ✅ Departamento "${dept.name}" criado com sucesso!`);
        } else {
          console.log(`   ❌ Erro ao criar departamento "${dept.name}":`, result.errors);
          results.errors.push({
            type: 'department',
            name: dept.name,
            errors: result.errors,
          });
        }
      } catch (error) {
        console.log(`   ⚠️  Gravação não disponível para departamento "${dept.name}"`);
        results.departments.push({
          name: dept.name,
          success: false,
          errors: [{ error: 'Gravação não disponível' }],
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // 5. Criar Agentes
    console.log('5️⃣  Criando agentes...\n');
    
    for (const agent of SEED_DATA.agents) {
      // Pula admin e supervisor se já existirem
      if (agent.role === 'admin' || agent.role === 'supervisor') {
        console.log(`   ⏭️  Pulando ${agent.username} (já existe no login)`);
        continue;
      }

      console.log(`   👤 Criando agente: ${agent.username}...`);
      
      try {
        const createAgentRecording = require('./seeds/seed-platform-create-agent.json');
        const result = await runner.playback(createAgentRecording, {
          agent: {
            username: agent.username,
            email: agent.email,
            password: agent.password,
            role: agent.role,
          },
          urls: {
            frontend: config.urls.frontend,
          },
        });

        results.agents.push({
          username: agent.username,
          success: result.success,
          errors: result.errors,
        });

        if (result.success) {
          console.log(`   ✅ Agente "${agent.username}" criado com sucesso!`);
        } else {
          console.log(`   ❌ Erro ao criar agente "${agent.username}":`, result.errors);
          results.errors.push({
            type: 'agent',
            name: agent.username,
            errors: result.errors,
          });
        }
      } catch (error) {
        console.log(`   ⚠️  Gravação não disponível para agente "${agent.username}"`);
        results.agents.push({
          username: agent.username,
          success: false,
          errors: [{ error: 'Gravação não disponível' }],
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 6. Relatório
    console.log('\n📊 Relatório Final:\n');
    console.log(`   ✅ Login: ${results.login.success ? 'SUCESSO' : 'FALHOU'}`);
    console.log(`   📝 Fluxos criados: ${results.flows.filter(f => f.success).length}/${results.flows.length}`);
    console.log(`   📋 Filas criadas: ${results.queues.filter(q => q.success).length}/${results.queues.length}`);
    console.log(`   🏢 Departamentos criados: ${results.departments.filter(d => d.success).length}/${results.departments.length}`);
    console.log(`   👤 Agentes criados: ${results.agents.filter(a => a.success).length}/${results.agents.length}`);
    console.log(`   ❌ Erros: ${results.errors.length}\n`);

    if (results.errors.length > 0) {
      console.log('⚠️  Erros encontrados:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.type}: ${error.name}`);
        error.errors.forEach(err => {
          console.log(`      - ${err.error}`);
        });
      });
      console.log('');
    }

    // Salva relatório
    const reportPath = path.join(__dirname, 'reports', `seed-platform-${Date.now()}.json`);
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      results,
      seedData: SEED_DATA,
    }, null, 2));

    console.log(`📄 Relatório salvo em: ${reportPath}\n`);

    console.log('⏳ Aguardando 3 segundos antes de fechar...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.error('\n❌ Erro durante seed:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    results.errors.push({
      type: 'fatal',
      error: error.message,
    });
  } finally {
    console.log('🔒 Fechando navegador...');
    await runner.close();
    console.log('✅ Navegador fechado!\n');
  }

  console.log('='.repeat(70));
  console.log('✨ Seed via RPA concluído!\n');
  
  return results;
}

// Executa se chamado diretamente
if (require.main === module) {
  seedPlatform().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { seedPlatform, SEED_DATA };

