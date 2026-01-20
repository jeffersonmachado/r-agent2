#!/usr/bin/env node
/**
 * Script de teste para funcionalidades de aprendizado adaptativo do RAG.
 * 
 * Testa:
 * - Validação de queries usando regras do JSON
 * - Adaptação automática de regras
 * - Limpeza de queries inválidas
 * - Endpoints de aprendizado adaptativo
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:9000';
const API_URL = process.env.API_URL || 'http://localhost:3000';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: jsonData, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

async function testValidationRulesFile() {
  log('\n📋 Testando arquivo de regras de validação...', 'cyan');
  
  const rulesPath = path.join(__dirname, '../api/data/rag_validation_rules.json');
  
  if (!fs.existsSync(rulesPath)) {
    log('✗ Arquivo de regras não encontrado', 'red');
    return false;
  }
  
  try {
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');
    const rules = JSON.parse(rulesContent);
    
    // Valida estrutura básica
    const requiredFields = ['version', 'rules', 'adaptation', 'maxCycles', 'targetAccuracy'];
    for (const field of requiredFields) {
      if (!(field in rules)) {
        log(`✗ Campo obrigatório ausente: ${field}`, 'red');
        return false;
      }
    }
    
    // Valida regras
    const requiredRules = ['length', 'uuid', 'repetition', 'invalidPrefixes', 'invalidPatterns'];
    for (const rule of requiredRules) {
      if (!(rule in rules.rules)) {
        log(`✗ Regra obrigatória ausente: ${rule}`, 'red');
        return false;
      }
    }
    
    log('✓ Arquivo de regras válido', 'green');
    return true;
  } catch (error) {
    log(`✗ Erro ao validar arquivo de regras: ${error.message}`, 'red');
    return false;
  }
}

async function testValidationRulesEndpoint() {
  log('\n📋 Testando endpoint de regras de validação...', 'cyan');
  
  try {
    const response = await makeRequest(`${RAG_SERVICE_URL}/rag/learning/validation-rules`);
    
    if (response.status === 200 && response.data.success) {
      log('✓ Endpoint de regras de validação funcionando', 'green');
      return true;
    } else {
      log(`✗ Endpoint retornou status ${response.status}`, 'red');
      return false;
    }
  } catch (error) {
    log(`⚠ Endpoint não acessível (serviço pode não estar rodando): ${error.message}`, 'yellow');
    return false;
  }
}

async function testFullLearningDataEndpoint() {
  log('\n📋 Testando endpoint de dados completos de aprendizado...', 'cyan');
  
  try {
    const tenantId = process.env.TENANT_ID;
    if (!tenantId) {
      log('✗ TENANT_ID é obrigatório (export TENANT_ID=<tenant-id>)', 'red');
      return false;
    }
    const response = await makeRequest(`${RAG_SERVICE_URL}/rag/learning/full-data/${tenantId}`);
    
    if (response.status === 200 && response.data.success) {
      log('✓ Endpoint de dados completos funcionando', 'green');
      
      // Valida estrutura
      const requiredFields = ['metrics', 'synonyms', 'queryPatterns', 'config', 'learningCycles'];
      for (const field of requiredFields) {
        if (!(field in response.data)) {
          log(`⚠ Campo ausente na resposta: ${field}`, 'yellow');
        }
      }
      
      return true;
    } else {
      log(`✗ Endpoint retornou status ${response.status}`, 'red');
      return false;
    }
  } catch (error) {
    log(`⚠ Endpoint não acessível: ${error.message}`, 'yellow');
    return false;
  }
}

async function testCleanInvalidQueriesEndpoint() {
  log('\n📋 Testando endpoint de limpeza de queries inválidas...', 'cyan');
  
  try {
    const tenantId = process.env.TENANT_ID;
    if (!tenantId) {
      log('✗ TENANT_ID é obrigatório (export TENANT_ID=<tenant-id>)', 'red');
      return false;
    }
    const response = await makeRequest(
      `${RAG_SERVICE_URL}/rag/learning/clean-invalid-queries/${tenantId}`,
      { method: 'POST' }
    );
    
    if (response.status === 200 && response.data.success) {
      log('✓ Endpoint de limpeza funcionando', 'green');
      log(`  Queries removidas: ${response.data.totalRemoved || 0}`, 'blue');
      return true;
    } else {
      log(`✗ Endpoint retornou status ${response.status}`, 'red');
      return false;
    }
  } catch (error) {
    log(`⚠ Endpoint não acessível: ${error.message}`, 'yellow');
    return false;
  }
}

async function testAdaptationEndpoint() {
  log('\n📋 Testando endpoint de adaptação de regras...', 'cyan');
  
  try {
    const tenantId = process.env.TENANT_ID;
    if (!tenantId) {
      log('✗ TENANT_ID é obrigatório (export TENANT_ID=<tenant-id>)', 'red');
      return false;
    }
    const response = await makeRequest(
      `${RAG_SERVICE_URL}/rag/learning/validation-rules/adapt/${tenantId}`,
      { method: 'POST' }
    );
    
    if (response.status === 200 && response.data.success) {
      log('✓ Endpoint de adaptação funcionando', 'green');
      log(`  Adaptado: ${response.data.adapted ? 'Sim' : 'Não'}`, 'blue');
      return true;
    } else {
      log(`✗ Endpoint retornou status ${response.status}`, 'red');
      return false;
    }
  } catch (error) {
    log(`⚠ Endpoint não acessível: ${error.message}`, 'yellow');
    return false;
  }
}

async function main() {
  log('\n' + '='.repeat(60), 'cyan');
  log('🧪 TESTES DE APRENDIZADO ADAPTATIVO RAG', 'bright');
  log('='.repeat(60) + '\n', 'cyan');
  
  const results = {
    validationRulesFile: false,
    validationRulesEndpoint: false,
    fullLearningDataEndpoint: false,
    cleanInvalidQueriesEndpoint: false,
    adaptationEndpoint: false,
  };
  
  // Testa arquivo de regras
  results.validationRulesFile = await testValidationRulesFile();
  
  // Testa endpoints (podem falhar se serviço não estiver rodando)
  results.validationRulesEndpoint = await testValidationRulesEndpoint();
  results.fullLearningDataEndpoint = await testFullLearningDataEndpoint();
  results.cleanInvalidQueriesEndpoint = await testCleanInvalidQueriesEndpoint();
  results.adaptationEndpoint = await testAdaptationEndpoint();
  
  // Resumo
  log('\n' + '='.repeat(60), 'cyan');
  log('📊 RESUMO DOS TESTES', 'bright');
  log('='.repeat(60) + '\n', 'cyan');
  
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(Boolean).length;
  const skipped = Object.values(results).filter(r => r === false).length;
  
  for (const [test, result] of Object.entries(results)) {
    const status = result ? '✓' : '✗';
    const color = result ? 'green' : 'red';
    log(`${status} ${test}`, color);
  }
  
  log(`\nTotal: ${total} | Passou: ${passed} | Falhou: ${skipped}`, 
      passed === total ? 'green' : 'yellow');
  
  // Exit code
  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  log(`\n✗ Erro fatal: ${error.message}`, 'red');
  process.exit(1);
});

