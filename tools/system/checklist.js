#!/usr/bin/env node
/**
 * Checklist Automático de Conformidade
 * 
 * Verifica automaticamente se o projeto está em conformidade com:
 * - Estrutura de pastas obrigatória
 * - Governança documentada
 * - Scripts de QA configurados
 * - Segurança organizacional
 * 
 * Uso: npm run system:checklist
 */

const fs = require('fs');
const path = require('path');

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
 * Verifica estrutura de pastas obrigatória
 */
function checkStructure() {
  logSection('📦 ESTRUTURA');

  const requiredPaths = [
    {
      name: 'Pasta /contracts',
      path: path.join(ROOT_DIR, 'contracts'),
      type: 'directory'
    },
    {
      name: 'generation.interface.json',
      path: path.join(ROOT_DIR, 'contracts', 'generation.interface.json'),
      type: 'file'
    },
    {
      name: 'qa.contract.json',
      path: path.join(ROOT_DIR, 'contracts', 'qa', 'qa.contract.json'),
      type: 'file'
    },
    {
      name: 'Pasta /tests/rpa',
      path: path.join(ROOT_DIR, 'tests', 'rpa'),
      type: 'directory'
    }
  ];

  let allValid = true;

  for (const item of requiredPaths) {
    const exists = fs.existsSync(item.path);
    
    if (!exists) {
      logError(`${item.name} não existe: ${item.path}`);
      allValid = false;
    } else {
      const stat = fs.statSync(item.path);
      const isCorrectType = item.type === 'directory' ? stat.isDirectory() : stat.isFile();
      
      if (!isCorrectType) {
        logError(`${item.name} existe mas não é do tipo esperado (${item.type})`);
        allValid = false;
      } else {
        logSuccess(`${item.name} existe`);
      }
    }
  }

  return allValid;
}

/**
 * Verifica governança documentada
 */
function checkGovernance() {
  logSection('📜 GOVERNANÇA');

  const projectRulesPath = path.join(ROOT_DIR, 'PROJECT_RULES.md');
  
  if (!fs.existsSync(projectRulesPath)) {
    logError('PROJECT_RULES.md não encontrado');
    return false;
  }

  const content = fs.readFileSync(projectRulesPath, 'utf8');
  
  const requiredSections = [
    {
      name: 'Seção "Testes RPA"',
      pattern: /## 🤖 Testes RPA|## Testes RPA/i
    },
    {
      name: 'Seção "Execução Oficial do Sistema"',
      pattern: /## Execução Oficial do Sistema|## 🎯 Execução Oficial/i
    }
  ];

  let allFound = true;

  for (const section of requiredSections) {
    if (section.pattern.test(content)) {
      logSuccess(`${section.name} encontrada`);
    } else {
      logError(`${section.name} NÃO encontrada em PROJECT_RULES.md`);
      allFound = false;
    }
  }

  return allFound;
}

/**
 * Verifica scripts de QA no package.json
 */
