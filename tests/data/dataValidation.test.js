/**
 * Gate de Dados - Validação Explícita de Dados de Teste
 * 
 * Este teste implementa o GATE DE DADOS que bloqueia a execução de scripts
 * de conversa se os dados não estiverem válidos.
 * 
 * Pipeline: unit → flow → data → scripts
 * 
 * Frase-guia: "Sem dados, testamos estrutura. Com dados, testamos comportamento."
 * 
 * Este teste DEVE FALHAR se:
 * - Departments não existem ou são inválidos
 * - Queues não existem ou são inválidas
 * - Agents não existem ou são inválidos
 * - Config não existe ou é inválida
 * - Há incoerências básicas entre entidades
 */

const { validateTestData } = require('../helpers/dataValidationHelper');

describe('Gate de Dados - Validação Explícita', () => {
  test('deve validar que todos os dados necessários estão presentes e válidos', () => {
    const result = validateTestData();
    
    // Se houver erros, lista-os de forma clara
    if (result.errors.length > 0) {
      console.error('\n❌ VALIDAÇÃO DE DADOS FALHOU');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`Mensagem: ${result.message}`);
      console.error(`\nErros encontrados (${result.errors.length}):`);
      result.errors.forEach((error, index) => {
        console.error(`\n${index + 1}. [${error.validator}] ${error.message}`);
        if (error.details) {
          console.error('   Detalhes:', JSON.stringify(error.details, null, 2));
        }
      });
      
      if (result.warnings.length > 0) {
        console.error(`\n⚠️  Warnings (${result.warnings.length}):`);
        result.warnings.forEach((warning, index) => {
          console.error(`${index + 1}. [${warning.validator}] ${warning.message}`);
        });
      }
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
    
    // Este teste FALHA se houver erros
    // Isso bloqueia a execução de scripts de conversa
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  
  test('deve validar existência de departments', () => {
    const result = validateTestData();
    
    // Verifica especificamente se departments estão presentes
    const departmentsErrors = result.errors.filter(
      e => e.validator === 'departments.validator'
    );
    
    expect(departmentsErrors).toHaveLength(0);
  });
  
  test('deve validar existência de queues', () => {
    const result = validateTestData();
    
    const queuesErrors = result.errors.filter(
      e => e.validator === 'queues.validator'
    );
    
    expect(queuesErrors).toHaveLength(0);
  });
  
  test('deve validar existência de agents', () => {
    const result = validateTestData();
    
    const agentsErrors = result.errors.filter(
      e => e.validator === 'agents.validator'
    );
    
    expect(agentsErrors).toHaveLength(0);
  });
  
  test('deve validar existência de config mínima', () => {
    const result = validateTestData();
    
    const configErrors = result.errors.filter(
      e => e.validator === 'config.validator'
    );
    
    expect(configErrors).toHaveLength(0);
  });
  
  test('deve validar coerência básica entre entidades (agentes ativos)', () => {
    const result = validateTestData();
    
    // Se houver erros de integridade referencial, eles aparecerão aqui
    // Por exemplo: agentes referenciados em departments que não existem
    const integrityErrors = result.errors.filter(
      e => e.message && (
        e.message.includes('não encontrado') ||
        e.message.includes('referência') ||
        e.message.includes('inválido')
      )
    );
    
    expect(integrityErrors).toHaveLength(0);
  });
});

