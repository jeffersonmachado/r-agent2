/**
 * Visualizador de Gravações RPA
 * 
 * Mostra todas as gravações disponíveis de forma organizada
 * Execute: node tests/rpa/visualizar-gravacoes.js
 */

const { ActionRecorder } = require('./actionRecorder');
const fs = require('fs');
const path = require('path');

console.log('📁 Gravações RPA Disponíveis\n');
console.log('='.repeat(70));

const gravações = ActionRecorder.list();

if (gravações.length === 0) {
  console.log('\n❌ Nenhuma gravação encontrada.\n');
  process.exit(0);
}

console.log(`\n✅ Total: ${gravações.length} gravação(ões)\n`);

gravações.forEach((nome, index) => {
  try {
    const gravação = ActionRecorder.load(nome);
    
    console.log(`${'─'.repeat(70)}`);
    console.log(`\n📹 ${index + 1}. ${gravação.name}`);
    console.log(`   ID: ${gravação.id}`);
    console.log(`   Versão: ${gravação.version}`);
    console.log(`   Criada em: ${new Date(gravação.createdAt).toLocaleString('pt-BR')}`);
    console.log(`   URL base: ${gravação.url || 'N/A'}`);
    console.log(`   Total de steps: ${gravação.steps.length}`);
    
    // Resumo dos steps
    console.log(`\n   📝 Steps:`);
    gravação.steps.forEach((step, stepIndex) => {
      const icon = {
        navigate: '🌐',
        click: '🖱️',
        fill: '✏️',
        select: '📋',
        wait: '⏳',
        assert: '✅',
      }[step.type] || '⚙️';
      
      let descrição = `${icon} ${step.type.toUpperCase()}`;
      
      if (step.url) descrição += ` → ${step.url}`;
      if (step.selector) descrição += ` → ${step.selector}`;
      if (step.value) descrição += ` → "${step.value.substring(0, 30)}${step.value.length > 30 ? '...' : ''}"`;
      if (step.condition && typeof step.condition === 'number') descrição += ` → ${step.condition}ms`;
      
      console.log(`      ${stepIndex + 1}. ${descrição}`);
    });
    
    // Dados disponíveis
    if (gravação.data && Object.keys(gravação.data).length > 0) {
      console.log(`\n   💾 Dados disponíveis:`);
      Object.keys(gravação.data).forEach(key => {
        const value = gravação.data[key];
        if (typeof value === 'object') {
          console.log(`      - ${key}:`);
          Object.entries(value).forEach(([k, v]) => {
            console.log(`        • ${k}: ${v}`);
          });
        } else {
          console.log(`      - ${key}: ${value}`);
        }
      });
    }
    
    // Estatísticas
    const tiposAcoes = {};
    gravação.steps.forEach(step => {
      tiposAcoes[step.type] = (tiposAcoes[step.type] || 0) + 1;
    });
    
    console.log(`\n   📊 Estatísticas:`);
    Object.entries(tiposAcoes).forEach(([tipo, count]) => {
      console.log(`      - ${tipo}: ${count}`);
    });
    
    // Tamanho do arquivo
    const filepath = path.join(__dirname, 'recordings', `${nome}.json`);
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      console.log(`      - Tamanho: ${sizeKB} KB`);
    }
    
  } catch (error) {
    console.log(`\n❌ Erro ao carregar ${nome}: ${error.message}`);
  }
});

console.log(`\n${'─'.repeat(70)}`);
console.log('\n✨ Visualização concluída!\n');
console.log('💡 Para executar uma gravação:');
console.log('   const { RpaTestRunner } = require("./rpaTestRunner");');
console.log('   const runner = new RpaTestRunner();');
console.log('   await runner.init();');
console.log('   await runner.playback("nome-da-gravacao");');
console.log('   await runner.close();\n');

