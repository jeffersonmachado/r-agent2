#!/usr/bin/env node
/**
 * Script para testar a análise de documentos RAG
 * Verifica se os documentos estão indexados e se as perguntas geram respostas
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID;
if (!TENANT_ID) {
  console.error('❌ TENANT_ID é obrigatório (export TENANT_ID=<tenant-id>)');
  process.exit(1);
}

// Credenciais padrão (ajuste se necessário)
const USERNAME = process.env.USERNAME || 'admin';
const PASSWORD = process.env.PASSWORD || 'admin123';

let authToken = null;

/**
 * Faz uma requisição HTTP
 */
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE_URL);
    const protocol = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    if (authToken) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
    }

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
            headers: res.headers,
            body: jsonBody,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
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
 * Faz login e obtém token
 */
async function login() {
  console.log('🔐 Fazendo login...');
  const response = await makeRequest('POST', '/auth/login', {
    username: USERNAME,
    password: PASSWORD,
  });

  if (response.status === 200 && response.body.token) {
    authToken = response.body.token;
    console.log('✅ Login realizado com sucesso\n');
    return true;
  } else {
    console.error('❌ Erro ao fazer login:', response.body);
    return false;
  }
}

/**
 * Lista documentos RAG
 */
async function listDocuments() {
  console.log('📚 Listando documentos RAG...');
  const response = await makeRequest('GET', `/rag/documents?tenantId=${TENANT_ID}`);

  if (response.status === 200) {
    const docs = Array.isArray(response.body) ? response.body : [];
    console.log(`✅ Encontrados ${docs.length} documentos\n`);
    return docs;
  } else {
    console.error('❌ Erro ao listar documentos:', response.body);
    return [];
  }
}

/**
 * Obtém estatísticas
 */
async function getStats() {
  console.log('📊 Obtendo estatísticas...');
  const response = await makeRequest('GET', `/rag/documents/stats?tenantId=${TENANT_ID}`);

  if (response.status === 200) {
    console.log('✅ Estatísticas obtidas:', response.body);
    return response.body;
  } else {
    console.error('❌ Erro ao obter estatísticas:', response.body);
    return null;
  }
}

/**
 * Testa uma pergunta no RAG
 */
async function testQuery(question, minScore = 0.3) {
  const response = await makeRequest('POST', '/rag/query', {
    query: question,
    tenantId: TENANT_ID,
    options: {
      topK: 5,
      minScore: minScore,
      maxTokens: 1000,
    },
  });

  if (response.status === 200) {
    return response.body;
  } else {
    return {
      success: false,
      error: response.body.error || `HTTP ${response.status}`,
    };
  }
}

/**
 * Gera perguntas baseadas no conteúdo
 */
function generateQuestions(title, content) {
  const questions = [];
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  // Perguntas baseadas no título
  if (title) {
    const titleWords = title.split(/\s+/).filter(w => 
      w.length > 3 && !['como', 'para', 'sobre', 'guia', 'manual'].includes(w.toLowerCase())
    );
    if (titleWords.length > 0) {
      const mainTopic = titleWords[0];
      questions.push(`O que é ${mainTopic}?`);
      questions.push(`Como funciona ${mainTopic}?`);
    }
  }

  // Perguntas baseadas em palavras-chave
  const keywords = {
    'senha': 'Como resetar minha senha?',
    'conta': 'Como criar uma conta?',
    'pagamento': 'Como fazer um pagamento?',
    'suporte': 'Como entrar em contato com o suporte?',
    'ticket': 'Como abrir um ticket?',
  };

  for (const [keyword, question] of Object.entries(keywords)) {
    if (contentLower.includes(keyword) || titleLower.includes(keyword)) {
      questions.push(question);
    }
  }

  return questions.slice(0, 3);
}

/**
 * Analisa documentos
 */
