#!/usr/bin/env node
/**
 * Script para forçar reindexação de TODOS os documentos RAG
 * Mesmo os que já estão marcados como indexados
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const TENANT_ID = process.env.TENANT_ID;
if (!TENANT_ID) {
  console.error('❌ TENANT_ID é obrigatório (export TENANT_ID=<tenant-id>)');
  process.exit(1);
}
const USERNAME = process.env.USERNAME || 'admin';
const PASSWORD = process.env.PASSWORD || 'Admin123!';

let authToken = null;

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

async function listDocuments() {
  console.log('📚 Listando documentos...');
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

async function reindexDocument(docId) {
  const response = await makeRequest('POST', `/rag/documents/${encodeURIComponent(docId)}/reindex`);
  
  if (response.status === 200) {
    return response.body;
  } else {
    return {
      success: false,
      error: response.body.error || `HTTP ${response.status}`,
    };
  }
}

async function forceReindexAll() {
  console.log('🔄 Iniciando reindexação forçada de TODOS os documentos...\n');

  // 1. Lista documentos
  const documents = await listDocuments();
  const activeDocs = documents.filter(doc => doc.status === 'active' && doc.content);

  console.log(`📋 Documentos ativos com conteúdo: ${activeDocs.length}\n`);

  if (activeDocs.length === 0) {
    console.log('⚠️  Nenhum documento ativo encontrado para reindexar');
    return;
  }

  // 2. Reindexa cada documento
  let indexed = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < activeDocs.length; i++) {
    const doc = activeDocs[i];
    console.log(`[${i + 1}/${activeDocs.length}] Reindexando: ${doc.title || doc.id}`);
    
    const result = await reindexDocument(doc.id);
    
    if (result.success) {
      indexed++;
      console.log(`   ✅ Sucesso! ${result.chunksCreated || 0} chunk(s) criado(s)`);
    } else {
      failed++;
      const errorMsg = result.error || 'Erro desconhecido';
      errors.push({
        documentId: doc.id,
        title: doc.title,
        error: errorMsg,
      });
      console.log(`   ❌ Falhou: ${errorMsg}`);
    }

    // Pequeno delay para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // 3. Resumo
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DA REINDEXAÇÃO');
  console.log('='.repeat(60));
  console.log(`Total de documentos: ${activeDocs.length}`);
  console.log(`✅ Reindexados com sucesso: ${indexed}`);
  console.log(`❌ Falharam: ${failed}`);
  console.log(`Taxa de sucesso: ${Math.round((indexed / activeDocs.length) * 100)}%`);

  if (errors.length > 0) {
    console.log('\n⚠️  ERROS ENCONTRADOS:');
    errors.slice(0, 10).forEach(err => {
      console.log(`   - ${err.title || err.documentId}: ${err.error}`);
    });
    if (errors.length > 10) {
      console.log(`   ... e mais ${errors.length - 10} erro(s)`);
    }
  }

  // 4. Verifica status final
  console.log('\n🔍 Verificando health do RAG (BD vs Vector Store)...');
  const healthResponse = await makeRequest('GET', `/rag/health?tenantId=${encodeURIComponent(TENANT_ID)}`);
  if (healthResponse.status === 200) {
    console.log('✅ Serviço RAG:', healthResponse.body);
  } else {
    console.log('⚠️  Não foi possível verificar o serviço RAG');
  }

  console.log('\n');
}

async function main() {
  try {
    const loggedIn = await login();
    if (!loggedIn) {
      console.error('❌ Não foi possível fazer login. Verifique as credenciais.');
      process.exit(1);
    }

    await forceReindexAll();
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { forceReindexAll };

