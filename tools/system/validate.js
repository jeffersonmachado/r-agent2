#!/usr/bin/env node
/**
 * Script Oficial de Validação do Sistema
 * 
 * Este é o ÚNICO comando oficial para validação completa do sistema.
 * Executa, nesta ordem:
 * 1. Validação de contratos
 * 2. Execução completa de QA (unit, flow, stress, rpa)
 * 
 * Se qualquer etapa falhar, o script retorna exit code 1.
 * Se tudo passar, retorna exit code 0.
 * 
 * Uso: npm run system:validate
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');

// Cores para output
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function logSection(title) {
  console.log('');
  log(`═══════════════════════════════════════════════════════════`, BLUE);
  log(`${BOLD}${title}${RESET}`, BLUE);
  log(`═══════════════════════════════════════════════════════════`, BLUE);
  console.log('');
}

function logSuccess(message) {
  log(`✓ ${message}`, GREEN);
}

function logError(message) {
  log(`✗ ${message}`, RED);
}

function logWarning(message) {
  log(`⚠ ${message}`, YELLOW);
}

/**
 * Etapa 1: Validação de Contratos
 */
function validateContracts() {
  logSection('ETAPA 1: Validação de Contratos');

  const contracts = [
    {
      name: 'Interface de Geração',
      path: path.join(ROOT_DIR, 'contracts', 'generation.interface.json'),
      required: true
    },
    {
      name: 'Contrato de QA',
      path: path.join(ROOT_DIR, 'contracts', 'qa', 'qa.contract.json'),
      required: true
    }
  ];

  let allValid = true;

  for (const contract of contracts) {
    const exists = fs.existsSync(contract.path);
    
    if (!exists) {
      logError(`${contract.name} não encontrado: ${contract.path}`);
      allValid = false;
      continue;
    }

    try {
      const content = fs.readFileSync(contract.path, 'utf8');
      const parsed = JSON.parse(content);
      
      if (!parsed || typeof parsed !== 'object') {
        logError(`${contract.name} está vazio ou inválido`);
        allValid = false;
        continue;
      }

      logSuccess(`${contract.name} encontrado e válido`);
    } catch (error) {
      logError(`${contract.name} contém JSON inválido: ${error.message}`);
      allValid = false;
    }
  }

  if (!allValid) {
    logError('Validação de contratos FALHOU');
    return false;
  }

  logSuccess('Todos os contratos estão válidos');
  return true;
}

/**
 * Etapa 2: Execução Completa de QA
 */
function executeQA() {
  logSection('ETAPA 2: Execução Completa de QA');

  const qaEnv = {
    ...process.env,
    SKIP_TENANT_SITE_INDEXING: 'true',
    RPA_SKIP_IF_FRONTEND_UNREACHABLE: 'true',
    RPA_SKIP_IF_API_UNREACHABLE: 'true',
  };

  const qaSteps = [
    {
      name: 'Testes Unitários',
      command: 'npm run test:unit',
      description: 'Executando testes unitários...'
    },
    {
      name: 'Testes Flow',
      command: 'npm run test:flow',
      description: 'Executando testes de fluxo...'
    },
    {
      name: 'Testes Stress',
      command: 'npm run test:stress',
      description: 'Executando testes de stress...'
    },
    {
      name: 'Seed RPA',
      command: 'node scripts/seed-rpa-flows.js',
      description: 'Preparando flows mínimos para testes RPA...'
    },
    {
      name: 'Testes RPA',
      command: 'npm run test:rpa',
      description: 'Executando testes RPA...'
    }
  ];

  if (process.env.BUSINESS_QA_VALIDATE === '1') {
    qaSteps.push({
      name: 'Business QA PR',
      command: 'npm run test:business-qa:pr',
      description: 'Executando Business QA nivel PR...'
    });
  } else {
    logWarning('Business QA PR não habilitado em system:validate (defina BUSINESS_QA_VALIDATE=1 para incluir).');
  }

  let allPassed = true;

  for (const step of qaSteps) {
    log(step.description);
    
    try {
      execSync(step.command, {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        encoding: 'utf8',
        env: qaEnv,
      });
      
      logSuccess(`${step.name} passou`);
    } catch (error) {
      logError(`${step.name} FALHOU`);
      allPassed = false;
      // Continua executando os próximos testes para diagnóstico completo
    }
  }

  if (!allPassed) {
    logError('Execução de QA FALHOU - uma ou mais etapas falharam');
    return false;
  }

  logSuccess('Todos os testes de QA passaram');
  return true;
}

/**
 * Função principal
 */
function main() {
  log('');
  log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}`, BLUE);
  log(`${BOLD}  VALIDAÇÃO OFICIAL DO SISTEMA${RESET}`, BLUE);
  log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}`, BLUE);
  log('');

  // Etapa 1: Validação de Contratos
  const contractsValid = validateContracts();
  if (!contractsValid) {
    log('');
    logError('VALIDAÇÃO DO SISTEMA FALHOU na etapa de contratos');
    process.exit(1);
  }

  // Etapa 2: Execução Completa de QA
  const qaPassed = executeQA();
  if (!qaPassed) {
    log('');
    logError('VALIDAÇÃO DO SISTEMA FALHOU na etapa de QA');
    process.exit(1);
  }

  // Sucesso total
  log('');
  logSection('RESULTADO FINAL');
  logSuccess('VALIDAÇÃO DO SISTEMA COMPLETA - TUDO PASSOU');
  log('');
  log('O sistema está conforme e pronto para uso.');
  log('');

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { validateContracts, executeQA };
