#!/usr/bin/env node

/**
 * Script para testar validação CDR de respostas
 * 
 * Uso:
 *   node scripts/test-cdr-validation.js
 */

const { 
  validateResponse, 
  checkProhibitedPhrases,
  generateDenialMessage
} = require('../engine/utils/capabilityValidator');

console.log('\n🧪 Teste de Validação CDR\n');
console.log('='.repeat(70));

// Teste 1: Resposta válida
console.log('\n✅ Teste 1: Resposta Válida');
console.log('-'.repeat(70));
const validResponse = "Posso ajudar consultando informações disponíveis ou explicando como o processo funciona.";
const result1 = validateResponse(validResponse, 'ai_response');
console.log('Resposta:', validResponse);
console.log('Resultado:');
console.log('  Válida:', result1.valid ? '✅ SIM' : '❌ NÃO');
console.log('  Erros:', result1.errors.length);
console.log('  Warnings:', result1.warnings.length);
if (result1.errors.length > 0) {
  result1.errors.forEach(err => console.log('    -', err));
}

// Teste 2: Resposta com frase proibida
console.log('\n❌ Teste 2: Resposta com Frase Proibida');
console.log('-'.repeat(70));
const invalidResponse = "Já estou resolvendo isso para você. Em breve você receberá uma resposta.";
const result2 = validateResponse(invalidResponse, 'ai_response');
console.log('Resposta:', invalidResponse);
console.log('Resultado:');
console.log('  Válida:', result2.valid ? '✅ SIM' : '❌ NÃO');
console.log('  Erros:', result2.errors.length);
if (result2.errors.length > 0) {
  result2.errors.forEach(err => console.log('    -', err));
}

// Teste 3: Detecção de frases proibidas
console.log('\n🔍 Teste 3: Detecção de Frases Proibidas');
console.log('-'.repeat(70));
const testPhrases = [
  "Já estou resolvendo",
  "Em breve isso será feito",
  "Estamos analisando sua solicitação",
  "Vou pedir para alguém verificar",
  "Isso será feito em breve"
];

testPhrases.forEach(phrase => {
  const check = checkProhibitedPhrases(phrase);
  console.log(`\nFrase: "${phrase}"`);
  console.log('  Tem frase proibida:', check.hasProhibited ? '❌ SIM' : '✅ NÃO');
  if (check.hasProhibited) {
    console.log('  Frases encontradas:', check.phrases.join(', '));
  }
});

// Teste 4: Mensagem de negação
console.log('\n💬 Teste 4: Geração de Mensagem de Negação');
console.log('-'.repeat(70));
const denial1 = generateDenialMessage('criar_ticket_externo');
console.log('Ação negada: criar_ticket_externo');
console.log('Mensagem gerada:');
console.log(`  "${denial1}"`);

const denial2 = generateDenialMessage('consultar_banco_externo', [
  'Posso consultar informações na base de conhecimento.',
  'Posso explicar como funciona o processo.'
]);
console.log('\nAção negada: consultar_banco_externo (com alternativas)');
console.log('Mensagem gerada:');
console.log(`  "${denial2}"`);

// Teste 5: Resposta que promete ação não implementada
console.log('\n⚠️  Teste 5: Resposta que Promete Ação Não Implementada');
console.log('-'.repeat(70));
const promiseResponse = "Vou criar um ticket no sistema externo e você receberá um email de confirmação.";
const result3 = validateResponse(promiseResponse, 'ai_response');
console.log('Resposta:', promiseResponse);
console.log('Resultado:');
console.log('  Válida:', result3.valid ? '✅ SIM' : '❌ NÃO');
console.log('  Erros:', result3.errors.length);
console.log('  Warnings:', result3.warnings.length);
if (result3.errors.length > 0) {
  result3.errors.forEach(err => console.log('    -', err));
}
if (result3.warnings.length > 0) {
  result3.warnings.forEach(warn => console.log('    ⚠️ ', warn));
}

// Teste 6: Resposta correta com negação
console.log('\n✅ Teste 6: Resposta Correta com Negação');
console.log('-'.repeat(70));
const correctDenial = "No momento, eu não tenho a capacidade de executar essa ação. Posso ajudar consultando informações disponíveis ou explicando como o processo funciona.";
const result4 = validateResponse(correctDenial, 'ai_response');
console.log('Resposta:', correctDenial);
console.log('Resultado:');
console.log('  Válida:', result4.valid ? '✅ SIM' : '❌ NÃO');
console.log('  Erros:', result4.errors.length);
console.log('  Warnings:', result4.warnings.length);

console.log('\n' + '='.repeat(70));
console.log('\n📊 Resumo dos Testes\n');

const tests = [
  { name: 'Resposta Válida', result: result1.valid },
  { name: 'Resposta com Frase Proibida', result: !result2.valid },
  { name: 'Resposta que Promete Ação', result: !result3.valid },
  { name: 'Resposta Correta com Negação', result: result4.valid }
];

tests.forEach(test => {
  console.log(`  ${test.result ? '✅' : '❌'} ${test.name}`);
});

console.log('\n');

