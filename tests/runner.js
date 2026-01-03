/**
 * Runner de testes em camadas.
 * 
 * Orquestra execução sequencial de:
 * 1. Testes unitários
 * 2. Validação estrutural de fluxos
 * 3. Validação de dados do sistema
 * 4. Scripts de conversa
 * 5. Testes RPA E2E (caixa-preta)
 * 
 * Pipeline obrigatório: unit → flow → data → scripts → rpa
 * 
 * IMPORTANTE:
 * - RPA é SEMPRE a última etapa
 * - RPA nunca influencia validação do core
 * - RPA testa o sistema como caixa-preta (UI + integrações)
 * - RPA pode falhar o pipeline
 * 
 * Bloqueia execução de etapas seguintes em caso de falha.
 */

const { execSync } = require('child_process');
const { validateSystem } = require('./data/validators/system.validator');
const { testDataExists } = require('./helpers/testHelpers');
const path = require('path');

class TestRunner {
  constructor() {
    this.results = {
      unit: null,
      flow: null,
      data: null,
      scripts: null,
      rpa: null
    };
    this.errors = [];
  }
  
  /**
   * Executa Jest em um diretório específico.
   * 
   * @param {string} testPath - Caminho dos testes
   * @param {string} stageName - Nome da etapa
   * @returns {object} Resultado da execução
   */
  runJestTests(testPath, stageName) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 Executando: ${stageName}`);
    console.log(`${'='.repeat(60)}\n`);
    
    try {
      // Usa Jest do projeto raiz
      const command = `npx jest ${testPath} --no-coverage`;
      const output = execSync(command, {
        encoding: 'utf8',
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      
      return {
        success: true,
        output
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr
      };
    }
  }
  
  /**
   * Executa etapa 1: Testes unitários.
   * 
   * @returns {boolean} Se etapa passou
   */
  runUnitTests() {
    const result = this.runJestTests('tests/unit', 'Testes Unitários');
    this.results.unit = result;
    
    if (!result.success) {
      this.errors.push({
        stage: 'unit',
        message: 'Testes unitários falharam',
        error: result.error
      });
      return false;
    }
    
    return true;
  }
  
  /**
   * Executa etapa 2: Validação estrutural de fluxos.
   * 
   * @returns {boolean} Se etapa passou
   */
  runFlowValidation() {
    const result = this.runJestTests('tests/flow', 'Validação Estrutural de Fluxos');
    this.results.flow = result;
    
    if (!result.success) {
      this.errors.push({
        stage: 'flow',
        message: 'Validação estrutural de fluxos falhou',
        error: result.error
      });
      return false;
    }
    
    return true;
  }
  
  /**
   * Executa etapa 3: Validação de dados do sistema.
   * 
   * @returns {boolean} Se etapa passou
   */
  runDataValidation() {
    // Verifica se dados de teste existem
    if (!testDataExists()) {
      console.error('\n❌ Dados de teste não encontrados!');
      console.error('Execute: npm run seed:test\n');
      this.errors.push({
        stage: 'data',
        message: 'Dados de teste não encontrados. Execute npm run seed:test primeiro.'
      });
      return false;
    }
    
    // Valida dados
    const validationResult = validateSystem();
    
    if (validationResult.errors.length > 0) {
      console.error('\n❌ Validação de dados falhou!');
      console.error('Erros encontrados:');
      for (const error of validationResult.errors) {
        console.error(`  - ${error.message}`);
        if (error.details) {
          console.error(`    Detalhes:`, error.details);
        }
      }
      console.error('\n');
      
      this.errors.push({
        stage: 'data',
        message: 'Validação de dados falhou',
        errors: validationResult.errors
      });
      return false;
    }
    
    if (validationResult.warnings.length > 0) {
      console.warn('\n⚠️  Avisos na validação de dados:');
      for (const warning of validationResult.warnings) {
        console.warn(`  - ${warning.message}`);
      }
      console.warn('');
    }
    
    this.results.data = {
      success: true,
      warnings: validationResult.warnings
    };
    
    return true;
  }
  
  /**
   * Executa etapa 4: Scripts de conversa.
   * 
   * @returns {boolean} Se etapa passou
   */
  runScripts() {
    const result = this.runJestTests('tests/scripts', 'Scripts de Conversa');
    this.results.scripts = result;
    
    if (!result.success) {
      this.errors.push({
        stage: 'scripts',
        message: 'Scripts de conversa falharam',
        error: result.error
      });
      return false;
    }
    
    return true;
  }
  
  /**
   * Executa etapa 5: Testes RPA E2E (caixa-preta).
   * 
   * IMPORTANTE:
   * - RPA executa SOMENTE se todas as etapas anteriores passarem
   * - RPA testa o sistema como CAIXA-PRETA (UI / endpoints públicos)
   * - RPA não acessa engine nem flow internamente
   * - RPA pode falhar o pipeline
   * - Replay é SEMPRE gerado em tests/rpa/replay/
   * 
   * @returns {boolean} Se etapa passou
   */
  async runRpaTests() {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 Executando: Testes RPA E2E (Caixa-Preta)');
    console.log('='.repeat(60) + '\n');
    
    try {
      // Importa runner RPA dinamicamente (pode não estar disponível em todos os ambientes)
      const { RpaTestRunner } = require('./rpa/rpaTestRunner');
      
      const rpaRunner = new RpaTestRunner({
        headless: true,
        enableReplay: true, // Replay obrigatório
      });
      
      await rpaRunner.init();
      
      // Executa testes RPA (pode ser configurado via arquivos de cenário)
      // Por enquanto, executa testes básicos se disponíveis
      const recordingsDir = require('path').join(__dirname, 'rpa', 'recordings');
      const fs = require('fs');
      
      if (!fs.existsSync(recordingsDir)) {
        console.log('⚠️  Diretório de gravações RPA não encontrado. Pulando testes RPA.');
        this.results.rpa = {
          success: true,
          skipped: true,
          message: 'Diretório de gravações RPA não encontrado'
        };
        await rpaRunner.close();
        return true;
      }
      
      const recordings = fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
      
      if (recordings.length === 0) {
        console.log('⚠️  Nenhuma gravação RPA encontrada. Pulando testes RPA.');
        this.results.rpa = {
          success: true,
          skipped: true,
          message: 'Nenhuma gravação RPA encontrada'
        };
        await rpaRunner.close();
        return true;
      }
      
      console.log(`📋 Encontradas ${recordings.length} gravação(ões) RPA\n`);
      
      let allPassed = true;
      const rpaResults = [];
      
      for (const recording of recordings) {
        console.log(`▶️  Executando: ${recording}...`);
        try {
          const result = await rpaRunner.playback(recording);
          rpaResults.push({
            recording,
            success: result.success,
            replayId: result.replayId,
            replayPath: result.replayPath,
          });
          
          if (!result.success) {
            allPassed = false;
            console.error(`❌ Falha em: ${recording}`);
            if (result.error) {
              console.error(`   Erro: ${result.error}`);
            }
          } else {
            console.log(`✅ Passou: ${recording}`);
            if (result.replayId) {
              console.log(`   Replay salvo: ${result.replayId}`);
            }
          }
        } catch (error) {
          allPassed = false;
          console.error(`❌ Erro ao executar ${recording}:`, error.message);
          rpaResults.push({
            recording,
            success: false,
            error: error.message,
          });
        }
      }
      
      await rpaRunner.close();
      
      this.results.rpa = {
        success: allPassed,
        skipped: false,
        results: rpaResults,
        message: allPassed 
          ? `Todos os testes RPA passaram (${recordings.length} gravação(ões))`
          : `Alguns testes RPA falharam (${rpaResults.filter(r => !r.success).length}/${recordings.length})`
      };
      
      if (!allPassed) {
        this.errors.push({
          stage: 'rpa',
          message: 'Testes RPA E2E falharam',
          results: rpaResults.filter(r => !r.success),
        });
        return false;
      }
      
      return true;
    } catch (error) {
      // Se RPA não estiver disponível (ex: Playwright não instalado), permite continuar
      if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('Cannot find module')) {
        console.log('⚠️  Módulos RPA não encontrados. Pulando testes RPA.');
        console.log('   Para habilitar RPA, instale: npm install playwright\n');
        this.results.rpa = {
          success: true,
          skipped: true,
          message: 'Módulos RPA não encontrados'
        };
        return true;
      }
      
      // Outros erros são tratados como falha
      console.error('❌ Erro ao executar testes RPA:', error.message);
      this.errors.push({
        stage: 'rpa',
        message: 'Erro ao executar testes RPA',
        error: error.message,
      });
      this.results.rpa = {
        success: false,
        skipped: false,
        error: error.message,
      };
      return false;
    }
  }
  
  /**
   * Executa pipeline completo.
   * 
   * @returns {boolean} Se pipeline completo passou
   */
  async run() {
    console.log('\n🚀 Iniciando pipeline de testes em camadas...\n');
    console.log('📋 Ordem de execução (PIPELINE OBRIGATÓRIO):');
    console.log('  1. Testes unitários');
    console.log('  2. Validação estrutural de fluxos');
    console.log('  3. Validação de dados do sistema');
    console.log('  4. Scripts de conversa');
    console.log('  5. Testes RPA E2E (caixa-preta) - opcional\n');
    
    // Etapa 1: Testes unitários
    if (!this.runUnitTests()) {
      this.reportFailure('unit');
      return false;
    }
    
    // Etapa 2: Validação estrutural de fluxos
    if (!this.runFlowValidation()) {
      this.reportFailure('flow');
      return false;
    }
    
    // Etapa 3: Validação de dados
    if (!this.runDataValidation()) {
      this.reportFailure('data');
      return false;
    }
    
    // Etapa 4: Scripts de conversa
    if (!this.runScripts()) {
      this.reportFailure('scripts');
      return false;
    }
    
    // Etapa 5: Testes RPA E2E (obrigatório se disponível)
    // RPA só executa se todas as etapas anteriores passarem
    // RPA pode falhar o pipeline
    if (!await this.runRpaTests()) {
      this.reportFailure('rpa');
      return false;
    }
    
    // Sucesso!
    this.reportSuccess();
    return true;
  }
  
  /**
   * Reporta falha e bloqueia próximas etapas.
   * 
   * @param {string} failedStage - Etapa que falhou
   */
  reportFailure(failedStage) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ PIPELINE INTERROMPIDO');
    console.log('='.repeat(60));
    console.log(`\nEtapa que falhou: ${failedStage}`);
    console.log('\nPróximas etapas foram bloqueadas.\n');
    
    if (this.errors.length > 0) {
      console.log('Erros encontrados:');
      for (const error of this.errors) {
        console.log(`  - [${error.stage}] ${error.message}`);
      }
      console.log('');
    }
  }
  
  /**
   * Reporta sucesso completo.
   */
  reportSuccess() {
    console.log('\n' + '='.repeat(60));
    console.log('✅ PIPELINE COMPLETO - TODAS AS ETAPAS PASSARAM');
    console.log('='.repeat(60));
    console.log('\n📊 Resumo:');
    console.log('  ✅ Testes unitários: PASSOU');
    console.log('  ✅ Validação estrutural de fluxos: PASSOU');
    console.log('  ✅ Validação de dados do sistema: PASSOU');
    console.log('  ✅ Scripts de conversa: PASSOU');
    if (this.results.rpa && !this.results.rpa.skipped) {
      console.log('  ✅ Testes RPA E2E: PASSOU');
    } else {
      console.log('  ⚠️  Testes RPA E2E: Execute separadamente (npm run test:rpa)');
    }
    console.log('\n🎉 Sistema de testes funcionando corretamente!');
    console.log('\n💡 Para executar testes RPA E2E completos:');
    console.log('   npm run test:rpa\n');
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  const runner = new TestRunner();
  runner.run().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Erro fatal no runner:', error);
    process.exit(1);
  });
}

module.exports = { TestRunner };