async function analyzeDocuments() {
  console.log('🔍 Iniciando análise de documentos RAG...\n');

  // 1. Lista documentos
  const documents = await listDocuments();
  const indexedDocs = documents.filter(
    doc => doc.indexed && doc.status === 'active' && doc.content
  );

  console.log(`📋 Documentos indexados e ativos: ${indexedDocs.length}\n`);

  if (indexedDocs.length === 0) {
    console.log('⚠️  Nenhum documento indexado encontrado para analisar');
    return;
  }

  // 2. Obtém estatísticas
  const stats = await getStats();
  console.log('');

  // 3. Testa perguntas para cada documento
  const results = [];
  const docsToTest = indexedDocs.slice(0, 5); // Testa apenas 5 documentos

  for (const doc of docsToTest) {
    console.log(`\n📄 Analisando: ${doc.title}`);
    console.log(`   ID: ${doc.id}`);
    console.log(`   Chunks: ${doc.chunksCount || 0}`);
    console.log(`   Conteúdo: ${(doc.content || '').substring(0, 100)}...`);

    const questions = generateQuestions(doc.title, doc.content || '');

    if (questions.length === 0) {
      console.log('   ⚠️  Nenhuma pergunta gerada para este documento');
      continue;
    }

    for (const question of questions) {
      console.log(`\n   ❓ Testando: "${question}"`);
      
      // Tenta com minScore 0.3
      let result = await testQuery(question, 0.3);
      
      if (!result.success || !result.sources || result.sources.length === 0) {
        // Tenta com minScore 0.5
        console.log('      ⚠️  Nenhum resultado com score 0.3, tentando 0.5...');
        result = await testQuery(question, 0.5);
      }

      const foundCurrentDoc = result.sources?.some(s => s.documentId === doc.id) || false;

      results.push({
        documentId: doc.id,
        documentTitle: doc.title,
        question,
        success: result.success && result.sources && result.sources.length > 0,
        foundCurrentDocument: foundCurrentDoc,
        sourcesCount: result.sources?.length || 0,
        confidence: result.confidence || 0,
        chunksSearched: result.metadata?.chunksSearched || 0,
        chunksFound: result.metadata?.chunksFound || 0,
        error: result.error || null,
      });

      if (result.success && result.sources && result.sources.length > 0) {
        console.log(`      ✅ Sucesso! ${result.sources.length} documento(s) encontrado(s)`);
        console.log(`         Confiança: ${Math.round((result.confidence || 0) * 100)}%`);
        console.log(`         Documento atual encontrado: ${foundCurrentDoc ? 'Sim' : 'Não'}`);
        console.log(`         Chunks pesquisados: ${result.metadata?.chunksSearched || 0}`);
        console.log(`         Chunks encontrados: ${result.metadata?.chunksFound || 0}`);
      } else {
        console.log(`      ❌ Falhou`);
        if (result.error) {
          console.log(`         Erro: ${result.error}`);
        }
        if (result.metadata) {
          console.log(`         Chunks pesquisados: ${result.metadata.chunksSearched || 0}`);
          console.log(`         Chunks encontrados: ${result.metadata.chunksFound || 0}`);
        }
      }

      // Delay para não sobrecarregar
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // 4. Resumo
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 RESUMO DA ANÁLISE');
  console.log('='.repeat(60));
  console.log(`Documentos analisados: ${docsToTest.length}`);
  console.log(`Perguntas testadas: ${results.length}`);
  console.log(`Perguntas com resposta: ${results.filter(r => r.success).length}`);
  console.log(`Perguntas sem resposta: ${results.filter(r => !r.success).length}`);
  console.log(`Taxa de sucesso: ${Math.round((results.filter(r => r.success).length / results.length) * 100) || 0}%`);
  console.log(`Documentos onde o próprio documento foi encontrado: ${results.filter(r => r.foundCurrentDocument).length}`);

  // Estatísticas de chunks
  const totalChunksSearched = results.reduce((sum, r) => sum + (r.chunksSearched || 0), 0);
  const totalChunksFound = results.reduce((sum, r) => sum + (r.chunksFound || 0), 0);
  console.log(`\nChunks pesquisados (total): ${totalChunksSearched}`);
  console.log(`Chunks encontrados (total): ${totalChunksFound}`);

  // Problemas identificados
  console.log('\n' + '='.repeat(60));
  console.log('🔍 DIAGNÓSTICO');
  console.log('='.repeat(60));

  if (totalChunksSearched === 0) {
    console.log('⚠️  PROBLEMA: Nenhum chunk foi pesquisado!');
    console.log('   - Verifique se o serviço RAG está rodando');
    console.log('   - Verifique se os documentos estão indexados no vetor store');
  } else if (totalChunksFound === 0) {
    console.log('⚠️  PROBLEMA: Chunks foram pesquisados mas nenhum foi encontrado!');
    console.log('   - Os documentos podem não estar indexados corretamente');
    console.log('   - O minScore pode estar muito alto');
    console.log('   - O conteúdo pode não corresponder às perguntas');
  } else if (results.filter(r => r.foundCurrentDocument).length === 0) {
    console.log('⚠️  PROBLEMA: Perguntas não encontram o documento de origem!');
    console.log('   - As perguntas geradas podem não corresponder ao conteúdo');
    console.log('   - O embedding pode não estar funcionando corretamente');
  } else {
    console.log('✅ Sistema parece estar funcionando corretamente!');
  }

  console.log('\n');
}

/**
 * Função principal
 */
async function main() {
  try {
    // Login
    const loggedIn = await login();
    if (!loggedIn) {
      console.error('❌ Não foi possível fazer login. Verifique as credenciais.');
      process.exit(1);
    }

    // Analisa documentos
    await analyzeDocuments();
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Executa
if (require.main === module) {
  main();
}

module.exports = { analyzeDocuments, testQuery, generateQuestions };

