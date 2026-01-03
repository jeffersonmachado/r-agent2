/**
 * Executor de QA para CI.
 * 
 * Responsabilidades:
 * 1. Detectar arquivos alterados (via Git ou lista fornecida)
 * 2. Consultar impact-map.json para determinar escopos afetados
 * 3. Executar apenas os checks necessários
 * 4. Gerar um QaResult
 * 5. Retornar código de saída apropriado (0 = sucesso, 1 = falha bloqueante)
 * 
 * Reutiliza testes existentes sempre que possível.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../api/utils/logger');

// Carrega o mapa de impacto
const IMPACT_MAP_PATH = path.join(__dirname, 'impact-map.json');
let impactMap = {};

try {
  impactMap = JSON.parse(fs.readFileSync(IMPACT_MAP_PATH, 'utf8'));
} catch (error) {
  logger.error('[qaRunner] Erro ao carregar impact-map.json', { error: error.message });
  process.exit(1);
}

/**
 * Detecta arquivos alterados via Git.
 * 
 * @param {string} baseRef - Referência base (ex: 'main', 'origin/main')
 * @returns {Array<string>} Lista de arquivos alterados
 */
function getChangedFiles(baseRef = 'HEAD') {
  try {
    // Em PR, compara com base. Em push, compara com commit anterior
    const command = `git diff --name-only ${baseRef}...HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD 2>/dev/null || echo ''`;
    const output = execSync(command, { encoding: 'utf8', cwd: path.join(__dirname, '..') });
    return output.trim().split('\n').filter(file => file.trim());
  } catch (error) {
    logger.warn('[qaRunner] Erro ao detectar arquivos alterados, usando lista vazia', { error: error.message });
    return [];
  }
}

/**
 * Determina escopos de QA afetados por arquivos alterados.
 * 
 * @param {Array<string>} changedFiles - Lista de arquivos alterados
 * @returns {Set<string>} Conjunto de escopos afetados
 */
function determineAffectedScopes(changedFiles) {
  const scopes = new Set();

  changedFiles.forEach(file => {
    // Verifica cada padrão no impact-map
    for (const [pattern, config] of Object.entries(impactMap)) {
      if (pattern === '$schema' || pattern === 'description' || pattern === 'type') {
        continue; // Ignora propriedades do schema
      }

      // Converte glob pattern para regex simples
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\//g, '\\/');
      
      const regex = new RegExp(`^${regexPattern}$`);

      if (regex.test(file)) {
        const scopesList = config.scopes || [];
        scopesList.forEach(scope => scopes.add(scope));
      }
    }
  });

  return scopes;
}

/**
 * Executa checks de QA para escopos específicos.
 * 
 * @param {Set<string>} scopes - Escopos a verificar
 * @param {Array<string>} changedFiles - Arquivos alterados (para contexto)
 * @returns {Array<Object>} Lista de checks executados
 */
function runQaChecks(scopes, changedFiles) {
  const checks = [];

  // Check: Contratos existem e são válidos
  if (scopes.has('contracts')) {
    checks.push(...runContractChecks());
  }

  // Check: Prompts oficiais existem
  if (scopes.has('prompts')) {
    checks.push(...runPromptChecks());
  }

  // Check: Wrappers seguem contratos
  if (scopes.has('wrappers')) {
    checks.push(...runWrapperChecks());
  }

  // Check: Testes de governança IA passam
  if (scopes.has('wrappers') || scopes.has('contracts')) {
    checks.push(...runAiGovernanceChecks());
  }

  // Check: Validação estrutural de fluxos
  if (scopes.has('wrappers') || scopes.has('contracts')) {
    checks.push(...runFlowValidationChecks());
  }

  // Check: Validação de RPA
  if (scopes.has('wrappers') || scopes.has('contracts')) {
    checks.push(...runRpaValidationChecks());
  }

  return checks;
}

/**
 * Checks de contratos.
 */
