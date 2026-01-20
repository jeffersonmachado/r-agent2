#!/usr/bin/env node
/**
 * Script para testar as correções implementadas no RAG
 * - Validação de UUIDs
 * - minScore 0.5
 * - Melhorias no prompt
 * - Tratamento de erros
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:9000';
const TENANT_ID = process.env.TENANT_ID;
if (!TENANT_ID) {
  console.error('❌ TENANT_ID é obrigatório (export TENANT_ID=<tenant-id>)');
  process.exit(1);
}

let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Faz uma requisição HTTP
 */
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, RAG_SERVICE_URL);
    const protocol = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({
            status: res.statusCode,
            body: jsonBody,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: body,
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Testa uma query
 */
async function testQuery(query, description, expectedSuccess = true) {
  console.log(`\n🧪 Teste: ${description}`);
  console.log(`   Query: "${query}"`);
  
  try {
    const response = await makeRequest('POST', '/rag/query', {
      query,
      tenantId: TENANT_ID,
      options: {
        topK: 5,
        minScore: 0.5,  // Usando o novo minScore padrão
        maxTokens: 1000,
      },
    });

    if (response.status === 200) {
      const result = response.body;
      
      console.log(`   Status: ${response.status}`);
      console.log(`   Success: ${result.success}`);
      console.log(`   Confidence: ${result.confidence ? Math.round(result.confidence * 100) + '%' : 'N/A'}`);
      console.log(`   Chunks encontrados: ${result.metadata?.chunksFound || 0}`);
      console.log(`   Chunks pesquisados: ${result.metadata?.chunksSearched || 0}`);
      
      if (result.response) {
        const responsePreview = result.response.substring(0, 150);
        console.log(`   Resposta: ${responsePreview}${result.response.length > 150 ? '...' : ''}`);
      }
      
      if (result.error) {
        console.log(`   ⚠️  Erro: ${result.error}`);
      }
      
      if (result.sources && result.sources.length > 0) {
        console.log(`   📚 Documentos encontrados: ${result.sources.length}`);
        result.sources.forEach((source, idx) => {
          console.log(`      ${idx + 1}. Doc: ${source.documentId.substring(0, 20)}... | Score: ${source.score.toFixed(2)}`);
        });
      }
      
      const testPassed = expectedSuccess ? result.success : !result.success;
      
      if (testPassed) {
        console.log(`   ✅ PASSOU`);
        testResults.passed++;
      } else {
        console.log(`   ❌ FALHOU (esperado success=${expectedSuccess}, obtido=${result.success})`);
        testResults.failed++;
      }
      
      testResults.tests.push({
        description,
        query,
        passed: testPassed,
        result: {
          success: result.success,
          confidence: result.confidence,
          chunksFound: result.metadata?.chunksFound || 0,
          error: result.error,
        }
      });
      
      return result;
    } else {
      console.log(`   ❌ FALHOU - Status HTTP: ${response.status}`);
      console.log(`   Resposta: ${JSON.stringify(response.body)}`);
      testResults.failed++;
      testResults.tests.push({
        description,
        query,
        passed: false,
        error: `HTTP ${response.status}`,
      });
      return null;
    }
  } catch (error) {
    console.log(`   ❌ ERRO: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({
      description,
      query,
      passed: false,
      error: error.message,
    });
    return null;
  }
}

/**
 * Verifica health do serviço
 */
async function checkHealth() {
  console.log('🏥 Verificando saúde do serviço RAG...');
  try {
    const response = await makeRequest('GET', '/rag/health');
    if (response.status === 200) {
      console.log('✅ Serviço RAG está rodando');
      console.log(`   Vector Store: ${response.body.vectorStore || 'N/A'}`);
      console.log(`   Documentos indexados: ${response.body.indexedDocuments || 0}`);
      console.log(`   Chunks indexados: ${response.body.indexedChunks || 0}`);
      return true;
    } else {
      console.log(`❌ Serviço RAG não está respondendo (Status: ${response.status})`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Erro ao conectar ao serviço RAG: ${error.message}`);
    console.log(`   Verifique se o serviço está rodando em ${RAG_SERVICE_URL}`);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 TESTE DAS CORREÇÕES DO RAG');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Serviço RAG: ${RAG_SERVICE_URL}`);
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log('');

  // 1. Verifica saúde do serviço
  const isHealthy = await checkHealth();
  if (!isHealthy) {
    console.log('\n❌ Serviço RAG não está disponível. Encerrando testes.');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📋 EXECUTANDO TESTES');
  console.log('═══════════════════════════════════════════════════════');

  // 2. Teste 1: Validação de UUID (deve rejeitar)
  await testQuery(
    'dc664ec2-7fa7-4f12-a457-6c1e35138939',
    'Validação de UUID - deve rejeitar',
    false  // Esperado: não deve ter sucesso
  );

  // 3. Teste 2: Pergunta sobre UUID (deve rejeitar)
  await testQuery(
    'O que é dc664ec2-7fa7-4f12-a457-6c1e35138939?',
    'Pergunta sobre UUID - deve rejeitar',
    false
  );

  // 4. Teste 3: Pergunta normal (deve funcionar se houver documentos)
  await testQuery(
    'O que é Planos?',
    'Pergunta normal - "O que é Planos?"',
    true
  );

  // 5. Teste 4: Pergunta sobre funcionamento
  await testQuery(
    'Como funciona Planos?',
    'Pergunta sobre funcionamento',
    true
  );

  // 6. Teste 5: Pergunta genérica
  await testQuery(
    'Como fazer um pagamento?',
    'Pergunta genérica',
    true
  );

  // 7. Teste 6: Pergunta muito curta (deve rejeitar)
  await testQuery(
    'Oi',
    'Pergunta muito curta - deve rejeitar',
    false
  );

  // Resumo
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('📊 RESUMO DOS TESTES');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`✅ Testes passados: ${testResults.passed}`);
  console.log(`❌ Testes falhados: ${testResults.failed}`);
  console.log(`📈 Taxa de sucesso: ${Math.round((testResults.passed / (testResults.passed + testResults.failed)) * 100) || 0}%`);
  console.log('');

  if (testResults.failed > 0) {
    console.log('⚠️  Testes que falharam:');
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => {
        console.log(`   - ${t.description}`);
        if (t.error) {
          console.log(`     Erro: ${t.error}`);
        }
      });
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🔍 ANÁLISE DAS CORREÇÕES');
  console.log('═══════════════════════════════════════════════════════');

  // Verifica se validação de UUID está funcionando
  const uuidTests = testResults.tests.filter(t => 
    t.query.includes('dc664ec2-7fa7-4f12-a457-6c1e35138939') || 
    t.query === 'Oi'
  );
  const uuidValidationWorking = uuidTests.every(t => !t.passed || t.error);
  
  if (uuidValidationWorking) {
    console.log('✅ Validação de UUID: FUNCIONANDO');
  } else {
    console.log('❌ Validação de UUID: NÃO ESTÁ FUNCIONANDO');
  }

  // Verifica se perguntas normais estão funcionando
  const normalTests = testResults.tests.filter(t => 
    !t.query.includes('dc664ec2-7fa7-4f12-a457-6c1e35138939') && 
    t.query !== 'Oi' &&
    t.query.length > 10
  );
  const normalQueriesWorking = normalTests.some(t => t.passed && t.result?.chunksFound > 0);
  
  if (normalQueriesWorking) {
    console.log('✅ Perguntas normais: FUNCIONANDO');
  } else {
    console.log('⚠️  Perguntas normais: Nenhum chunk encontrado (pode ser normal se não houver documentos indexados)');
  }

  // Verifica confiança
  const queriesWithResults = testResults.tests.filter(t => 
    t.result && t.result.chunksFound > 0
  );
  if (queriesWithResults.length > 0) {
    const avgConfidence = queriesWithResults.reduce((sum, t) => sum + (t.result.confidence || 0), 0) / queriesWithResults.length;
    console.log(`📊 Confiança média: ${Math.round(avgConfidence * 100)}%`);
    
    if (avgConfidence >= 0.5) {
      console.log('✅ Confiança: BOM (>= 50%)');
    } else if (avgConfidence >= 0.3) {
      console.log('⚠️  Confiança: BAIXA (30-50%)');
    } else {
      console.log('❌ Confiança: MUITO BAIXA (< 30%)');
    }
  }

  console.log('\n');

  // Exit code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Executa
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = { testQuery, checkHealth };

