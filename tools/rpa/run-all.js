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
const RPA_CONFIG_PATH = path.join(__dirname, '..', '..', 'tests', 'rpa', 'rpa.config.json');

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

function resolveFrontendUrl() {
  if (process.env.RPA_FRONTEND_URL) return String(process.env.RPA_FRONTEND_URL);
  try {
    const configRaw = fs.readFileSync(RPA_CONFIG_PATH, 'utf8');
    const config = JSON.parse(configRaw);
    const url = config && config.urls && config.urls.frontend ? String(config.urls.frontend) : '';
    if (url) return url;
  } catch (_) {}
  return 'http://localhost:5173';
}

function resolveApiUrl() {
  if (process.env.RPA_API_URL) return String(process.env.RPA_API_URL);
  if (process.env.TEST_API_URL) return String(process.env.TEST_API_URL);
  try {
    const configRaw = fs.readFileSync(RPA_CONFIG_PATH, 'utf8');
    const config = JSON.parse(configRaw);
    const url = config && config.urls && config.urls.api ? String(config.urls.api) : '';
    if (url) return url;
  } catch (_) {}
  return 'http://localhost:3000';
}

async function isFrontendReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res && res.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function isApiReachable(baseUrl) {
  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');
  const probes = [`${normalizedBase}/health/ready`, `${normalizedBase}/health`];
  for (const url of probes) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res && res.ok) return true;
    } catch (_) {
      // tenta próximo endpoint
    } finally {
      clearTimeout(timeout);
    }
  }
  return false;
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
      const timeoutMsRaw = process.env.RPA_TEST_TIMEOUT_MS;
      const timeoutMs = Number.isFinite(Number(timeoutMsRaw))
        ? Math.max(10000, Math.floor(Number(timeoutMsRaw)))
        : 120000;

      // Executa o teste (playback) com timeout global por teste
      let timeoutId = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error(`RPA test timeout após ${timeoutMs}ms`);
          err.code = 'RPA_TEST_TIMEOUT';
          reject(err);
        }, timeoutMs);
        // Evita impedir o processo de encerrar
        if (timeoutId && timeoutId.unref) timeoutId.unref();
      });

      const result = await Promise.race([
        runner.playback(testData),
        timeoutPromise,
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });

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

  if (process.env.RPA_SKIP_IF_FRONTEND_UNREACHABLE === 'true') {
    const frontendUrl = resolveFrontendUrl();
    const reachable = await isFrontendReachable(frontendUrl);
    if (!reachable) {
      console.log(`⚠ Frontend indisponível (${frontendUrl}); pulando testes RPA por configuração.`);
      const report = generateReport([]);
      saveReport(report);
      return;
    }
  }

  // Pré-seed: garante flows básicos para os testes RPA (best-effort)
  try {
    const { ensureRpaFlows } = require('../../tests/rpa/ensure-rpa-flows');
    const seedResult = await ensureRpaFlows();
    console.log(`[RPA Seed] Flows criados: ${seedResult.created}, já existentes: ${seedResult.skipped}`);
  } catch (err) {
    console.warn('[RPA Seed] Aviso: não foi possível garantir flows para RPA:', err.message);
  }

  if (process.env.RPA_SKIP_IF_API_UNREACHABLE === 'true') {
    const apiUrl = resolveApiUrl();
    const reachable = await isApiReachable(apiUrl);
    if (!reachable) {
      console.log(`⚠ API indisponível (${apiUrl}); pulando testes RPA por configuração.`);
      const report = generateReport([]);
      saveReport(report);
      return;
    }
  }

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