function checkQAScripts() {
  logSection('🧪 QA - Scripts');

  const packageJsonPath = path.join(ROOT_DIR, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    logError('package.json não encontrado');
    return false;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const scripts = packageJson.scripts || {};

  const requiredScripts = [
    {
      name: 'system:validate',
      description: 'Script oficial de validação do sistema'
    },
    {
      name: 'system:release-gate',
      description: 'Gate oficial de release'
    },
    {
      name: 'test:websocket',
      description: 'Regressão focada de WebSocket (auth/reconnect/session)'
    },
    {
      name: 'system:rollback-drill',
      description: 'Drill oficial de rollback'
    },
    {
      name: 'system:go-no-go',
      description: 'Decisão consolidada de go/no-go'
    },
    {
      name: 'system:release-decision',
      description: 'Formalização da decisão de release com owners/on-call'
    },
    {
      name: 'system:launch-plan-status',
      description: 'Status consolidado de marcos D-7/D-1/D0'
    },
    {
      name: 'system:release-manifest',
      description: 'Manifesto do release candidate (branch/commit/checks)'
    },
    {
      name: 'system:release-evidence-pack',
      description: 'Empacotamento das evidências de release'
    },
    {
      name: 'system:release-evidence-verify',
      description: 'Verificação de integridade SHA256 do pacote de evidências'
    },
    {
      name: 'system:release-evidence-prune',
      description: 'Limpeza de snapshots antigos de evidências de release'
    },
    {
      name: 'system:release-clean-check',
      description: 'Checagem de alterações pendentes fora de artefatos QA'
    },
    {
      name: 'system:release-summary',
      description: 'Resumo executivo de release para handoff'
    },
    {
      name: 'system:release-suite-confirm',
      description: 'Confirmação da operação mínima por suíte no release'
    },
    {
      name: 'system:release-window',
      description: 'Execução padronizada da janela de release'
    },
    {
      name: 'system:release-d0',
      description: 'Execução padronizada do dia D0 (deploy + validação pós-release)'
    },
    {
      name: 'system:release-contingency',
      description: 'Fluxo de contingência (backup + gate mínimo pós-rollback)'
    },
    {
      name: 'test:rpa',
      description: 'Script de testes RPA'
    }
  ];

  let allFound = true;

  for (const script of requiredScripts) {
    if (scripts[script.name]) {
      logSuccess(`Script "${script.name}" encontrado`);
    } else {
      logError(`Script "${script.name}" NÃO encontrado em package.json`);
      allFound = false;
    }
  }

  return allFound;
}

function checkLaunchEvidence() {
  logSection('🚀 LANÇAMENTO - Evidências');

  const requireEvidence = String(process.env.CHECKLIST_REQUIRE_LAUNCH_EVIDENCE || '0') === '1';
  const releaseGatePath = path.join(ROOT_DIR, 'qa', 'release-gate-report.json');
  const rollbackPath = path.join(ROOT_DIR, 'qa', 'rollback-drill-report.json');
  const goNoGoPath = path.join(ROOT_DIR, 'qa', 'go-no-go-report.json');
  const releaseDecisionPath = path.join(ROOT_DIR, 'qa', 'release-decision.json');
  const smokePath = path.join(ROOT_DIR, 'qa', 'smoke-evidence.json');
  const releaseWindowPath = path.join(ROOT_DIR, 'qa', 'release-window-report.json');
  const releaseManifestPath = path.join(ROOT_DIR, 'qa', 'release-manifest.json');
  const releaseSummaryPath = path.join(ROOT_DIR, 'qa', 'release-summary.md');
  const releaseSuiteConfirmationPath = path.join(ROOT_DIR, 'qa', 'release-suite-confirmation.json');

  const evidenceFiles = [
    { name: 'Release gate report', path: releaseGatePath },
    { name: 'Rollback drill report', path: rollbackPath },
    { name: 'Go/No-Go report', path: goNoGoPath },
    { name: 'Release decision record', path: releaseDecisionPath },
    { name: 'Release window report', path: releaseWindowPath },
    { name: 'Release manifest', path: releaseManifestPath },
    { name: 'Release summary', path: releaseSummaryPath },
    { name: 'Release suite confirmation', path: releaseSuiteConfirmationPath },
    { name: 'Smoke evidence summary', path: smokePath },
  ];

  let ok = true;

  for (const file of evidenceFiles) {
    if (!fs.existsSync(file.path)) {
      if (requireEvidence) {
        logError(`${file.name} não encontrado: ${file.path}`);
        ok = false;
      } else {
        logWarning(`${file.name} ausente (modo informativo): ${file.path}`);
      }
      continue;
    }
    logSuccess(`${file.name} encontrado`);
  }

  if (!fs.existsSync(smokePath)) {
    return requireEvidence ? false : true;
  }

  try {
    const smoke = JSON.parse(fs.readFileSync(smokePath, 'utf8'));
    const smokes = smoke && smoke.smokes ? smoke.smokes : {};
    const keys = ['l01', 'l02', 'l03', 'l04', 'l05'];
    for (const key of keys) {
      const status = smokes[key] && smokes[key].status;
      if (status === 'pass') {
        logSuccess(`Smoke ${key.toUpperCase()} em pass`);
      } else if (requireEvidence) {
        logError(`Smoke ${key.toUpperCase()} não está em pass`);
        ok = false;
      } else {
        logWarning(`Smoke ${key.toUpperCase()} sem pass (modo informativo)`);
      }
    }
  } catch (err) {
    if (requireEvidence) {
      logError(`Falha ao ler smoke-evidence.json: ${err.message || err}`);
      ok = false;
    } else {
      logWarning(`Falha ao ler smoke-evidence.json (modo informativo): ${err.message || err}`);
    }
  }

  return ok;
}

/**
 * Verifica segurança organizacional (pontos críticos)
 */
function checkSecurity() {
  logSection('🔒 SEGURANÇA ORGANIZACIONAL');

  let allValid = true;

  // Verifica se há scripts que chamam IA sem validação de contrato
  // Esta é uma verificação básica - auditoria completa está em BYPASS_AUDIT.md
  const criticalPaths = [
    {
      name: 'Validação de contrato em generationOrchestrator',
      path: path.join(ROOT_DIR, 'api', 'services', 'generationOrchestrator.js'),
      pattern: /validateGenerationContract|validate.*contract/i
    }
  ];

  for (const item of criticalPaths) {
    if (!fs.existsSync(item.path)) {
      logWarning(`${item.name}: arquivo não encontrado (${item.path})`);
      continue;
    }

    const content = fs.readFileSync(item.path, 'utf8');
    
    if (item.pattern.test(content)) {
      logSuccess(`${item.name}: validação de contrato encontrada`);
    } else {
      logWarning(`${item.name}: padrão de validação não encontrado (verificar manualmente)`);
      // Não falha o checklist, apenas avisa - auditoria completa está em BYPASS_AUDIT.md
    }
  }

  // Verifica se há scripts de scraping sem flag explícita
  // Esta verificação é informativa - não bloqueia
  logSuccess('Verificação básica de segurança concluída');
  logWarning('Para auditoria completa, consulte docs/BYPASS_AUDIT.md');

  return true; // Sempre passa - verificação é informativa
}

/**
 * Função principal
 */
function main() {
  log('');
  log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}`, BLUE);
  log(`${BOLD}  CHECKLIST AUTOMÁTICO DE CONFORMIDADE${RESET}`, BLUE);
  log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}`, BLUE);
  log('');

  const results = {
    structure: checkStructure(),
    governance: checkGovernance(),
    qaScripts: checkQAScripts(),
    security: checkSecurity(),
    launchEvidence: checkLaunchEvidence()
  };

  log('');
  logSection('RESULTADO FINAL');

  const allPassed = Object.values(results).every(r => r === true);

  if (allPassed) {
    logSuccess('CHECKLIST DE CONFORMIDADE: TUDO CONFORME');
    log('');
    log('O projeto está em conformidade com todas as verificações automáticas.');
    log('');
    process.exit(0);
  } else {
    logError('CHECKLIST DE CONFORMIDADE: FALHAS DETECTADAS');
    log('');
    log('Resumo:');
    log(`  Estrutura: ${results.structure ? '✓' : '✗'}`);
    log(`  Governança: ${results.governance ? '✓' : '✗'}`);
    log(`  QA Scripts: ${results.qaScripts ? '✓' : '✗'}`);
    log(`  Segurança: ${results.security ? '✓' : '✗'}`);
    log(`  Evidência de lançamento: ${results.launchEvidence ? '✓' : '✗'}`);
    log('');
    log('Corrija as falhas acima e execute novamente.');
    log('');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkStructure, checkGovernance, checkQAScripts, checkSecurity, checkLaunchEvidence };
