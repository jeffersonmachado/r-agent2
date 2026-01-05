#!/usr/bin/env node

/**
 * Script para otimizar thresholds do RAG baseado em análise de logs
 * 
 * Uso:
 *   node scripts/optimize-rag-thresholds.js < arquivo.log
 *   ou
 *   npm run optimize:rag-thresholds < arquivo.log
 */

const readline = require('readline');
const { execSync } = require('child_process');

// Analisa logs e sugere configurações otimizadas
const analysis = {
  total: 0,
  failed: 0,
  failedByReason: {
    noChunks: 0,
    lowConfidence: 0,
    invalidQuery: 0
  },
  confidence: {
    sum: 0,
    count: 0,
    min: 1.0,
    max: 0.0
  },
  chunksFound: {
    sum: 0,
    count: 0,
    distribution: {}
  },
  queries: []
};

let currentQuery = null;
let currentIntent = null;
let jsonBuffer = '';
let inJsonObject = false;
let currentJsonType = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function tryParseJSONBuffer() {
  if (!jsonBuffer.trim()) return null;
  try {
    return JSON.parse(jsonBuffer);
  } catch (e) {
    return null;
  }
}

rl.on('line', (line) => {
  if (/\[RAGService\] Query expandida com NLP/.test(line)) {
    jsonBuffer = '';
    inJsonObject = true;
    currentJsonType = 'queryExpanded';
    const jsonMatch = line.match(/\{[\s\S]*$/);
    if (jsonMatch) jsonBuffer = jsonMatch[0];
    return;
  }
  
  if (/\[RAGService\] Resposta RAG recebida/.test(line)) {
    jsonBuffer = '';
    inJsonObject = true;
    currentJsonType = 'queryResponse';
    const jsonMatch = line.match(/\{[\s\S]*$/);
    if (jsonMatch) jsonBuffer = jsonMatch[0];
    return;
  }
  
  if (inJsonObject) {
    jsonBuffer += (jsonBuffer ? '\n' : '') + line;
    
    if (line.trim().endsWith('}')) {
      const json = tryParseJSONBuffer();
      if (json) {
        if (currentJsonType === 'queryExpanded' && json.original) {
          currentQuery = json.original;
          currentIntent = json.intent || 'null';
        } else if (currentJsonType === 'queryResponse') {
          analysis.total++;
          
          const success = json.success === true;
          const confidence = json.confidence || 0;
          const chunksFound = json.chunksFound || 0;
          
          if (!success) {
            analysis.failed++;
            
            if (chunksFound === 0) {
              analysis.failedByReason.noChunks++;
            } else if (confidence > 0 && confidence < 0.5) {
              analysis.failedByReason.lowConfidence++;
            } else {
              analysis.failedByReason.invalidQuery++;
            }
          }
          
          if (confidence > 0) {
            analysis.confidence.sum += confidence;
            analysis.confidence.count++;
            analysis.confidence.min = Math.min(analysis.confidence.min, confidence);
            analysis.confidence.max = Math.max(analysis.confidence.max, confidence);
          }
          
          if (chunksFound > 0) {
            analysis.chunksFound.sum += chunksFound;
            analysis.chunksFound.count++;
            analysis.chunksFound.distribution[chunksFound] = 
              (analysis.chunksFound.distribution[chunksFound] || 0) + 1;
          }
          
          analysis.queries.push({
            query: currentQuery,
            success,
            confidence,
            chunksFound
          });
          
          currentQuery = null;
        }
        
        jsonBuffer = '';
        inJsonObject = false;
        currentJsonType = null;
      }
    }
  }
});

rl.on('close', () => {
  const successRate = analysis.total > 0 ? (analysis.total - analysis.failed) / analysis.total : 0;
  const avgConfidence = analysis.confidence.count > 0 
    ? analysis.confidence.sum / analysis.confidence.count 
    : 0;
  const avgChunks = analysis.chunksFound.count > 0
    ? analysis.chunksFound.sum / analysis.chunksFound.count
    : 0;
  
  console.log('\n' + '='.repeat(80));
  console.log('OTIMIZAÇÃO DE THRESHOLDS RAG');
  console.log('='.repeat(80));
  
  console.log('\n📊 ANÁLISE ATUAL');
  console.log('-'.repeat(80));
  console.log(`Total de consultas:        ${analysis.total}`);
  console.log(`Taxa de sucesso:            ${(successRate * 100).toFixed(1)}%`);
  console.log(`Confiança média:           ${avgConfidence.toFixed(4)}`);
  console.log(`Chunks médios:             ${avgChunks.toFixed(1)}`);
  
  console.log('\n❌ CAUSAS DE FALHA');
  console.log('-'.repeat(80));
  console.log(`Sem chunks encontrados:    ${analysis.failedByReason.noChunks} (${((analysis.failedByReason.noChunks / analysis.failed) * 100).toFixed(1)}%)`);
  console.log(`Confiança baixa:           ${analysis.failedByReason.lowConfidence} (${((analysis.failedByReason.lowConfidence / analysis.failed) * 100).toFixed(1)}%)`);
  console.log(`Query inválida/outros:     ${analysis.failedByReason.invalidQuery} (${((analysis.failedByReason.invalidQuery / analysis.failed) * 100).toFixed(1)}%)`);
  
  // Análise de confiança das falhas
  const failedConfidences = analysis.queries
    .filter(q => !q.success && q.confidence > 0)
    .map(q => q.confidence);
  
  const minFailedConfidence = failedConfidences.length > 0 
    ? Math.min(...failedConfidences) 
    : null;
  const maxFailedConfidence = failedConfidences.length > 0
    ? Math.max(...failedConfidences)
    : null;
  
  console.log('\n🎯 RECOMENDAÇÕES DE OTIMIZAÇÃO');
  console.log('='.repeat(80));
  
  const recommendations = [];
  
  // 1. Ajuste de minScore
  if (analysis.failedByReason.noChunks > analysis.failed * 0.5) {
    const suggestedMinScore = Math.max(0.3, avgConfidence - 0.15);
    recommendations.push({
      priority: 'ALTA',
      parameter: 'minScore',
      current: 0.5,
      suggested: suggestedMinScore.toFixed(2),
      reason: `${analysis.failedByReason.noChunks} falhas por falta de chunks (${((analysis.failedByReason.noChunks / analysis.failed) * 100).toFixed(1)}% das falhas)`
    });
  }
  
  // 2. Ajuste de topK
  if (avgChunks < 3) {
    const suggestedTopK = Math.min(10, Math.ceil(avgChunks * 1.5));
    recommendations.push({
      priority: 'MÉDIA',
      parameter: 'topK',
      current: 5,
      suggested: suggestedTopK,
      reason: `Média de chunks encontrados baixa (${avgChunks.toFixed(1)}). Aumentar topK pode ajudar.`
    });
  }
  
  // 3. Ajuste de ragMinConfidence
  if (analysis.failedByReason.lowConfidence > 0 && minFailedConfidence) {
    const suggestedConfidence = Math.max(0.3, minFailedConfidence - 0.1);
    recommendations.push({
      priority: 'ALTA',
      parameter: 'ragMinConfidence',
      current: 0.5,
      suggested: suggestedConfidence.toFixed(2),
      reason: `${analysis.failedByReason.lowConfidence} falhas por confiança baixa. Confiança mínima das falhas: ${minFailedConfidence.toFixed(3)}`
    });
  }
  
  // 4. Taxa de sucesso geral
  if (successRate < 0.7) {
    recommendations.push({
      priority: 'CRÍTICA',
      parameter: 'Múltiplos',
      current: 'N/A',
      suggested: 'Ver estratégias no guia',
      reason: `Taxa de sucesso muito baixa (${(successRate * 100).toFixed(1)}%). Considere múltiplas otimizações.`
    });
  }
  
  if (recommendations.length === 0) {
    console.log('\n✅ Sistema está bem configurado!');
    console.log('   Não foram encontradas otimizações críticas necessárias.');
  } else {
    recommendations.forEach((rec, i) => {
      const icon = rec.priority === 'CRÍTICA' ? '🚨' : rec.priority === 'ALTA' ? '⚠️' : 'ℹ️';
      console.log(`\n${i + 1}. ${icon} [${rec.priority}] ${rec.parameter}`);
      console.log(`   Atual: ${rec.current}`);
      console.log(`   Sugerido: ${rec.suggested}`);
      console.log(`   Motivo: ${rec.reason}`);
    });
  }
  
  // Gera configuração sugerida
  console.log('\n📝 CONFIGURAÇÃO SUGERIDA');
  console.log('='.repeat(80));
  
  const suggestedConfig = {
    ragTopK: recommendations.find(r => r.parameter === 'topK')?.suggested || 5,
    ragMinConfidence: recommendations.find(r => r.parameter === 'ragMinConfidence')?.suggested || 0.5,
    minScore: recommendations.find(r => r.parameter === 'minScore')?.suggested || 0.5
  };
  
  console.log('\n// No nó AI ou configuração global:');
  console.log(JSON.stringify(suggestedConfig, null, 2));
  
  console.log('\n// Ou no arquivo de configuração do nó:');
  console.log(`{`);
  console.log(`  "config": {`);
  console.log(`    "ragTopK": ${suggestedConfig.ragTopK},`);
  console.log(`    "ragMinConfidence": ${suggestedConfig.ragMinConfidence},`);
  console.log(`    "ragMaxTokens": 1000`);
  console.log(`  }`);
  console.log(`}`);
  
  console.log('\n// E no serviço RAG (rag-service/config/settings.py):');
  console.log(`default_min_score: float = ${suggestedConfig.minScore}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('⚠️  IMPORTANTE: Teste essas configurações em ambiente de desenvolvimento');
  console.log('   antes de aplicar em produção. Monitore a taxa de sucesso e confiança média.');
  console.log('='.repeat(80));
});