function runContractChecks() {
  const checks = [];

  // Check: Contrato de QA existe
  const qaContractPath = path.join(__dirname, '../contracts/qa/qa-result.schema.json');
  if (!fs.existsSync(qaContractPath)) {
    checks.push({
      id: 'contracts.qa.schema.exists',
      result: 'FAIL',
      blocking: true,
      details: { message: 'Contrato de QA não encontrado' }
    });
  } else {
    checks.push({
      id: 'contracts.qa.schema.exists',
      result: 'PASS',
      blocking: true
    });
  }

  // Check: Contratos de IA existem
  const iaContractPath = path.join(__dirname, '../contracts/ia/ia-generation-result.schema.json');
  if (!fs.existsSync(iaContractPath)) {
    checks.push({
      id: 'contracts.ia.schema.exists',
      result: 'FAIL',
      blocking: true,
      details: { message: 'Contrato de IA não encontrado' }
    });
  } else {
    checks.push({
      id: 'contracts.ia.schema.exists',
      result: 'PASS',
      blocking: true
    });
  }

  return checks;
}

/**
 * Checks de prompts.
 */
function runPromptChecks() {
  const checks = [];

  const requiredPrompts = [
    'prompts/chatbot.generator.prompt.md',
    'prompts/rpa.generator.prompt.md'
  ];

  requiredPrompts.forEach(promptPath => {
    const fullPath = path.join(__dirname, '..', promptPath);
    if (!fs.existsSync(fullPath)) {
      checks.push({
        id: `prompts.${path.basename(promptPath)}.exists`,
        result: 'FAIL',
        blocking: true,
        details: { message: `Prompt oficial não encontrado: ${promptPath}` }
      });
    } else {
      checks.push({
        id: `prompts.${path.basename(promptPath)}.exists`,
        result: 'PASS',
        blocking: true
      });
    }
  });

  return checks;
}

/**
 * Checks de wrappers.
 */
function runWrapperChecks() {
  const checks = [];

  // Check: Wrappers existem
  const requiredWrappers = [
    'engine/ai/generateChatbotFlow.js',
    'engine/ai/generateRpaTest.js'
  ];

  requiredWrappers.forEach(wrapperPath => {
    const fullPath = path.join(__dirname, '..', wrapperPath);
    if (!fs.existsSync(fullPath)) {
      checks.push({
        id: `wrappers.${path.basename(wrapperPath)}.exists`,
        result: 'FAIL',
        blocking: true,
        details: { message: `Wrapper não encontrado: ${wrapperPath}` }
      });
    } else {
      checks.push({
        id: `wrappers.${path.basename(wrapperPath)}.exists`,
        result: 'PASS',
        blocking: true
      });
    }
  });

  return checks;
}

/**
 * Checks de governança IA (executa testes existentes).
 */
function runAiGovernanceChecks() {
  const checks = [];

  try {
    // Executa testes de governança IA
    const testPath = path.join(__dirname, '../tests/ai-governance');
    if (fs.existsSync(testPath)) {
      try {
        execSync('npm run test:ai-governance', {
          cwd: path.join(__dirname, '..'),
          stdio: 'pipe',
          timeout: 60000
        });
        checks.push({
          id: 'ai.governance.tests',
          result: 'PASS',
          blocking: true
        });
      } catch (error) {
        checks.push({
          id: 'ai.governance.tests',
          result: 'FAIL',
          blocking: true,
          details: { message: 'Testes de governança IA falharam', error: error.message }
        });
      }
    } else {
      checks.push({
        id: 'ai.governance.tests',
        result: 'WARN',
        blocking: false,
        details: { message: 'Testes de governança IA não encontrados' }
      });
    }
  } catch (error) {
    checks.push({
      id: 'ai.governance.tests',
      result: 'FAIL',
      blocking: true,
      details: { message: 'Erro ao executar testes de governança IA', error: error.message }
    });
  }

  return checks;
}

/**
 * Checks de validação de fluxos.
 */
function runFlowValidationChecks() {
  const checks = [];

  // Verifica se validador existe
  const validatorPath = path.join(__dirname, '../api/utils/validateFlowPlan.js');
  if (fs.existsSync(validatorPath)) {
    checks.push({
      id: 'validation.flow.validator.exists',
      result: 'PASS',
      blocking: true
    });
  } else {
    checks.push({
      id: 'validation.flow.validator.exists',
      result: 'FAIL',
      blocking: true,
      details: { message: 'Validador de fluxos não encontrado' }
    });
  }

  return checks;
}

/**
 * Checks de validação de RPA.
 */
