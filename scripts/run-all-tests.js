#!/usr/bin/env node
/**
 * Script para executar TODOS os testes do projeto:
 * - Testes Jest do backend (engine, api, tests, qa)
 * - Testes Vitest do frontend
 * - Testes pytest do rag-service
 * - Testes RPA
 * 
 * Retorna exit code 0 se todos passarem, 1 caso contrário.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60) + '\n');
}

function runCommand(command, description, cwd = process.cwd(), allowFailure = false) {
  try {
    log(`\n▶ ${description}`, 'cyan');
    log(`   Comando: ${command}`, 'blue');
    execSync(command, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    log(`✓ ${description} - SUCESSO`, 'green');
    return { success: true };
  } catch (error) {
    if (allowFailure) {
      log(`⚠ ${description} - FALHOU (opcional)`, 'yellow');
      return { success: false, error: error.message }; // Executou mas falhou, não pulou
    }
    log(`✗ ${description} - FALHOU`, 'red');
    return { success: false, error: error.message };
  }
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const results = {
    backend: null,
    frontend: null,
    ragService: null,
    rpa: null,
  };

  logSection('🚀 EXECUTANDO TODOS OS TESTES DO PROJETO');

  // 1. Testes do Backend (Jest)
  logSection('1️⃣  TESTES DO BACKEND (Jest)');
  results.backend = runCommand(
    'npm run test:all',
    'Executando todos os testes Jest (engine, api, tests, qa)',
    rootDir
  );

  // 2. Testes do Frontend (Vitest)
  logSection('2️⃣  TESTES DO FRONTEND (Vitest)');
  const frontendDir = path.join(rootDir, 'frontend');
  if (fs.existsSync(frontendDir)) {
    // Verifica se vitest está instalado
    const frontendPackageJson = path.join(frontendDir, 'package.json');
    if (fs.existsSync(frontendPackageJson)) {
      results.frontend = runCommand(
        'npm test -- --run',
        'Executando testes do frontend (Vitest)',
        frontendDir
      );
    } else {
      log('⚠ Frontend package.json não encontrado, pulando testes do frontend', 'yellow');
      results.frontend = { success: true, skipped: true };
    }
  } else {
    log('⚠ Diretório frontend não encontrado, pulando testes do frontend', 'yellow');
    results.frontend = { success: true, skipped: true };
  }

  // 3. Testes do RAG Service - Aprendizado Adaptativo
  logSection('3️⃣  TESTES DO RAG-SERVICE - APRENDIZADO ADAPTATIVO');
  results.ragService = runCommand(
    'node scripts/test-rag-adaptive-learning.js',
    'Executando testes de aprendizado adaptativo do RAG',
    rootDir,
    true  // Permite falha (serviço pode não estar rodando)
  );

  // 4. Testes do RAG Service (pytest)
  logSection('4️⃣  TESTES DO RAG-SERVICE (pytest)');
  const ragServiceDir = path.join(rootDir, 'rag-service');
  if (fs.existsSync(ragServiceDir)) {
    // Verifica se há ambiente virtual
    const venvPath = path.join(ragServiceDir, 'venv');
    const pytestCmd = fs.existsSync(venvPath) 
      ? path.join(venvPath, 'bin', 'pytest')
      : 'python3 -m pytest';
    
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      // Tenta executar os testes, mas trata como opcional se falhar
      results.ragService = runCommand(
        pytestCmd,
        'Executando testes do rag-service (pytest)',
        ragServiceDir,
        true // allowFailure = true (opcional)
      );
      if (!results.ragService.success) {
        // Verifica se foi erro de dependências ou se os testes rodaram mas falharam
        if (results.ragService.error && results.ragService.error.includes("ModuleNotFoundError")) {
          log('   Nota: Dependências do RAG Service não instaladas.', 'yellow');
          log('   Para instalar: cd rag-service && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt', 'yellow');
        }
      }
    } catch (error) {
      log('⚠ Python3 não encontrado, pulando testes do rag-service', 'yellow');
      results.ragService = { success: true, skipped: true };
    }
  } else {
    log('⚠ Diretório rag-service não encontrado, pulando testes do rag-service', 'yellow');
    results.ragService = { success: true, skipped: true };
  }

  // 5. Testes RPA
  logSection('5️⃣  TESTES RPA');
  results.rpa = runCommand(
    'PIPELINE_BYPASS=1 npm run test:rpa',
    'Executando testes RPA',
    rootDir
  );

  // Resumo final
  logSection('📊 RESUMO FINAL');

  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  Object.entries(results).forEach(([name, result]) => {
    summary.total++;
    if (result.skipped) {
      summary.skipped++;
      log(`⏭  ${name.toUpperCase()}: PULADO`, 'yellow');
    } else if (result.success) {
      summary.passed++;
      log(`✓ ${name.toUpperCase()}: PASSOU`, 'green');
    } else {
      summary.failed++;
      log(`✗ ${name.toUpperCase()}: FALHOU`, 'red');
    }
  });

  console.log('\n' + '='.repeat(60));
  log(`Total: ${summary.total}`, 'bright');
  log(`Passou: ${summary.passed}`, 'green');
  log(`Falhou: ${summary.failed}`, summary.failed > 0 ? 'red' : 'reset');
  log(`Pulado: ${summary.skipped}`, summary.skipped > 0 ? 'yellow' : 'reset');
  console.log('='.repeat(60) + '\n');

  if (summary.failed > 0) {
    log('❌ ALGUNS TESTES FALHARAM', 'red');
    process.exit(1);
  } else {
    log('✅ TODOS OS TESTES PASSARAM!', 'green');
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((error) => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = { main };

