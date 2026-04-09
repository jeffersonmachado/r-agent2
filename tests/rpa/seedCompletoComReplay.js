/**
 * Seed Completo com Replay Detalhado
 * 
 * Executa seed completo e gera replay detalhado
 * Execute: node tests/rpa/seedCompletoComReplay.js
 */

const { seedPlatform } = require('./seedPlatformRPA');
const { assertLegacyEntrypointAllowed } = require('../../core/rpa/legacyEntrypointGuard');
const fs = require('fs');
const path = require('path');

async function seedCompletoComReplay() {
  console.log('🌱 Seed Completo da Plataforma via RPA\n');
  console.log('='.repeat(70));
  console.log('📹 Modo com replay detalhado');
  console.log('='.repeat(70));
  console.log('\n🚀 Iniciando...\n');

  const startTime = Date.now();
  
  try {
    const results = await seedPlatform();
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Gera replay detalhado
    console.log('\n' + '='.repeat(70));
    console.log('📊 REPLAY DETALHADO DA EXECUÇÃO\n');
    console.log('='.repeat(70));

    // 1. Login
    console.log('\n1️⃣  LOGIN');
    console.log('─'.repeat(70));
    if (results.login) {
      console.log(`   Status: ${results.login.success ? '✅ SUCESSO' : '❌ FALHOU'}`);
      console.log(`   Steps executados: ${results.login.steps?.length || 0}`);
      
      if (results.login.steps && results.login.steps.length > 0) {
        console.log('\n   📝 Detalhes dos Steps:');
        results.login.steps.forEach((step, index) => {
          const icon = step.success ? '✅' : '❌';
          const action = step.action || step.type || 'unknown';
          const actionNames = {
            navigate: '🌐 NAVEGAR',
            fill: '✏️  PREENCHER',
            click: '🖱️  CLICAR',
            wait: '⏳ AGUARDAR',
            assert: '✅ VALIDAR',
          };
          const actionName = actionNames[action.toLowerCase()] || action.toUpperCase();
          
          console.log(`\n   ${icon} Step ${index + 1}: ${actionName}`);
          if (step.url) console.log(`      🌐 URL: ${step.url}`);
          if (step.selector) console.log(`      🎯 Seletor: ${step.selector}`);
          if (step.value && !step.value.includes('***')) {
            console.log(`      📝 Valor: ${step.value.substring(0, 50)}${step.value.length > 50 ? '...' : ''}`);
          }
          if (step.error) console.log(`      ⚠️  Erro: ${step.error}`);
        });
      }

      if (results.login.errors && results.login.errors.length > 0) {
        console.log('\n   ⚠️  Erros encontrados:');
        results.login.errors.forEach((error, index) => {
          console.log(`      ${index + 1}. ${error.error || error.message || JSON.stringify(error)}`);
        });
      }
    } else {
      console.log('   ⚠️  Login não executado');
    }

    // 2. Fluxos
    console.log('\n2️⃣  FLUXOS');
    console.log('─'.repeat(70));
    if (results.flows && results.flows.length > 0) {
      const sucesso = results.flows.filter(f => f.success).length;
      console.log(`   Criados: ${sucesso}/${results.flows.length}`);
      
      results.flows.forEach((flow, index) => {
        const icon = flow.success ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${flow.name}`);
        if (flow.errors && flow.errors.length > 0) {
          flow.errors.forEach(err => {
            console.log(`      ⚠️  ${err.error}`);
          });
        }
      });
    } else {
      console.log('   ⚠️  Nenhum fluxo processado');
    }

    // 3. Filas
    console.log('\n3️⃣  FILAS');
    console.log('─'.repeat(70));
    if (results.queues && results.queues.length > 0) {
      const sucesso = results.queues.filter(q => q.success).length;
      console.log(`   Criadas: ${sucesso}/${results.queues.length}`);
      
      results.queues.forEach((queue, index) => {
        const icon = queue.success ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${queue.name}`);
        if (queue.errors && queue.errors.length > 0) {
          queue.errors.forEach(err => {
            console.log(`      ⚠️  ${err.error}`);
          });
        }
      });
    } else {
      console.log('   ⚠️  Nenhuma fila processada');
    }

    // 4. Departamentos
    console.log('\n4️⃣  DEPARTAMENTOS');
    console.log('─'.repeat(70));
    if (results.departments && results.departments.length > 0) {
      const sucesso = results.departments.filter(d => d.success).length;
      console.log(`   Criados: ${sucesso}/${results.departments.length}`);
      
      results.departments.forEach((dept, index) => {
        const icon = dept.success ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${dept.name}`);
        if (dept.errors && dept.errors.length > 0) {
          dept.errors.forEach(err => {
            console.log(`      ⚠️  ${err.error}`);
          });
        }
      });
    } else {
      console.log('   ⚠️  Nenhum departamento processado');
    }

    // 5. Agentes
    console.log('\n5️⃣  AGENTES');
    console.log('─'.repeat(70));
    if (results.agents && results.agents.length > 0) {
      const sucesso = results.agents.filter(a => a.success).length;
      console.log(`   Criados: ${sucesso}/${results.agents.length}`);
      
      results.agents.forEach((agent, index) => {
        const icon = agent.success ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${agent.username}`);
        if (agent.errors && agent.errors.length > 0) {
          agent.errors.forEach(err => {
            console.log(`      ⚠️  ${err.error}`);
          });
        }
      });
    } else {
      console.log('   ⚠️  Nenhum agente processado');
    }

    // Resumo Final
    console.log('\n' + '='.repeat(70));
    console.log('📈 RESUMO FINAL\n');
    
    const total = {
      flows: results.flows?.length || 0,
      queues: results.queues?.length || 0,
      departments: results.departments?.length || 0,
      agents: results.agents?.length || 0,
    };
    
    const sucesso = {
      flows: results.flows?.filter(f => f.success).length || 0,
      queues: results.queues?.filter(q => q.success).length || 0,
      departments: results.departments?.filter(d => d.success).length || 0,
      agents: results.agents?.filter(a => a.success).length || 0,
    };

    console.log(`   ✅ Login: ${results.login?.success ? 'SUCESSO' : 'FALHOU'}`);
    console.log(`   📝 Fluxos: ${sucesso.flows}/${total.flows} criados`);
    console.log(`   📋 Filas: ${sucesso.queues}/${total.queues} criadas`);
    console.log(`   🏢 Departamentos: ${sucesso.departments}/${total.departments} criados`);
    console.log(`   👤 Agentes: ${sucesso.agents}/${total.agents} criados`);
    console.log(`   ❌ Total de erros: ${results.errors?.length || 0}`);
    console.log(`   ⏱️  Duração: ${(duration / 1000).toFixed(2)} segundos\n`);

    const taxaSucesso = total.flows + total.queues + total.departments + total.agents > 0
      ? ((sucesso.flows + sucesso.queues + sucesso.departments + sucesso.agents) /
         (total.flows + total.queues + total.departments + total.agents) * 100).toFixed(2)
      : 0;

    console.log(`   📊 Taxa de sucesso geral: ${taxaSucesso}%\n`);

    // Salva replay detalhado
    const replayPath = path.join(__dirname, 'reports', `replay-seed-${Date.now()}.json`);
    const replayDir = path.dirname(replayPath);
    if (!fs.existsSync(replayDir)) {
      fs.mkdirSync(replayDir, { recursive: true });
    }

    const replay = {
      timestamp: new Date().toISOString(),
      duration: duration,
      summary: {
        login: results.login?.success || false,
        flows: { total: total.flows, success: sucesso.flows },
        queues: { total: total.queues, success: sucesso.queues },
        departments: { total: total.departments, success: sucesso.departments },
        agents: { total: total.agents, success: sucesso.agents },
        errors: results.errors?.length || 0,
        successRate: taxaSucesso,
      },
      details: results,
    };

    fs.writeFileSync(replayPath, JSON.stringify(replay, null, 2));
    console.log(`📄 Replay salvo em: ${replayPath}\n`);

    console.log('='.repeat(70));
    console.log('✨ Seed completo com replay concluído!\n');

    return results;
  } catch (error) {
    console.error('\n❌ Erro fatal:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  assertLegacyEntrypointAllowed('tests/rpa/seedCompletoComReplay.js');
  seedCompletoComReplay();
}

module.exports = { seedCompletoComReplay };

