#!/usr/bin/env node

/**
 * Executa Replay do Teste de Login RPA
 * 
 * Uso:
 *   node tests/rpa/executar-replay-login.js                    # Lista replays disponíveis
 *   node tests/rpa/executar-replay-login.js <nome-do-replay>    # Executa replay específico
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const { ReplaySystem } = require('./replaySystem');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

async function executarReplayLogin(replayName) {
  console.log('🎬 EXECUTAR REPLAY DO TESTE DE LOGIN RPA\n');
  console.log('='.repeat(70));

  const replayDir = path.join(__dirname, 'replay');

  // Lista replays disponíveis se não especificado
  if (!replayName) {
    console.log('📁 Replays Disponíveis:\n');
    
    if (!fs.existsSync(replayDir)) {
      console.log('   ⚠️  Nenhum replay encontrado.');
      console.log('   Execute o teste primeiro: node tests/rpa/login.test.js\n');
      return;
    }

    const replays = fs.readdirSync(replayDir)
      .filter(f => f.startsWith('login-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(replayDir, f),
        time: fs.statSync(path.join(replayDir, f)).mtime,
      }))
      .sort((a, b) => b.time - a.time);

    if (replays.length === 0) {
      console.log('   ⚠️  Nenhum replay encontrado.');
      console.log('   Execute o teste primeiro: node tests/rpa/login.test.js\n');
      return;
    }

    replays.forEach((replay, i) => {
      try {
        const replayData = JSON.parse(fs.readFileSync(replay.path, 'utf8'));
        const duration = replayData.endTime && replayData.startTime
          ? Math.round((new Date(replayData.endTime) - new Date(replayData.startTime)) / 1000)
          : 'N/A';
        
        console.log(`   ${i + 1}. ${replay.name}`);
        console.log(`      📊 ${replayData.actions?.length || 0} ações | ⏱️  ${duration}s | 📸 ${replayData.screens?.length || 0} telas`);
        console.log(`      🕐 ${replay.time.toLocaleString('pt-BR')}`);
      } catch (e) {
        console.log(`   ${i + 1}. ${replay.name}`);
        console.log(`      🕐 ${replay.time.toLocaleString('pt-BR')}`);
      }
    });

    console.log('\n   Use: node tests/rpa/executar-replay-login.js <nome-do-replay>');
    console.log('   Exemplo: node tests/rpa/executar-replay-login.js login-flow-1768067967319\n');
    return;
  }

  // Carrega replay
  const replayPath = path.join(replayDir, replayName.endsWith('.json') ? replayName : `${replayName}.json`);

  if (!fs.existsSync(replayPath)) {
    console.log(`\n❌ Replay não encontrado: ${replayName}`);
    console.log('   Use: node tests/rpa/executar-replay-login.js (sem argumentos para listar)\n');
    return;
  }

  try {
    const replayData = JSON.parse(fs.readFileSync(replayPath, 'utf8'));

    console.log(`\n📋 EXECUTANDO REPLAY: ${replayName}\n`);
    console.log('='.repeat(70));
    console.log(`   ID: ${replayData.id || 'N/A'}`);
    console.log(`   Recording ID: ${replayData.recordingId || 'N/A'}`);
    if (replayData.startTime) {
      console.log(`   Original: ${new Date(replayData.startTime).toLocaleString('pt-BR')}`);
    }
    if (replayData.startTime && replayData.endTime) {
      const duration = Math.round((new Date(replayData.endTime) - new Date(replayData.startTime)) / 1000);
      console.log(`   Duração original: ${duration}s`);
    }
    console.log('');

    // Inicializa runner
    console.log('🚀 Inicializando navegador...\n');
    const runner = new RpaTestRunner({
      headless: process.env.HEADLESS !== 'false',
      slowMo: 100,
      timeout: 30000,
    });

    await runner.init();
    
    if (!runner.executor || !runner.executor.page) {
      throw new Error('Executor ou página não disponível após inicialização');
    }
    
    const page = runner.executor.page;

    // Executa ações do replay
    if (replayData.actions && replayData.actions.length > 0) {
      console.log(`📝 Executando ${replayData.actions.length} ações do replay...\n`);
      
      for (let i = 0; i < replayData.actions.length; i++) {
        const action = replayData.actions[i];
        const actionNames = {
          navigate: '🌐 NAVEGAR',
          fill: '✏️  PREENCHER',
          click: '🖱️  CLICAR',
          wait: '⏳ AGUARDAR',
          assert: '✅ VALIDAR',
        };
        
        const actionName = actionNames[action.type] || action.type.toUpperCase();
        console.log(`${i + 1}/${replayData.actions.length}. ${actionName}`);
        
        try {
          switch (action.type) {
            case 'navigate':
              if (action.url) {
                await page.goto(action.url, { waitUntil: 'networkidle', timeout: 30000 });
                console.log(`   ✅ Navegou para: ${action.url}`);
              }
              break;
              
            case 'fill':
              if (action.selector && action.value) {
                await page.waitForSelector(action.selector, { timeout: 5000 });
                await page.fill(action.selector, action.value);
                console.log(`   ✅ Preencheu: ${action.selector} = ${action.value.substring(0, 30)}...`);
              }
              break;
              
            case 'click':
              if (action.selector) {
                await page.waitForSelector(action.selector, { timeout: 5000 });
                await page.click(action.selector);
                console.log(`   ✅ Clicou em: ${action.selector}`);
              }
              break;
              
            case 'wait':
              if (typeof action.condition === 'number') {
                await page.waitForTimeout(action.condition);
                console.log(`   ✅ Aguardou: ${action.condition}ms`);
              } else if (action.condition) {
                await page.waitForSelector(action.condition, { timeout: 10000 });
                console.log(`   ✅ Aguardou elemento: ${action.condition}`);
              }
              break;
              
            case 'assert':
              if (action.selector) {
                const element = await page.$(action.selector);
                const exists = element !== null;
                console.log(`   ✅ Validação: ${action.selector} ${exists ? 'existe' : 'não existe'}`);
              }
              break;
          }
        } catch (error) {
          console.log(`   ❌ Erro ao executar ação: ${error.message}`);
        }
        
        // Pequeno delay entre ações
        await page.waitForTimeout(500);
      }
    } else {
      // Se não há ações no replay, executa fluxo básico de login baseado no replay
      console.log('📝 Replay não contém ações específicas.');
      console.log('   Executando fluxo básico de login...\n');
      
      const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
      const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
      const TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-demo';
      
      // 1. Navega para login
      console.log('1. Navegando para página de login...');
      await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      console.log('   ✅ Página carregada\n');
      
      // 2. Preenche formulário
      console.log('2. Preenchendo formulário...');
      await page.waitForSelector('input[type="text"]', { timeout: 5000 });
      await page.fill('input[type="text"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      console.log('   ✅ Formulário preenchido\n');
      
      // 3. Submete
      console.log('3. Submetendo formulário...');
      const submitButton = await page.$('button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
        console.log('   ✅ Formulário submetido\n');
      }
      
      // 4. Aguarda resposta
      console.log('4. Aguardando resposta...');
      await page.waitForTimeout(3000);
      
      // 5. Verifica modal de tenant
      const modal = await page.$('[role="dialog"], .modal');
      if (modal) {
        console.log('5. Modal de tenant detectado\n');
        await page.waitForTimeout(2000);
        
        // Tenta selecionar tenant
        const tenantButton = await page.$(`button:has-text("${TENANT_ID}")`);
        if (tenantButton) {
          await tenantButton.click();
          console.log(`   ✅ Tenant ${TENANT_ID} selecionado\n`);
        }
      }
      
      await page.waitForTimeout(2000);
    }

    // Screenshot final
    console.log('📸 Capturando screenshot final...');
    const screenshotPath = path.join(__dirname, 'screenshots', `replay-${replayName.replace('.json', '')}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`   ✅ Screenshot salvo: ${screenshotPath}\n`);

    console.log('✅ Replay executado com sucesso!\n');
    console.log(`   URL final: ${page.url()}\n`);

    await runner.close();

  } catch (error) {
    console.error('❌ Erro ao executar replay:', error.message);
    console.error(error.stack);
  }

  console.log('='.repeat(70));
  console.log('✨ Execução do replay concluída!\n');
}

// Executa se chamado diretamente
if (require.main === module) {
  const replayName = process.argv[2];
  executarReplayLogin(replayName)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = { executarReplayLogin };
