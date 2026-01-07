#!/usr/bin/env node
/**
 * Gate Anti-Regressão - Validação de Invariantes
 * 
 * Este script valida que todas as invariantes de governança epistemológica
 * estão presentes e não foram violadas.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Build deve falhar se qualquer invariante for violada
 * - Nenhuma invariante pode ser removida
 * - Nenhum bypass pode ser introduzido
 * 
 * Execução:
 *   node scripts/validate-invariants.js
 */

const fs = require('fs');
const path = require('path');
const logger = require('../api/utils/logger');

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Carrega o contrato de evidência.
 */
function loadEvidenceContract() {
  const contractPath = path.join(ROOT_DIR, 'contracts', 'evidence.contract.json');
  if (!fs.existsSync(contractPath)) {
    throw new Error('Contrato de evidência não encontrado');
  }
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

/**
 * Valida que o contrato de evidência existe e tem invariantes.
 */
function validateEvidenceContract() {
  const contract = loadEvidenceContract();
  const invariants = contract.evidence?.invariants;
  
  if (!invariants) {
    throw new Error('Contrato de evidência não possui invariantes definidos');
  }
  
  const requiredInvariants = [
    'noResponseWithoutEvidence',
    'noExecutionWithoutExecutionId',
    'noApprovalWithoutEpistemologicalValidation',
    'noDecisionWithoutAuthority',
    'noSilentException',
    'abstentionIsLegitimate',
  ];
  
  const missing = requiredInvariants.filter(inv => !invariants[inv]);
  if (missing.length > 0) {
    throw new Error(`Invariantes ausentes no contrato: ${missing.join(', ')}`);
  }
  
  // Valida que todas as invariantes estão habilitadas
  const disabled = Object.entries(invariants)
    .filter(([_, inv]) => inv.enforced !== true)
    .map(([name]) => name);
  
  if (disabled.length > 0) {
    throw new Error(`Invariantes desabilitadas: ${disabled.join(', ')}`);
  }
  
  console.log('✅ Contrato de evidência válido');
  return true;
}

/**
 * Valida que o estado 'abstained' existe no pipelineExecutionContext.
 */
function validateAbstainedState() {
  const filePath = path.join(ROOT_DIR, 'api', 'services', 'pipelineExecutionContext.js');
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Verifica se 'abstained' está no tipo de status
  if (!content.includes('"abstained"') && !content.includes("'abstained'")) {
    throw new Error('Estado "abstained" não encontrado em pipelineExecutionContext.js');
  }
  
  // Verifica se updateStatus aceita 'abstained'
  if (!content.includes('abstained')) {
    throw new Error('Função updateStatus não aceita estado "abstained"');
  }
  
  console.log('✅ Estado "abstained" presente no pipeline');
  return true;
}

/**
 * Valida que o evidenceValidator existe e valida evidência.
 */
function validateEvidenceValidator() {
  const filePath = path.join(ROOT_DIR, 'api', 'services', 'evidenceValidator.js');
  if (!fs.existsSync(filePath)) {
    throw new Error('evidenceValidator.js não encontrado');
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Verifica se valida evidência
  if (!content.includes('validateEvidence')) {
    throw new Error('evidenceValidator.js não possui função validateEvidence');
  }
  
  // Verifica se detecta inconsistências
  if (!content.includes('detectInconsistency')) {
    throw new Error('evidenceValidator.js não possui função detectInconsistency');
  }
  
  console.log('✅ Validador de evidência presente');
  return true;
}

/**
 * Valida que o pipelineOrchestrator verifica evidência antes de executar IA.
 */
function validatePipelineGate() {
  const filePath = path.join(ROOT_DIR, 'api', 'services', 'pipelineOrchestrator.js');
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Verifica se há gate antes da IA
  if (!content.includes('validateEvidence') && !content.includes('evidenceValidation')) {
    throw new Error('pipelineOrchestrator.js não valida evidência antes de executar IA');
  }
  
  // Verifica se há verificação de abstenção
  if (!content.includes('abstained') || !content.includes('status === \'abstained\'')) {
    throw new Error('pipelineOrchestrator.js não verifica estado "abstained" antes de executar IA');
  }
  
  console.log('✅ Gate de evidência presente no pipeline');
  return true;
}

/**
 * Valida que o QA valida epistemologia.
 */
function validateQaEpistemology() {
  const filePath = path.join(ROOT_DIR, 'qa', 'ragRuntimeQA.js');
  if (!fs.existsSync(filePath)) {
    throw new Error('ragRuntimeQA.js não encontrado');
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Verifica se valida abstenção
  if (!content.includes('abstained') || !content.includes('status === \'abstained\'')) {
    throw new Error('ragRuntimeQA.js não valida estado "abstained"');
  }
  
  // Verifica se valida evidência
  if (!content.includes('validateEvidence') || !content.includes('epistemological')) {
    throw new Error('ragRuntimeQA.js não valida epistemologia');
  }
  
  console.log('✅ Validação epistemológica presente no QA');
  return true;
}

/**
 * Valida que persistência determinística existe.
 */
function validateDeterministicPersistence() {
  const filePath = path.join(ROOT_DIR, 'api', 'services', 'executionPersistence.js');
  if (!fs.existsSync(filePath)) {
    throw new Error('executionPersistence.js não encontrado');
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Verifica se reutiliza decisões
  if (!content.includes('reuseDecision') && !content.includes('hasFinalDecision')) {
    throw new Error('executionPersistence.js não possui funções de reutilização de decisão');
  }
  
  console.log('✅ Persistência determinística presente');
  return true;
}

/**
 * Valida que logs de decisão estão estruturados.
 */
function validateDecisionLogs() {
  const filePath = path.join(ROOT_DIR, 'api', 'services', 'pipelineOrchestrator.js');
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Verifica se há logs estruturados de decisão
  if (!content.includes('[Decision]') && !content.includes('status=abstained') && !content.includes('status=approved')) {
    throw new Error('Logs de decisão não estão estruturados no formato [Decision]');
  }
  
  console.log('✅ Logs de decisão estruturados');
  return true;
}

/**
 * Executa todas as validações.
 */
function main() {
  console.log('🔍 Validando invariantes de governança epistemológica...\n');
  
  const validations = [
    { name: 'Contrato de Evidência', fn: validateEvidenceContract },
    { name: 'Estado Abstained', fn: validateAbstainedState },
    { name: 'Validador de Evidência', fn: validateEvidenceValidator },
    { name: 'Gate no Pipeline', fn: validatePipelineGate },
    { name: 'QA Epistemológico', fn: validateQaEpistemology },
    { name: 'Persistência Determinística', fn: validateDeterministicPersistence },
    { name: 'Logs de Decisão', fn: validateDecisionLogs },
  ];
  
  const errors = [];
  
  for (const validation of validations) {
    try {
      validation.fn();
    } catch (error) {
      console.error(`❌ ${validation.name}: ${error.message}`);
      errors.push({ name: validation.name, error: error.message });
    }
  }
  
  if (errors.length > 0) {
    console.error(`\n❌ ${errors.length} validação(ões) falharam:`);
    errors.forEach(e => console.error(`  - ${e.name}: ${e.error}`));
    console.error('\n🚫 BUILD FALHOU: Invariantes violadas');
    process.exit(1);
  }
  
  console.log('\n✅ Todas as invariantes estão presentes e válidas');
  console.log('✅ Sistema protegido contra regressões');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateEvidenceContract,
  validateAbstainedState,
  validateEvidenceValidator,
  validatePipelineGate,
  validateQaEpistemology,
  validateDeterministicPersistence,
  validateDecisionLogs,
};

