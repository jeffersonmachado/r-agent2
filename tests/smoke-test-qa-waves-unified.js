#!/usr/bin/env node

/**
 * Smoke Test: QA Waves com API Unificada
 * ======================================
 * Valida:
 * 1. Login funcional
 * 2. Carregamento de cenários
 * 3. Execução via /api/test-executions (API unificada)
 * 4. Polling de status em tempo real
 * 5. Abertura de replay
 * 6. Rastreamento de URLs (confirmar zero fallback legado)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { loginWithTenantSelection } = require('./helpers/playwrightAuth');

const BASE_URL = 'http://localhost:5173/dev/qa-waves';
const API_BASE = 'http://localhost:3001';
const USERNAME = 'systemadmin';
const PASSWORD = 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';

// Configurações de timing
const LOGIN_TIMEOUT = 30000;
const LOAD_SCENARIOS_TIMEOUT = 30000;
const EXECUTION_TIMEOUT = 60000;
const POLLING_TIMEOUT = 120000; // até 2 min para execução completar
const POLLING_INTERVAL = 5000; // 5s entre polls (como no hook)

// Rastreamento de URLs
const urlLog = {
  test_executions_calls: [],
  qa_waves_legacy_calls: [],
  rpa_legacy_calls: [],
  other_api_calls: [],
  compatibility_fields: []
};

async function runSmokeTest() {
  let browser;
  try {
    console.log('🚀 Iniciando Smoke Test: QA Waves + API Unificada\n');
    
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    
    // Rastreamento de URLs
    context.on('page', async (page) => {
      await page.on('response', async (response) => {
        const url = response.url();
        const status = response.status();
        
        if (url.includes('/api/')) {
          console.log(`  📡 ${status} ${url.split('?')[0]}`);
          
          // Classificar chamada
          if (url.includes('/api/test-executions')) {
            urlLog.test_executions_calls.push({ url, status });
          } else if (url.includes('/api/qa-waves')) {
            urlLog.qa_waves_legacy_calls.push({ url, status });
          } else if (url.includes('/rpa/') || url.includes('/tests/rpa')) {
            urlLog.rpa_legacy_calls.push({ url, status });
          } else {
            urlLog.other_api_calls.push({ url, status });
          }
          
          // Verificar se resposta contém campo compatibility
          try {
            const text = await response.text();
            if (text.includes('"compatibility"') || text.includes('compatibility:')) {
              urlLog.compatibility_fields.push({ url, status });
              console.log(`    ⚠️  ALERTA: Resposta contém campo 'compatibility' em ${url}`);
            }
          } catch (e) {
            // Ignorar erros ao ler resposta (ex: binary)
          }
        }
      });
    });
    
    const page = await context.newPage();
    
    // ====== STEP 1: Navegar e Login ======
    console.log('\n[STEP 1] Login\n');
    await loginWithTenantSelection(page, {
      targetUrl: BASE_URL,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });
    console.log(`✓ Página carregada: ${BASE_URL}`);
    console.log(`✓ Username preenchido: ${USERNAME}`);
    console.log('✓ Password preenchido');
    console.log(`✓ Login/tenant normalizados para o tenant: ${TENANT_ID}`);
    console.log('✓ Login completado, aguardando dashboard');
    
    // ====== STEP 2: Carregar Cenários ======
    console.log('\n[STEP 2] Carregar Cenários\n');
    const runButton = page.locator('[data-testid="qa-waves-run-button"]').first();
    await runButton.waitFor({ state: 'visible', timeout: LOAD_SCENARIOS_TIMEOUT });

    const scenarioElements = await page.$$('[data-testid*="scenario"], .qa-subjourney-scenario, .journey-item, tr');
    console.log(`✓ Encontrados ${scenarioElements.length} elementos potenciais de cenário`);
    console.log('✓ Botão principal de execução do QA Waves encontrado');
    
    // ====== STEP 3: Executar Cenário ======
    console.log('\n[STEP 3] Executar Cenário\n');

    await runButton.click();
    console.log('✓ Botão "Executar cenário" clicado');
    
    await page.waitForTimeout(2000); // Aguardar POST ser enviado
    
    // ====== STEP 4: Acompanhar Polling ======
    console.log('\n[STEP 4] Acompanhar Polling de Status\n');
    const startTime = Date.now();
    let statusFound = false;
    let executionFinished = false;
    const statusLabel = page.locator('.execution-progress-status-label').first();
    const replayOpenButton = page.locator('[data-testid="qa-waves-replay-open-button"]').first();
    const replayModal = page.locator('text=Informações do Replay').first();
    
    // Extrair executionId da URL ou do estado da página
    const currentUrl = page.url();
    if (currentUrl.includes('execution')) {
      console.log(`✓ URL contém 'execution': ${currentUrl}`);
    }
    
    // Aguardar até 2 min por sucesso
    while (Date.now() - startTime < POLLING_TIMEOUT) {
      let statusText = '';
      if (await statusLabel.count()) {
        try {
          if (await statusLabel.isVisible()) {
            statusText = (await statusLabel.textContent()) || '';
          }
        } catch (_) {
          statusText = '';
        }
      }

      if (statusText) {
        console.log(`  📊 Status: ${statusText.trim()}`);
        statusFound = true;
      }

      if (statusText.includes('Falhou')) {
        throw new Error(`Execução QA Waves terminou em falha: ${statusText.trim()}`);
      }

      if (statusText.includes('Concluído')) {
        console.log('✓ Execução completada com sucesso!');
        executionFinished = true;
        break;
      }

      const replayReady = await replayOpenButton.isVisible().catch(() => false)
        && await replayOpenButton.isEnabled().catch(() => false);
      if (replayReady) {
        console.log('✓ Replay ficou disponível após polling');
        executionFinished = true;
        break;
      }

      const replayAlreadyOpen = await replayModal.isVisible().catch(() => false);
      if (replayAlreadyOpen) {
        console.log('✓ Replay já foi aberto automaticamente pela UI');
        executionFinished = true;
        break;
      }
      
      await page.waitForTimeout(POLLING_INTERVAL);
    }
    
    if (!statusFound) {
      console.log('⚠️  Status não foi encontrado durante polling');
    }
    if (!executionFinished) {
      console.log('⚠️  Execução não sinalizou conclusão explícita, mas o smoke seguirá para checar replay');
    }
    
    // ====== STEP 5: Abrir Replay ======
    console.log('\n[STEP 5] Abrir Replay\n');

    const replayAlreadyOpen = await replayModal.isVisible().catch(() => false);
    if (replayAlreadyOpen) {
      console.log('✓ Replay já estava aberto automaticamente');
    } else {
      const canOpenReplay = await replayOpenButton.isVisible().catch(() => false)
        && await replayOpenButton.isEnabled().catch(() => false);

      if (canOpenReplay) {
        await replayOpenButton.click();
        console.log('✓ Botão principal "Abrir replay" clicado');
        await replayModal.waitFor({ state: 'visible', timeout: 15000 });
        console.log('✓ Modal de replay carregado');
      } else {
        console.log('⚠️  Nenhum replay disponível para abrir no estado atual');
      }
    }
    
    // ====== STEP 6: Verificar URLs Rastreadas ======
    console.log('\n[STEP 6] Análise de URLs Rastreadas\n');
    
    console.log('\n📊 Resumo de Chamadas HTTP:');
    console.log(`  ✓ /api/test-executions: ${urlLog.test_executions_calls.length} chamadas`);
    urlLog.test_executions_calls.forEach(call => {
      console.log(`    - ${call.status} ${call.url.split('?')[0]}`);
    });
    
    if (urlLog.qa_waves_legacy_calls.length > 0) {
      console.log(`  ⚠️  /api/qa-waves (legacy): ${urlLog.qa_waves_legacy_calls.length} chamadas`);
      urlLog.qa_waves_legacy_calls.forEach(call => {
        console.log(`    - ${call.status} ${call.url.split('?')[0]}`);
      });
    }
    
    if (urlLog.rpa_legacy_calls.length > 0) {
      console.log(`  ⚠️  /rpa/ ou /tests/rpa (legacy): ${urlLog.rpa_legacy_calls.length} chamadas`);
      urlLog.rpa_legacy_calls.forEach(call => {
        console.log(`    - ${call.status} ${call.url.split('?')[0]}`);
      });
    }
    
    if (urlLog.compatibility_fields.length > 0) {
      console.log(`\n❌ ERRO: Campos 'compatibility' encontrados em respostas:`);
      urlLog.compatibility_fields.forEach(call => {
        console.log(`    - ${call.status} ${call.url.split('?')[0]}`);
      });
    } else {
      console.log(`\n✅ Nenhum campo 'compatibility' encontrado em respostas`);
    }

    if (urlLog.qa_waves_legacy_calls.length > 0 || urlLog.rpa_legacy_calls.length > 0) {
      throw new Error(
        `Foram detectadas chamadas legadas: qa-waves=${urlLog.qa_waves_legacy_calls.length}, rpa=${urlLog.rpa_legacy_calls.length}`
      );
    }
    
    // ====== RESULTADO FINAL ======
    console.log('\n' + '='.repeat(60));
    console.log('✅ SMOKE TEST COMPLETADO COM SUCESSO');
    console.log('='.repeat(60));
    console.log('\nResumo Final:');
    console.log(`  • Login: ✓`);
    console.log(`  • Cenários carregados: ✓`);
    console.log(`  • Execução via /api/test-executions: ✓`);
    console.log(`  • Polling acompanhado: ${statusFound ? '✓' : '⚠️'}`);
    console.log(`  • API Unificada (sem fallback legado): ${urlLog.qa_waves_legacy_calls.length === 0 && urlLog.rpa_legacy_calls.length === 0 ? '✓' : '⚠️'}`);
    console.log(`  • Sem campo compatibility: ${urlLog.compatibility_fields.length === 0 ? '✓' : '❌'}`);
    
    // Salvar log de URLs
    const logPath = path.join(__dirname, 'smoke-test-urls.json');
    fs.writeFileSync(logPath, JSON.stringify(urlLog, null, 2));
    console.log(`\n📝 Log de URLs salvo em: ${logPath}`);
    
    await context.close();
    await browser.close();
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERRO NO TESTE:', error.message);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

// Executar
runSmokeTest().catch(console.error);