function runRpaValidationChecks() {
  const checks = [];

  // Verifica se validador existe
  const validatorPath = path.join(__dirname, '../api/utils/validateRpaPlan.js');
  if (fs.existsSync(validatorPath)) {
    checks.push({
      id: 'validation.rpa.validator.exists',
      result: 'PASS',
      blocking: true
    });
  } else {
    checks.push({
      id: 'validation.rpa.validator.exists',
      result: 'FAIL',
      blocking: true,
      details: { message: 'Validador de RPA não encontrado' }
    });
  }

  return checks;
}

/**
 * Gera QaResult a partir de checks.
 * 
 * @param {Array<Object>} checks - Lista de checks
 * @param {Set<string>} scopes - Escopos afetados
 * @param {Array<string>} changedFiles - Arquivos alterados
 * @param {string} source - Origem da execução ('ci', 'local', etc.)
 * @returns {Object} QaResult
 */
function generateQaResult(checks, scopes, changedFiles, source = 'ci') {
  const blockingFailures = checks.filter(check => check.result === 'FAIL' && check.blocking);
  const hasFailures = checks.some(check => check.result === 'FAIL');
  const hasWarnings = checks.some(check => check.result === 'WARN' || check.result === 'FAIL' && !check.blocking);

  let status = 'PASS';
  if (blockingFailures.length > 0) {
    status = 'FAIL';
  } else if (hasWarnings || hasFailures) {
    status = 'WARN';
  }

  // Obtém commit e branch se disponível
  let commit = null;
  let branch = null;
  try {
    commit = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
  } catch (error) {
    // Ignora erro se não estiver em repositório Git
  }

  return {
    status,
    scope: Array.from(scopes),
    checks,
    meta: {
      timestamp: new Date().toISOString(),
      source,
      commit,
      branch,
      changedFiles: changedFiles.length > 0 ? changedFiles : undefined
    }
  };
}

/**
 * Executa QA completo.
 * 
 * @param {Object} options
 * @param {Array<string>} [options.changedFiles] - Lista de arquivos alterados (se não fornecido, detecta via Git)
 * @param {string} [options.baseRef] - Referência base para Git diff
 * @param {string} [options.source] - Origem da execução ('ci', 'local', etc.)
 * @returns {Object} QaResult
 */
function runQa(options = {}) {
  const { changedFiles: providedFiles, baseRef, source = 'ci' } = options;

  // Detecta arquivos alterados
  const changedFiles = providedFiles || getChangedFiles(baseRef);

  if (changedFiles.length === 0) {
    logger.info('[qaRunner] Nenhum arquivo alterado detectado');
    return generateQaResult([], new Set(), [], source);
  }

  logger.info('[qaRunner] Arquivos alterados detectados', { count: changedFiles.length, files: changedFiles });

  // Determina escopos afetados
  const scopes = determineAffectedScopes(changedFiles);

  if (scopes.size === 0) {
    logger.info('[qaRunner] Nenhum escopo de QA afetado');
    return generateQaResult([], scopes, changedFiles, source);
  }

  logger.info('[qaRunner] Escopos afetados', { scopes: Array.from(scopes) });

  // Executa checks
  const checks = runQaChecks(scopes, changedFiles);

  // Gera resultado
  const result = generateQaResult(checks, scopes, changedFiles, source);

  return result;
}

// Se executado diretamente (CI)
if (require.main === module) {
  const result = runQa({ source: 'ci' });

  // Salva resultado em arquivo para CI
  const outputPath = path.join(__dirname, 'qa-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  // Log resumido
  const blockingFailures = result.checks.filter(check => check.result === 'FAIL' && check.blocking);
  logger.info('[qaRunner] QA concluído', {
    status: result.status,
    scopes: result.scope,
    totalChecks: result.checks.length,
    blockingFailures: blockingFailures.length
  });

  // Se houver falhas bloqueantes, retorna código de erro
  if (blockingFailures.length > 0) {
    console.error('\n❌ QA falhou com falhas bloqueantes:');
    blockingFailures.forEach(check => {
      console.error(`  - ${check.id}: ${check.details?.message || 'Falha bloqueante'}`);
    });
    process.exit(1);
  }

  if (result.status === 'FAIL') {
    process.exit(1);
  }

  process.exit(0);
}

module.exports = {
  runQa,
  getChangedFiles,
  determineAffectedScopes,
  generateQaResult
};

