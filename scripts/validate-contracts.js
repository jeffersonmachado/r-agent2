#!/usr/bin/env node

/**
 * Validador Automático de Contratos.
 * 
 * Valida payloads e contratos antes da IA rodar.
 * Falha antes da execução se houver problemas.
 * 
 * Uso:
 *   node scripts/validate-contracts.js [payload.json]
 *   node scripts/validate-contracts.js --check-contracts
 */

const fs = require('fs');
const path = require('path');
const { validateGenerationContract, loadContract } = require('../api/utils/contractValidator');

/**
 * Valida um contrato.
 */
function validateContract(contractPath) {
  console.log(`\n🔍 Validando contrato: ${contractPath}`);
  
  try {
    if (!fs.existsSync(contractPath)) {
      console.error(`❌ Contrato não encontrado: ${contractPath}`);
      return false;
    }

    const content = fs.readFileSync(contractPath, 'utf8');
    const contract = JSON.parse(content);

    // Valida estrutura básica
    if (!contract.generateFlow) {
      console.error('❌ Contrato não contém "generateFlow"');
      return false;
    }

    if (!contract.generateFlow.inputs) {
      console.error('❌ Contrato não contém "generateFlow.inputs"');
      return false;
    }

    // Valida campos obrigatórios
    const requiredFields = ['name', 'description'];
    const inputs = contract.generateFlow.inputs;
    
    if (!inputs.required || !Array.isArray(inputs.required)) {
      console.error('❌ Contrato não contém "required" como array');
      return false;
    }

    const missingRequired = requiredFields.filter(field => !inputs.required.includes(field));
    if (missingRequired.length > 0) {
      console.error(`❌ Campos obrigatórios faltando: ${missingRequired.join(', ')}`);
      return false;
    }

    // Valida propriedades
    if (!inputs.properties) {
      console.error('❌ Contrato não contém "properties"');
      return false;
    }

    const requiredProps = ['name', 'description', 'useRag', 'ragSources', 'useWebScraping', 'scrapingTargets', 'generateRpaTest', 'rpaMode'];
    const missingProps = requiredProps.filter(prop => !inputs.properties[prop]);
    if (missingProps.length > 0) {
      console.error(`❌ Propriedades faltando: ${missingProps.join(', ')}`);
      return false;
    }

    console.log('✅ Contrato válido');
    return true;
  } catch (err) {
    console.error(`❌ Erro ao validar contrato: ${err.message}`);
    return false;
  }
}

/**
 * Valida um payload contra o contrato.
 */
function validatePayload(payloadPath) {
  console.log(`\n🔍 Validando payload: ${payloadPath}`);
  
  try {
    if (!fs.existsSync(payloadPath)) {
      console.error(`❌ Payload não encontrado: ${payloadPath}`);
      return false;
    }

    const content = fs.readFileSync(payloadPath, 'utf8');
    const payload = JSON.parse(content);

    const validation = validateGenerationContract(payload);

    if (!validation.valid) {
      console.error('❌ Payload inválido:');
      validation.errors.forEach(error => {
        console.error(`   - ${error}`);
      });
      return false;
    }

    console.log('✅ Payload válido');
    return true;
  } catch (err) {
    console.error(`❌ Erro ao validar payload: ${err.message}`);
    return false;
  }
}

/**
 * Valida todos os contratos.
 */
function validateAllContracts() {
  console.log('\n📋 Validando todos os contratos...\n');

  const contractsDir = path.join(__dirname, '..', 'contracts');
  const contracts = [
    'generation.interface.json',
    'qa/qa.contract.json',
  ];

  let allValid = true;

  contracts.forEach(contractFile => {
    const contractPath = path.join(contractsDir, contractFile);
    if (!validateContract(contractPath)) {
      allValid = false;
    }
  });

  return allValid;
}

/**
 * Main
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--check-contracts') {
    // Valida apenas contratos
    const valid = validateAllContracts();
    process.exit(valid ? 0 : 1);
  } else {
    // Valida payload específico
    const payloadPath = args[0];
    const valid = validatePayload(payloadPath);
    process.exit(valid ? 0 : 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  validateContract,
  validatePayload,
  validateAllContracts,
};

