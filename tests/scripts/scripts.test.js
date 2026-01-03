/**
 * Testes para scripts de conversa.
 * 
 * Estes testes executam scripts de conversa usando o simulador.
 * 
 * IMPORTANTE: Scripts só podem rodar após validação de dados (gate de dados).
 * Pipeline: unit → flow → data → scripts
 * 
 * Frase-guia: "Sem dados, testamos estrutura. Com dados, testamos comportamento."
 */

const { ConversationSimulator } = require('../engine/simulator');
const { validateTestData, validateScriptRequirements } = require('../helpers/dataValidationHelper');
const { classifyError, diagnoseError } = require('../helpers/errorClassifier');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname);

describe('Scripts de Conversa', () => {
  let simulator;
  let dataValidationResult;
  
  beforeAll(() => {
    // GATE DE DADOS: Valida dados antes de executar qualquer script
    dataValidationResult = validateTestData();
    
    if (!dataValidationResult.passed) {
      console.error('\n🚫 GATE DE DADOS: Validação falhou');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(dataValidationResult.message);
      console.error(`\nErros encontrados (${dataValidationResult.errors.length}):`);
      dataValidationResult.errors.forEach((error, index) => {
        console.error(`${index + 1}. [${error.validator}] ${error.message}`);
      });
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.error('❌ Scripts de conversa NÃO serão executados devido a falha na validação de dados.');
      console.error('   Execute: npm run seed:test\n');
    }
    
    simulator = new ConversationSimulator();
    simulator.loadFlows();
  });
  
  afterEach(() => {
    simulator.reset();
  });
  
  // Carrega todos os scripts
  const scriptFiles = fs.readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('script-'));
  
  for (const scriptFile of scriptFiles) {
    const scriptPath = path.join(SCRIPTS_DIR, scriptFile);
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    
    test(`deve executar script ${script.id} corretamente`, async () => {
      // GATE DE DADOS: Verifica se validação passou
      if (!dataValidationResult.passed) {
        throw new Error(
          `Script ${script.id} não pode ser executado: validação de dados falhou. ` +
          `Execute 'npm run seed:test' e corrija os erros antes de executar scripts.`
        );
      }
      
      // Valida dependências específicas do script
      const requirementsCheck = validateScriptRequirements(script);
      if (!requirementsCheck.valid) {
        throw new Error(
          `Script ${script.id} não pode ser executado: dependências faltando. ` +
          `Faltando: ${requirementsCheck.missing.join(', ')}`
        );
      }
      
      let result;
      try {
        result = await simulator.executeScript(script);
      } catch (error) {
        // Classifica e diagnostica erro
        const diagnosis = diagnoseError(error);
        console.error('\n❌ Erro ao executar script:', script.id);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`Categoria: ${diagnosis.category}`);
        console.error(`Código: ${diagnosis.code}`);
        console.error(`Mensagem: ${diagnosis.message}`);
        if (diagnosis.nodeId) {
          console.error(`Nó: ${diagnosis.nodeId} (${diagnosis.nodeType || 'unknown'})`);
        }
        if (diagnosis.details) {
          console.error('Detalhes:', JSON.stringify(diagnosis.details, null, 2));
        }
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        throw error;
      }
      
      if (!result.passed) {
        console.log('Script falhou:', script.id);
        console.log('Resultados:', JSON.stringify(result.results, null, 2));
        console.log('Estado final:', JSON.stringify(result.finalState, null, 2));
        
        // Classifica erros nos resultados
        const errors = [];
        for (const stepResult of result.results || []) {
          if (!stepResult.passed && stepResult.comparison && stepResult.comparison.issues) {
            for (const issue of stepResult.comparison.issues) {
              errors.push({
                code: 'SCRIPT_STEP_MISMATCH',
                message: `Step ${stepResult.step}: ${issue.field} esperado "${issue.expected}" mas recebeu "${issue.actual}"`,
                step: stepResult.step,
                details: issue,
              });
            }
          }
        }
        
        if (errors.length > 0) {
          console.error('\n📊 Diagnóstico de Erros:');
          for (const error of errors) {
            const diagnosis = diagnoseError(error);
            console.error(`  [${diagnosis.category}] ${diagnosis.message}`);
          }
        }
      }
      
      expect(result.passed).toBe(true);
      expect(result.finalState.valid).toBe(true);
    });
  }
});

