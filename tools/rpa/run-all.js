#!/usr/bin/env node
/**
 * Script para executar todos os testes RPA e gerar relatório.
 * 
 * Integrado ao pipeline de CI/CD.
 * Retorna exit code ≠ 0 em caso de falha.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Diretórios de testes RPA (seeds e flows)
const RPA_SEEDS_DIR = path.join(__dirname, '..', '..', 'tests', 'rpa', 'seeds');
const RPA_FLOWS_DIR = path.join(__dirname, '..', '..', 'tests', 'rpa', 'flows');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'tests', 'rpa', 'reports');

// Garante que os diretórios existem
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}
if (!fs.existsSync(RPA_FLOWS_DIR)) {
  fs.mkdirSync(RPA_FLOWS_DIR, { recursive: true });
}

/**
 * Encontra todos os arquivos de teste RPA.
 * Procura em /seeds (formato antigo) e /flows (formato novo).
 * 
 * @returns {Array<string>} Lista de caminhos de arquivos de teste
 */
function findRpaTestFiles() {
  const testFiles = [];

  // Procura em /seeds (formato de gravação)
  if (fs.existsSync(RPA_SEEDS_DIR)) {
    const seedFiles = fs.readdirSync(RPA_SEEDS_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(RPA_SEEDS_DIR, file));
    testFiles.push(...seedFiles);
  }

  // Procura em /flows (formato de teste gerado)
  if (fs.existsSync(RPA_FLOWS_DIR)) {
    const flowFiles = fs.readdirSync(RPA_FLOWS_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(RPA_FLOWS_DIR, file));
    testFiles.push(...flowFiles);
  }

  return testFiles;
}

/**
 * Executa um teste RPA usando o RpaTestRunner.
 * 
 * @param {string} testFile - Caminho do arquivo de teste
 * @returns {Promise<{success: boolean, output: string, error?: string, testName: string}>}
 */
async function runRpaTest(testFile) {
  const testName = path.basename(testFile, '.json');
  console.log(`Executando teste RPA: ${testName}`);
  
  try {
    // Carrega o arquivo de teste
    const testData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    
    // Importa o RpaTestRunner
    const { RpaTestRunner } = require(path.join(__dirname, '..', '..', 'tests', 'rpa', 'rpaTestRunner'));
    
    // Cria runner em modo CI (headless, rápido)
    const runner = new RpaTestRunner({
      headless: true,
      slowMo: 0,
      enableReplay: true,
    });
    
    await runner.init();
    
    try {
      // Executa o teste (playback)
      const result = await runner.playback(testData);

      // Sempre gera relatório detalhado do runner (inclui details + steps + debug)
      const detailedReport = runner.generateReport();
      const detailedReportPath = path.join(
        REPORTS_DIR,
        `rpa-detail-${testName}-${Date.now()}.json`
      );
      fs.writeFileSync(detailedReportPath, JSON.stringify(detailedReport, null, 2), 'utf8');

      await runner.close();

      // Tenta extrair um resumo da falha (primeiro erro/step)
      const firstFailedStep = Array.isArray(result.steps)
        ? result.steps.find((s) => s && s.success === false)
        : null;
      const failedStepSummary = firstFailedStep
        ? {
            step: firstFailedStep.step,
            action: firstFailedStep.action,
            selector: firstFailedStep.selector,
            diagnosticsKind: firstFailedStep.debug?.diagnostics?.kind || null,
            selectorsTried: firstFailedStep.debug?.diagnostics?.selectorsTried || null,
          }
        : null;

      if (result.success) {
        return {
          success: true,
          output: `Teste passou: ${result.steps.length} passos executados`,
          testName,
          reportPath: detailedReportPath,
          replayPath: result.replayPath || null,
        };
      }

      const errorMessage = result.message || result.error || 'Falha na execução';
      return {
        success: false,
        output: `Teste falhou: ${errorMessage}`,
        error: errorMessage,
        testName,
        reportPath: detailedReportPath,
        replayPath: result.replayPath || null,
        failedStep: failedStepSummary,
      };
    } catch (execError) {
      await runner.close();
      throw execError;
    }
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout || error.message || '', 
      error: error.message,
      testName
    };
  }
}

/**
 * Gera relatório de execução.
 * 
 * @param {Array} results - Resultados dos testes
 * @returns {Object} Relatório estruturado
 */
function generateReport(results) {
  const timestamp = new Date().toISOString();
  const total = results.length;
  const passed = results.filter(r => r.success).length;
  const failed = total - passed;

  const report = {
    timestamp,
    summary: {
      total,
      passed,
      failed,
      success: failed === 0,
    },
    tests: results.map(r => ({
      name: r.testName,
      success: r.success,
      error: r.error || null,
      reportPath: r.reportPath || null,
      replayPath: r.replayPath || null,
      failedStep: r.failedStep || null,
    })),
  };

  return report;
}

/**
 * Salva relatório em arquivo.
 * 
 * @param {Object} report - Relatório a ser salvo
 */
function saveReport(report) {
  const timestamp = Date.now();
  const reportFile = path.join(REPORTS_DIR, `rpa-report-${timestamp}.json`);
  
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Relatório salvo em: ${reportFile}`);
  
  // Também salva um relatório "latest"
  const latestReportFile = path.join(REPORTS_DIR, 'rpa-report-latest.json');
  fs.writeFileSync(latestReportFile, JSON.stringify(report, null, 2), 'utf8');
}

/**
 * Função principal.
 */
async function main() {
  console.log('=== Executando Testes RPA ===\n');

  const testFiles = findRpaTestFiles();
  
  if (testFiles.length === 0) {
    console.log('Nenhum teste RPA encontrado.');
    console.log(`Procurando em: ${RPA_SEEDS_DIR} e ${RPA_FLOWS_DIR}`);
    const report = generateReport([]);
    saveReport(report);
    process.exit(0);
  }

  console.log(`Encontrados ${testFiles.length} teste(s) RPA.\n`);

  // Executa testes sequencialmente (async)
  const results = [];
  for (const testFile of testFiles) {
    const result = await runRpaTest(testFile);
    results.push(result);
    
    const status = result.success ? '✓ PASSOU' : '✗ FALHOU';
    console.log(`${status}: ${result.testName}`);
    if (!result.success && result.error) {
      console.log(`  Erro: ${result.error}`);
    }
  }

  console.log('\n=== Resultados ===\n');
  results.forEach(result => {
    const status = result.success ? '✓ PASSOU' : '✗ FALHOU';
    console.log(`${status}: ${result.testName}`);
    if (!result.success && result.error) {
      console.log(`  Erro: ${result.error}`);
    }
  });

  const report = generateReport(results);
  saveReport(report);

  console.log('\n=== Resumo ===');
  console.log(`Total: ${report.summary.total}`);
  console.log(`Passou: ${report.summary.passed}`);
  console.log(`Falhou: ${report.summary.failed}`);
  console.log(`Status: ${report.summary.success ? 'SUCESSO' : 'FALHA'}`);

  // Retorna exit code baseado no resultado
  process.exit(report.summary.success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { findRpaTestFiles, runRpaTest, generateReport, saveReport };

