/**
 * Visualiza Replay/Relatório do Seed RPA
 * 
 * Mostra o replay completo da execução do seed
 * Execute: node tests/rpa/verReplaySeed.js
 */

const fs = require('fs');
const path = require('path');

function verReplaySeed() {
  console.log('📊 Replay do Seed RPA\n');
  console.log('='.repeat(70));

  // Busca relatórios mais recentes
  const reportsDir = path.join(__dirname, 'reports');
  
  if (!fs.existsSync(reportsDir)) {
    console.log('\n❌ Nenhum relatório encontrado.');
    console.log('   Execute o seed primeiro: npm run rpa:seed:debug\n');
    return;
  }

  const reports = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('seed-') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(reportsDir, f),
      time: fs.statSync(path.join(reportsDir, f)).mtime,
    }))
    .sort((a, b) => b.time - a.time);

  if (reports.length === 0) {
    console.log('\n❌ Nenhum relatório encontrado.');
    console.log('   Execute o seed primeiro: npm run rpa:seed:debug\n');
    return;
  }

  // Mostra relatório mais recente
  const latestReport = reports[0];
  console.log(`\n📄 Relatório mais recente: ${latestReport.name}`);
  console.log(`   Criado em: ${latestReport.time.toLocaleString('pt-BR')}\n`);

  try {
    const report = JSON.parse(fs.readFileSync(latestReport.path, 'utf8'));
    
    console.log('='.repeat(70));
    console.log('📊 REPLAY COMPLETO DO SEED\n');
    
    // Login
    if (report.results.login) {
      console.log('1️⃣  LOGIN');
      console.log('─'.repeat(70));
      console.log(`   Status: ${report.results.login.success ? '✅ SUCESSO' : '❌ FALHOU'}`);
      
      if (report.results.login.steps) {
        console.log(`   Steps executados: ${report.results.login.steps.length}\n`);
        report.results.login.steps.forEach((step, index) => {
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
          
          console.log(`   ${icon} Step ${index + 1}: ${actionName}`);
          if (step.selector) console.log(`      🎯 Seletor: ${step.selector}`);
          if (step.url) console.log(`      🌐 URL: ${step.url}`);
          if (step.value) console.log(`      📝 Valor: ${step.value.substring(0, 50)}${step.value.length > 50 ? '...' : ''}`);
          if (step.error) console.log(`      ⚠️  Erro: ${step.error}`);
        });
      }
      
      if (report.results.login.errors && report.results.login.errors.length > 0) {
        console.log(`\n   ⚠️  Erros: ${report.results.login.errors.length}`);
        report.results.login.errors.forEach((error, index) => {
          console.log(`      ${index + 1}. ${error.error}`);
        });
      }
      console.log('');
    }

    // Screenshots
    if (report.screenshots && report.screenshots.length > 0) {
      console.log('📸 SCREENSHOTS CAPTURADOS');
      console.log('─'.repeat(70));
      report.screenshots.forEach((screenshot, index) => {
        const exists = fs.existsSync(screenshot);
        const icon = exists ? '✅' : '❌';
        console.log(`   ${icon} ${index + 1}. ${path.basename(screenshot)}`);
        if (exists) {
          const stats = fs.statSync(screenshot);
          const sizeKB = (stats.size / 1024).toFixed(1);
          console.log(`      Tamanho: ${sizeKB} KB`);
        }
      });
      console.log('');
    }

    // Configuração
    if (report.config) {
      console.log('⚙️  CONFIGURAÇÃO');
      console.log('─'.repeat(70));
      console.log(`   Frontend URL: ${report.config.frontendUrl || 'N/A'}`);
      console.log(`   Senha configurada: ${report.config.hasPassword ? '✅ SIM' : '❌ NÃO'}`);
      console.log('');
    }

    // Timestamp
    console.log('🕐 TIMESTAMP');
    console.log('─'.repeat(70));
    console.log(`   Executado em: ${new Date(report.timestamp).toLocaleString('pt-BR')}`);
    console.log('');

    // Resumo
    console.log('='.repeat(70));
    console.log('📈 RESUMO\n');
    console.log(`   ✅ Login: ${report.results.login?.success ? 'SUCESSO' : 'FALHOU'}`);
    console.log(`   📸 Screenshots: ${report.screenshots?.length || 0}`);
    console.log(`   ❌ Erros: ${report.results.login?.errors?.length || 0}`);
    console.log('');

    // Lista outros relatórios
    if (reports.length > 1) {
      console.log('📁 Outros relatórios disponíveis:');
      reports.slice(1, 6).forEach((r, index) => {
        console.log(`   ${index + 2}. ${r.name} (${r.time.toLocaleString('pt-BR')})`);
      });
      console.log('');
    }

  } catch (error) {
    console.error('❌ Erro ao ler relatório:', error.message);
  }

  console.log('='.repeat(70));
  console.log('✨ Replay visualizado!\n');
}

// Executa se chamado diretamente
if (require.main === module) {
  verReplaySeed();
}

module.exports = { verReplaySeed };

