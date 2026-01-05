/**
 * Script para Gravar Ações de Seed da Plataforma
 * 
 * Use este script para gravar ações de criação de dados na plataforma
 * Execute: node tests/rpa/seedPlatformGravar.js
 */

const { ActionRecorder } = require('./actionRecorder');
const config = require('./rpaConfig');

console.log('📹 Gravador de Seed da Plataforma\n');
console.log('='.repeat(70));
console.log('Este script ajuda você a gravar ações para popular a plataforma');
console.log('='.repeat(70));
console.log('\n💡 Instruções:');
console.log('   1. Execute este script');
console.log('   2. Execute as ações manualmente no navegador');
console.log('   3. Use os métodos do recorder para registrar ações');
console.log('   4. Salve a gravação\n');

// Exemplo de como gravar
const recorder = new ActionRecorder();

console.log('📝 Exemplo de gravação:\n');

recorder.start({
  name: 'seed-platform-exemplo',
  url: config.urls.frontend,
});

// Exemplo: Login
console.log('1. Gravar login:');
console.log('   recorder.recordNavigate("http://localhost:5173/login");');
console.log('   recorder.recordFill("input[type=\'email\']", "admin@example.com");');
console.log('   recorder.recordFill("input[type=\'password\']", "admin123");');
console.log('   recorder.recordClick("button[type=\'submit\']");\n');

recorder.recordNavigate(`${config.urls.frontend}/login`);
recorder.recordFill('input[type="email"]', 'admin@example.com');
recorder.recordFill('input[type="password"]', 'admin123');
recorder.recordClick('button[type="submit"]', { waitFor: '.dashboard' });

// Exemplo: Criar Fluxo
console.log('2. Gravar criação de fluxo:');
console.log('   recorder.recordNavigate("http://localhost:5173/flows");');
console.log('   recorder.recordClick("button:has-text(\'Novo Fluxo\')");');
console.log('   recorder.recordFill("input[name=\'flowName\']", "Meu Fluxo");');
console.log('   recorder.recordClick("button:has-text(\'Criar\')");\n');

recorder.recordNavigate(`${config.urls.frontend}/flows`);
recorder.recordClick('button:has-text("Novo Fluxo")');
recorder.recordFill('input[name="flowName"]', 'Meu Fluxo');
recorder.recordClick('button:has-text("Criar")', { waitFor: '.flow-canvas' });

recorder.stop();

// Salva exemplo
const filepath = recorder.save('seed-platform-exemplo', {
  admin: {
    email: 'admin@example.com',
    password: 'admin123',
  },
});

console.log(`✅ Gravação de exemplo salva em: ${filepath}\n`);

console.log('📚 Próximos passos:');
console.log('   1. Edite a gravação salva para suas necessidades');
console.log('   2. Use seedPlatformRPA.js para executar as gravações');
console.log('   3. Veja exemplos em tests/rpa/seeds/seed-platform-*.json\n');

