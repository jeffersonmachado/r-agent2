/**
 * Script de Validação de GO Técnico Controlado.
 * 
 * Valida que:
 * - systemReady === true
 * - governanceActive === true
 * - riskLevel === CONTROLLED
 * 
 * SE ALGUM FAIL:
 * → BLOQUEAR GO
 * → GERAR RELATÓRIO
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../api/utils/logger');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

// Carrega test-report.json
const ROOT = path.join(__dirname, '..');
const TEST_REPORT_PATH = resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, 'qa/test-report.json', 'TEST_REPORT_PATH'));
const QA_POLICY_PATH = path.join(__dirname, '../governance/qa-policy.json');

let testReport = null;
let qaPolicy = null;

try {
  testReport = JSON.parse(fs.readFileSync(TEST_REPORT_PATH, 'utf8'));
} catch (error) {
  logger.error('[validate-go-technical] Erro ao carregar test-report.json', { error: error.message });
  process.exit(1);
}

try {
  qaPolicy = JSON.parse(fs.readFileSync(QA_POLICY_PATH, 'utf8'));
} catch (error) {
  logger.error('[validate-go-technical] Erro ao carregar qa-policy.json', { error: error.message });
  process.exit(1);
}

/**
 * Valida systemReady
 */
function validateSystemReady() {
  const systemReady = testReport.systemReady === true;
  
  if (!systemReady) {
    logger.error('[validate-go-technical] systemReady !== true', { 
      systemReady: testReport.systemReady 
    });
    return false;
  }
  
  logger.info('[validate-go-technical] systemReady === true');
  return true;
}

/**
 * Valida governanceActive
 */
function validateGovernanceActive() {
  // Verifica se políticas de governança existem e estão ativas
  const governanceFiles = [
    'governance/qa-policy.json',
    'governance/warn-approval-policy.json',
    'governance/runtime-escalation-policy.json',
    'governance/ia-rollout-policy.json',
    'governance/roles-raci.json'
  ];
  
  let allExist = true;
  for (const file of governanceFiles) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
      logger.error('[validate-go-technical] Arquivo de governança não encontrado', { file });
      allExist = false;
    }
  }
  
  // Verifica se políticas têm enforcement habilitado
  const enforcementEnabled = qaPolicy.enforcement?.ci?.enabled === true;
  
  if (!allExist || !enforcementEnabled) {
    logger.error('[validate-go-technical] governanceActive !== true', { 
      allFilesExist: allExist,
      enforcementEnabled 
    });
    return false;
  }
  
  logger.info('[validate-go-technical] governanceActive === true');
  return true;
}

/**
 * Valida riskLevel === CONTROLLED
 */
function validateRiskLevel() {
  // Verifica se há falhas bloqueantes
  const hasBlockingFailures = testReport.summary?.categoriesIncomplete > 0;
  
  // Verifica se há gaps de cobertura
  const hasCoverageGaps = testReport.coverageGaps && testReport.coverageGaps.length > 0;
  
  // Verifica se todos os testes sistêmicos passaram
  const allTestsPassed = testReport.summary?.categoriesComplete === testReport.summary?.totalCategories;
  
  // RiskLevel CONTROLLED significa:
  // - Todos os testes passaram
  // - Sem gaps de cobertura
  // - Sem falhas bloqueantes
  const riskLevel = (hasBlockingFailures || hasCoverageGaps || !allTestsPassed) 
    ? 'UNCONTROLLED' 
    : 'CONTROLLED';
  
  if (riskLevel !== 'CONTROLLED') {
    logger.error('[validate-go-technical] riskLevel !== CONTROLLED', { 
      riskLevel,
      hasBlockingFailures,
      hasCoverageGaps,
      allTestsPassed
    });
    return false;
  }
  
  logger.info('[validate-go-technical] riskLevel === CONTROLLED');
  return true;
}

/**
 * Executa validação completa
 */
function validateGoTechnical() {
  logger.info('[validate-go-technical] Iniciando validação de GO técnico...');
  
  const results = {
    systemReady: validateSystemReady(),
    governanceActive: validateGovernanceActive(),
    riskLevel: validateRiskLevel(),
    timestamp: new Date().toISOString()
  };
  
  const allPassed = results.systemReady && results.governanceActive && results.riskLevel;
  
  if (!allPassed) {
    logger.error('[validate-go-technical] GO TÉCNICO BLOQUEADO', results);
    
    // Gera relatório de bloqueio
    const reportPath = resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, 'qa/go-technical-blocked.json', 'GO_TECHNICAL_BLOCKED_PATH'));
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      status: 'BLOCKED',
      reason: 'Uma ou mais validações falharam',
      results,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    process.exit(1);
  }
  
  logger.info('[validate-go-technical] GO TÉCNICO APROVADO', results);
  
  // Gera relatório de aprovação
  const reportPath = resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, 'qa/go-technical-approved.json', 'GO_TECHNICAL_APPROVED_PATH'));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    status: 'APPROVED',
    results,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  process.exit(0);
}

// Executa validação
validateGoTechnical();

