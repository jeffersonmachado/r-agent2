#!/usr/bin/env node
/**
 * Script para limpar documentos órfãos do vector store.
 * 
 * Documentos órfãos são documentos que estão no vector store mas não estão mais no BD.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const dataDir = path.join(__dirname, '../api/data');
const documentsFile = path.join(dataDir, 'rag_documents.json');
const metadataFile = path.join(__dirname, '../rag-service/data/vector_store/tenant-demo.metadata.json');
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:8000';
const TENANT_ID = process.env.TENANT_ID || 'tenant-demo';

async function cleanOrphanedDocuments() {
  try {
    console.log('🔍 Identificando documentos órfãos...\n');
    
    // Carrega documentos do BD
    if (!fs.existsSync(documentsFile)) {
      console.error('❌ Arquivo de documentos não encontrado:', documentsFile);
      process.exit(1);
    }
    
    const bdDocs = JSON.parse(fs.readFileSync(documentsFile, 'utf8'));
    const bdDocIds = new Set(
      bdDocs
        .filter(doc => doc.status === 'active')
        .map(doc => doc.id)
    );
    
    console.log(`📊 Documentos ativos no BD: ${bdDocIds.size}`);
    
    // Carrega documentos do vector store
    if (!fs.existsSync(metadataFile)) {
      console.error('❌ Arquivo de metadados não encontrado:', metadataFile);
      process.exit(1);
    }
    
    const vsData = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    const vsDocIds = new Set(
      Object.values(vsData)
        .map(chunk => chunk.documentId)
    );
    
    console.log(`📊 Documentos no Vector Store: ${vsDocIds.size}`);
    
    // Identifica documentos órfãos
    const orphaned = Array.from(vsDocIds).filter(id => !bdDocIds.has(id));
    
    if (orphaned.length === 0) {
      console.log('\n✅ Nenhum documento órfão encontrado!');
      return;
    }
    
    console.log(`\n⚠️  Documentos órfãos encontrados: ${orphaned.length}`);
    console.log(`   IDs: ${orphaned.slice(0, 5).join(', ')}${orphaned.length > 5 ? '...' : ''}\n`);
    
    // Chama o endpoint para remover
    console.log('🧹 Removendo documentos órfãos do vector store...\n');
    
    const url = new URL(`${RAG_SERVICE_URL}/rag/clean-orphans`);
    url.searchParams.set('tenant_id', TENANT_ID);
    
    const requestModule = url.protocol === 'https:' ? https : http;
    
    const postData = JSON.stringify({ document_ids: orphaned });
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = requestModule.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            const result = JSON.parse(data);
            console.log('✅ Limpeza concluída!');
            console.log(`   Documentos removidos: ${result.removedDocuments}`);
            console.log(`   Chunks removidos: ${result.removedChunks}`);
            resolve(result);
          } else {
            console.error(`❌ Erro: ${res.statusCode} ${res.statusMessage}`);
            console.error(`   Resposta: ${data}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ Erro na requisição:', error.message);
        reject(error);
      });
      
      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('❌ Erro ao limpar documentos órfãos:', error.message);
    process.exit(1);
  }
}

// Executa o script
cleanOrphanedDocuments()
  .then(() => {
    console.log('\n✨ Processo concluído!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Falha no processo:', error.message);
    process.exit(1);
  });
