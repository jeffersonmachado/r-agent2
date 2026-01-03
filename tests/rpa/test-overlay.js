/**
 * Script de teste para verificar se o overlay RPA funciona corretamente
 * 
 * Uso:
 *   node tests/rpa/test-overlay.js
 */

const { chromium } = require('playwright');
const { INJECTABLE_SCRIPT } = require('./overlayInjector');

async function testOverlay() {
  console.log('🧪 Iniciando teste do overlay RPA...\n');
  
  let browser;
  let page;
  
  try {
    // Abre o navegador
    console.log('📦 Abrindo navegador...');
    browser = await chromium.launch({
      headless: false, // Mostra o navegador para visualizar o teste
      slowMo: 100, // Desacelera para facilitar visualização
      devtools: true, // Abre DevTools
    });
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    
    page = await context.newPage();
    
    // Navega para uma página de teste
    console.log('🌐 Navegando para página de teste...');
    await page.goto('https://example.com', { waitUntil: 'networkidle0' });
    
    // Injeta o script
    console.log('💉 Injetando script do overlay...');
    await page.addInitScript(INJECTABLE_SCRIPT);
    
    // Navega novamente para garantir que o script seja executado
    await page.goto('https://example.com', { waitUntil: 'networkidle' });
    
    // Verifica se o script foi injetado
    const scriptInjected = await page.evaluate(() => {
      return typeof window.rpaOverlay !== 'undefined';
    });
    
    if (!scriptInjected) {
      throw new Error('❌ Script não foi injetado corretamente');
    }
    console.log('✅ Script injetado com sucesso!\n');
    
    // Testa init()
    console.log('🧪 Testando window.rpaOverlay.init()...');
    const initResult = await page.evaluate(({ apiUrl, execId }) => {
      if (window.rpaOverlay && window.rpaOverlay.init) {
        return window.rpaOverlay.init(apiUrl, execId);
      }
      return false;
    }, { apiUrl: 'http://localhost:3000', execId: 'test-execution-123' });
    
    console.log(`   Resultado: ${initResult ? '✅ true' : '❌ false'}\n`);
    
    // Aguarda um pouco para o overlay ser criado
    console.log('⏳ Aguardando 1 segundo para overlay ser criado...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verifica se o overlay foi criado
    console.log('🔍 Verificando se overlay foi criado...');
    const overlayStatus = await page.evaluate(() => {
      const overlay = document.getElementById('rpa-replay-overlay');
      const box = document.getElementById('rpa-replay-control-box');
      
      if (!overlay || !box) {
        return {
          success: false,
          overlayExists: !!overlay,
          boxExists: !!box,
          error: 'Elementos não encontrados no DOM'
        };
      }
      
      const overlayRect = overlay.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      const overlayStyle = window.getComputedStyle(overlay);
      const boxStyle = window.getComputedStyle(box);
      
      return {
        success: true,
        overlayExists: true,
        boxExists: true,
        overlay: {
          width: overlayRect.width,
          height: overlayRect.height,
          display: overlayStyle.display,
          visibility: overlayStyle.visibility,
          opacity: overlayStyle.opacity,
          zIndex: overlayStyle.zIndex
        },
        box: {
          width: boxRect.width,
          height: boxRect.height,
          top: boxRect.top,
          left: boxRect.left,
          display: boxStyle.display,
          visibility: boxStyle.visibility,
          opacity: boxStyle.opacity,
          zIndex: boxStyle.zIndex
        }
      };
    });
    
    console.log('\n📊 Resultado da verificação:');
    console.log(JSON.stringify(overlayStatus, null, 2));
    
    if (overlayStatus.success) {
      console.log('\n✅✅✅ TESTE PASSOU! Overlay foi criado com sucesso! ✅✅✅');
      console.log(`   - Overlay: ${overlayStatus.overlay.width}x${overlayStatus.overlay.height}px`);
      console.log(`   - Box: ${overlayStatus.box.width}x${overlayStatus.box.height}px`);
      console.log(`   - Box posição: top=${overlayStatus.box.top}px, left=${overlayStatus.box.left}px`);
      console.log(`   - Box visível: ${overlayStatus.box.display !== 'none' && overlayStatus.box.visibility !== 'hidden' && parseFloat(overlayStatus.box.opacity) > 0}`);
      
      // Aguarda 3 segundos para visualizar
      console.log('\n👀 Aguardando 3 segundos para você visualizar o overlay...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Testa remover
      console.log('\n🗑️ Testando remoção do overlay...');
      const removeResult = await page.evaluate(() => {
        if (window.rpaOverlay && window.rpaOverlay.remove) {
          window.rpaOverlay.remove();
          return true;
        }
        return false;
      });
      
      if (removeResult) {
        console.log('✅ Overlay removido com sucesso!');
      } else {
        console.log('❌ Erro ao remover overlay');
      }
      
      // Verifica se foi removido
      await new Promise(resolve => setTimeout(resolve, 500));
      const stillExists = await page.evaluate(() => {
        return !!document.getElementById('rpa-replay-overlay');
      });
      
      if (!stillExists) {
        console.log('✅ Overlay foi removido do DOM corretamente!');
      } else {
        console.log('⚠️ Overlay ainda existe no DOM após remoção');
      }
      
    } else {
      console.log('\n❌❌❌ TESTE FALHOU! Overlay não foi criado ❌❌❌');
      console.log(`   Erro: ${overlayStatus.error || 'Desconhecido'}`);
      console.log(`   Overlay existe: ${overlayStatus.overlayExists}`);
      console.log(`   Box existe: ${overlayStatus.boxExists}`);
    }
    
    // Aguarda antes de fechar para visualizar
    console.log('\n⏳ Aguardando 2 segundos antes de fechar...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.error('\n❌ ERRO durante o teste:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    if (browser) {
      console.log('\n🔒 Fechando navegador...');
      await browser.close();
    }
  }
  
  console.log('\n✨ Teste concluído!');
}

// Executa o teste
if (require.main === module) {
  testOverlay().catch(console.error);
}

module.exports = { testOverlay };

