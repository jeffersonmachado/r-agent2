#!/usr/bin/env node

/**
 * Script para analisar logs de consultas RAG
 * 
 * Uso:
 *   node scripts/analyze-rag-logs.js < arquivo.log
 *   ou
 *   npm run analyze:rag-logs < arquivo.log
 */

const readline = require('readline');

// Thresholds e critérios de qualidade
const THRESHOLDS = {
  MIN_CONFIDENCE: 0.5,        // Confiança mínima aceitável (ragMinConfidence padrão)
  GOOD_CONFIDENCE: 0.7,       // Confiança considerada boa (recebe bônus no código)
  EXCELLENT_CONFIDENCE: 0.8,  // Confiança excelente
  MIN_CHUNKS: 3,              // Mínimo de chunks esperados
  EXPECTED_CHUNKS: 5,         // Número esperado de chunks (topK padrão)
  MIN_SUCCESS_RATE: 0.7,      // Taxa de sucesso mínima aceitável (70%)
  GOOD_SUCCESS_RATE: 0.85,   // Taxa de sucesso considerada boa (85%)
};

// Estatísticas
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  byIntent: {},
  byQueryType: {
    uuid: 0,
    image: 0,
    text: 0,
    other: 0
  },
  confidence: {
    min: 1.0,
    max: 0.0,
    sum: 0.0,
    count: 0,
    distribution: {
      low: 0,      // < 0.5
      medium: 0,   // 0.5 - 0.7
      good: 0,     // 0.7 - 0.8
      excellent: 0 // >= 0.8
    }
  },
  chunksFound: {
    min: Infinity,
    max: 0,
    sum: 0,
    count: 0,
    distribution: {
      none: 0,     // 0 chunks
      low: 0,      // 1-2 chunks
      medium: 0,   // 3-4 chunks
      good: 0      // >= 5 chunks
    }
  },
  qualityIssues: {
    lowConfidenceSuccess: [],  // Sucesso mas confiança < threshold
    highConfidenceFailure: [], // Falha mas confiança alta (anomalia)
    noChunksSuccess: [],       // Sucesso sem chunks (anomalia)
    manyChunksFailure: []       // Falha com muitos chunks (anomalia)
  },
  failedQueries: [],
  successfulQueries: []
};

// Padrões para extrair informações dos logs
const patterns = {
  queryExpanded: /\[RAGService\] Query expandida com NLP/,
  queryConsulting: /\[RAGService\] Consultando RAG/,
  queryResponse: /\[RAGService\] Resposta RAG recebida/,
  jsonObject: /\{[\s\S]*?\}(?=\n|$)/g
};

function isUUID(str) {
  const uuidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  return uuidPattern.test(str);
}

function containsUUID(str) {
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  return uuidPattern.test(str);
}

function classifyQuery(query) {
  if (!query) return 'other';
  
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.startsWith('[imagem:')) {
    return 'image';
  }
  
  if (isUUID(query.trim())) {
    return 'uuid';
  }
  
  if (containsUUID(query)) {
    // Verifica se é uma pergunta sobre UUID
    const uuidMatch = query.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      const beforeUUID = query.substring(0, query.indexOf(uuidMatch[0])).trim();
      if (/^(o que é|como funciona|o que|quem é|onde está)/i.test(beforeUUID)) {
        return 'uuid';
      }
    }
  }
  
  return 'text';
}

function parseJSONFromLine(line) {
  try {
    // Tenta encontrar objeto JSON na linha
    const match = line.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    // Ignora erros de parsing
  }
  return null;
}

let currentQuery = null;
let currentIntent = null;
let currentQueryType = null;
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
    // JSON ainda não está completo
    return null;
  }
}

rl.on('line', (line) => {
  // Detecta início de query expandida
  if (patterns.queryExpanded.test(line)) {
    jsonBuffer = '';
    inJsonObject = true;
    currentJsonType = 'queryExpanded';
    // Tenta extrair JSON da mesma linha
    const jsonMatch = line.match(/\{[\s\S]*$/);
    if (jsonMatch) {
      jsonBuffer = jsonMatch[0];
    }
    return;
  }
  
  // Detecta início de resposta RAG
  if (patterns.queryResponse.test(line)) {
    jsonBuffer = '';
    inJsonObject = true;
    currentJsonType = 'queryResponse';
    // Tenta extrair JSON da mesma linha
    const jsonMatch = line.match(/\{[\s\S]*$/);
    if (jsonMatch) {
      jsonBuffer = jsonMatch[0];
    }
    return;
  }
  
  // Se estamos dentro de um objeto JSON, acumula linhas
  if (inJsonObject) {
    jsonBuffer += (jsonBuffer ? '\n' : '') + line;
    
    // Tenta parsear quando encontrar fechamento do objeto
    if (line.trim().endsWith('}')) {
      const json = tryParseJSONBuffer();
      if (json) {
        if (currentJsonType === 'queryExpanded' && json.original) {
          currentQuery = json.original;
          currentIntent = json.intent || 'null';
          currentQueryType = classifyQuery(currentQuery);
          
          if (!stats.byIntent[currentIntent]) {
            stats.byIntent[currentIntent] = { total: 0, success: 0, failed: 0 };
          }
          stats.byIntent[currentIntent].total++;
        } else if (currentJsonType === 'queryResponse') {
          stats.total++;
          
          const success = json.success === true;
          const confidence = json.confidence || 0;
          const chunksFound = json.chunksFound || 0;
          
          if (success) {
            stats.success++;
            if (currentIntent) {
              stats.byIntent[currentIntent].success++;
            }
            if (currentQuery) {
              stats.successfulQueries.push({
                query: currentQuery.substring(0, 100),
                confidence,
                chunksFound,
                type: currentQueryType
              });
            }
          } else {
            stats.failed++;
            if (currentIntent) {
              stats.byIntent[currentIntent].failed++;
            }
            if (currentQuery) {
              stats.failedQueries.push({
                query: currentQuery.substring(0, 100),
                confidence,
                chunksFound,
                type: currentQueryType
              });
            }
          }
          
          // Atualiza estatísticas de confiança
          if (confidence > 0) {
            stats.confidence.min = Math.min(stats.confidence.min, confidence);
            stats.confidence.max = Math.max(stats.confidence.max, confidence);
            stats.confidence.sum += confidence;
            stats.confidence.count++;
            
            // Distribuição de confiança
            if (confidence < THRESHOLDS.MIN_CONFIDENCE) {
              stats.confidence.distribution.low++;
            } else if (confidence < THRESHOLDS.GOOD_CONFIDENCE) {
              stats.confidence.distribution.medium++;
            } else if (confidence < THRESHOLDS.EXCELLENT_CONFIDENCE) {
              stats.confidence.distribution.good++;
            } else {
              stats.confidence.distribution.excellent++;
            }
          }
          
          // Atualiza estatísticas de chunks
          if (chunksFound > 0) {
            stats.chunksFound.min = Math.min(stats.chunksFound.min, chunksFound);
            stats.chunksFound.max = Math.max(stats.chunksFound.max, chunksFound);
            stats.chunksFound.sum += chunksFound;
            stats.chunksFound.count++;
          }
          
          // Distribuição de chunks
          if (chunksFound === 0) {
            stats.chunksFound.distribution.none++;
          } else if (chunksFound < 3) {
            stats.chunksFound.distribution.low++;
          } else if (chunksFound < 5) {
            stats.chunksFound.distribution.medium++;
          } else {
            stats.chunksFound.distribution.good++;
          }
          
          // Detecta problemas de qualidade
          if (success) {
            // Sucesso com confiança baixa (pode ser falso positivo)
            if (confidence > 0 && confidence < THRESHOLDS.MIN_CONFIDENCE) {
              stats.qualityIssues.lowConfidenceSuccess.push({
                query: currentQuery ? currentQuery.substring(0, 100) : 'N/A',
                confidence,
                chunksFound,
                type: currentQueryType
              });
            }
            // Sucesso sem chunks (anomalia)
            if (chunksFound === 0) {
              stats.qualityIssues.noChunksSuccess.push({
                query: currentQuery ? currentQuery.substring(0, 100) : 'N/A',
                confidence,
                chunksFound,
                type: currentQueryType
              });
            }
          } else {
            // Falha com confiança alta (anomalia)
            if (confidence >= THRESHOLDS.GOOD_CONFIDENCE) {
              stats.qualityIssues.highConfidenceFailure.push({
                query: currentQuery ? currentQuery.substring(0, 100) : 'N/A',
                confidence,
                chunksFound,
                type: currentQueryType
              });
            }
            // Falha com muitos chunks (anomalia)
            if (chunksFound >= THRESHOLDS.EXPECTED_CHUNKS) {
              stats.qualityIssues.manyChunksFailure.push({
                query: currentQuery ? currentQuery.substring(0, 100) : 'N/A',
                confidence,
                chunksFound,
                type: currentQueryType
              });
            }
          }
          
          // Atualiza estatísticas por tipo de query
          if (currentQueryType) {
            stats.byQueryType[currentQueryType]++;
          }
          
          // Reset
          currentQuery = null;
          currentIntent = null;
          currentQueryType = null;
        }
        
        // Reset buffer
        jsonBuffer = '';
        inJsonObject = false;
        currentJsonType = null;
      }
    }
  }
});

rl.on('close', () => {
  // Calcula médias
  const avgConfidence = stats.confidence.count > 0 
    ? stats.confidence.sum / stats.confidence.count 
    : 0;
  const avgChunksFound = stats.chunksFound.count > 0
    ? stats.chunksFound.sum / stats.chunksFound.count
    : 0;
  
  // Exibe relatório
  console.log('\n' + '='.repeat(80));
  console.log('ANÁLISE DE LOGS RAG');
  console.log('='.repeat(80));
  
  console.log('\n📊 ESTATÍSTICAS GERAIS');
  console.log('-'.repeat(80));
  console.log(`Total de consultas:        ${stats.total}`);
  console.log(`Consultas bem-sucedidas:   ${stats.success} (${((stats.success / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Consultas falhadas:          ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)`);
  
  console.log('\n📈 CONFIANÇA');
  console.log('-'.repeat(80));
  if (stats.confidence.count > 0) {
    console.log(`Média:                     ${avgConfidence.toFixed(4)}`);
    console.log(`Mínima:                    ${stats.confidence.min.toFixed(4)}`);
    console.log(`Máxima:                    ${stats.confidence.max.toFixed(4)}`);
  } else {
    console.log('Nenhuma consulta com confiança > 0');
  }
  
  console.log('\n📦 CHUNKS ENCONTRADOS');
  console.log('-'.repeat(80));
  if (stats.chunksFound.count > 0) {
    console.log(`Média:                     ${avgChunksFound.toFixed(1)}`);
    console.log(`Mínimo:                    ${stats.chunksFound.min}`);
    console.log(`Máximo:                    ${stats.chunksFound.max}`);
  } else {
    console.log('Nenhum chunk encontrado');
  }
  
  console.log('\n🔍 POR TIPO DE QUERY');
  console.log('-'.repeat(80));
  Object.entries(stats.byQueryType).forEach(([type, count]) => {
    const percentage = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : 0;
    console.log(`${type.padEnd(20)} ${count.toString().padStart(5)} (${percentage}%)`);
  });
  
  console.log('\n💡 POR INTENT');
  console.log('-'.repeat(80));
  Object.entries(stats.byIntent)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([intent, data]) => {
      const successRate = data.total > 0 ? ((data.success / data.total) * 100).toFixed(1) : 0;
      console.log(`${(intent || 'null').padEnd(20)} Total: ${data.total.toString().padStart(3)} | Sucesso: ${data.success.toString().padStart(3)} (${successRate}%) | Falhas: ${data.failed.toString().padStart(3)}`);
    });
  
  // Top 10 consultas falhadas
  if (stats.failedQueries.length > 0) {
    console.log('\n❌ TOP 10 CONSULTAS FALHADAS');
    console.log('-'.repeat(80));
    stats.failedQueries
      .slice(0, 10)
      .forEach((q, i) => {
        console.log(`${(i + 1).toString().padStart(2)}. [${q.type}] ${q.query}`);
      });
  }
  
  // Top 10 consultas bem-sucedidas
  if (stats.successfulQueries.length > 0) {
    console.log('\n✅ TOP 10 CONSULTAS BEM-SUCEDIDAS (por confiança)');
    console.log('-'.repeat(80));
    stats.successfulQueries
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .forEach((q, i) => {
        console.log(`${(i + 1).toString().padStart(2)}. [${q.type}] Conf: ${q.confidence.toFixed(3)} | Chunks: ${q.chunksFound} | ${q.query}`);
      });
  }
  
  // Distribuição de confiança
  console.log('\n📊 DISTRIBUIÇÃO DE CONFIANÇA');
  console.log('-'.repeat(80));
  if (stats.confidence.count > 0) {
    const total = stats.confidence.count;
    console.log(`Baixa (< ${THRESHOLDS.MIN_CONFIDENCE}):     ${stats.confidence.distribution.low.toString().padStart(4)} (${((stats.confidence.distribution.low / total) * 100).toFixed(1)}%)`);
    console.log(`Média (${THRESHOLDS.MIN_CONFIDENCE}-${THRESHOLDS.GOOD_CONFIDENCE}):  ${stats.confidence.distribution.medium.toString().padStart(4)} (${((stats.confidence.distribution.medium / total) * 100).toFixed(1)}%)`);
    console.log(`Boa (${THRESHOLDS.GOOD_CONFIDENCE}-${THRESHOLDS.EXCELLENT_CONFIDENCE}):   ${stats.confidence.distribution.good.toString().padStart(4)} (${((stats.confidence.distribution.good / total) * 100).toFixed(1)}%)`);
    console.log(`Excelente (>= ${THRESHOLDS.EXCELLENT_CONFIDENCE}): ${stats.confidence.distribution.excellent.toString().padStart(4)} (${((stats.confidence.distribution.excellent / total) * 100).toFixed(1)}%)`);
  } else {
    console.log('Nenhuma consulta com confiança > 0');
  }
  
  // Distribuição de chunks
  console.log('\n📦 DISTRIBUIÇÃO DE CHUNKS');
  console.log('-'.repeat(80));
  const totalChunks = stats.chunksFound.distribution.none + 
                      stats.chunksFound.distribution.low + 
                      stats.chunksFound.distribution.medium + 
                      stats.chunksFound.distribution.good;
  if (totalChunks > 0) {
    console.log(`Nenhum chunk:              ${stats.chunksFound.distribution.none.toString().padStart(4)} (${((stats.chunksFound.distribution.none / totalChunks) * 100).toFixed(1)}%)`);
    console.log(`Poucos (1-2):              ${stats.chunksFound.distribution.low.toString().padStart(4)} (${((stats.chunksFound.distribution.low / totalChunks) * 100).toFixed(1)}%)`);
    console.log(`Médio (3-4):               ${stats.chunksFound.distribution.medium.toString().padStart(4)} (${((stats.chunksFound.distribution.medium / totalChunks) * 100).toFixed(1)}%)`);
    console.log(`Bom (>= ${THRESHOLDS.EXPECTED_CHUNKS}):              ${stats.chunksFound.distribution.good.toString().padStart(4)} (${((stats.chunksFound.distribution.good / totalChunks) * 100).toFixed(1)}%)`);
  } else {
    console.log('Nenhum chunk encontrado');
  }
  
  // Análise assertiva de problemas
  console.log('\n🔍 ANÁLISE ASSERTIVA DE PROBLEMAS');
  console.log('='.repeat(80));
  
  const successRate = stats.total > 0 ? stats.success / stats.total : 0;
  const issues = [];
  const warnings = [];
  const info = [];
  
  // 1. Taxa de sucesso
  if (successRate < THRESHOLDS.MIN_SUCCESS_RATE) {
    issues.push({
      severity: 'CRÍTICO',
      message: `Taxa de sucesso muito baixa: ${(successRate * 100).toFixed(1)}% (mínimo esperado: ${THRESHOLDS.MIN_SUCCESS_RATE * 100}%)`,
      action: 'Revisar configuração do RAG, qualidade dos documentos indexados e thresholds de confiança'
    });
  } else if (successRate < THRESHOLDS.GOOD_SUCCESS_RATE) {
    warnings.push({
      severity: 'ATENÇÃO',
      message: `Taxa de sucesso abaixo do ideal: ${(successRate * 100).toFixed(1)}% (ideal: ${THRESHOLDS.GOOD_SUCCESS_RATE * 100}%)`,
      action: 'Considerar melhorar qualidade dos documentos ou ajustar minScore'
    });
  } else {
    info.push({
      severity: 'OK',
      message: `Taxa de sucesso adequada: ${(successRate * 100).toFixed(1)}%`
    });
  }
  
  // 2. Confiança média
  if (avgConfidence > 0) {
    if (avgConfidence < THRESHOLDS.MIN_CONFIDENCE) {
      issues.push({
        severity: 'CRÍTICO',
        message: `Confiança média muito baixa: ${avgConfidence.toFixed(4)} (mínimo esperado: ${THRESHOLDS.MIN_CONFIDENCE})`,
        action: 'Revisar qualidade dos embeddings, documentos indexados e considerar reduzir minScore'
      });
    } else if (avgConfidence < THRESHOLDS.GOOD_CONFIDENCE) {
      warnings.push({
        severity: 'ATENÇÃO',
        message: `Confiança média abaixo do ideal: ${avgConfidence.toFixed(4)} (ideal: >= ${THRESHOLDS.GOOD_CONFIDENCE})`,
        action: 'Melhorar qualidade dos documentos ou ajustar estratégia de busca'
      });
    }
  }
  
  // 3. Problemas de qualidade específicos
  if (stats.qualityIssues.lowConfidenceSuccess.length > 0) {
    issues.push({
      severity: 'CRÍTICO',
      message: `${stats.qualityIssues.lowConfidenceSuccess.length} consulta(s) marcada(s) como sucesso com confiança < ${THRESHOLDS.MIN_CONFIDENCE}`,
      action: 'Revisar lógica de decisão de sucesso/falha no serviço RAG'
    });
  }
  
  if (stats.qualityIssues.highConfidenceFailure.length > 0) {
    issues.push({
      severity: 'CRÍTICO',
      message: `${stats.qualityIssues.highConfidenceFailure.length} consulta(s) falhada(s) com confiança >= ${THRESHOLDS.GOOD_CONFIDENCE} (anomalia)`,
      action: 'Investigar por que consultas com alta confiança estão falhando'
    });
  }
  
  if (stats.qualityIssues.noChunksSuccess.length > 0) {
    issues.push({
      severity: 'CRÍTICO',
      message: `${stats.qualityIssues.noChunksSuccess.length} consulta(s) marcada(s) como sucesso sem chunks encontrados (anomalia)`,
      action: 'Revisar lógica de validação de sucesso no serviço RAG'
    });
  }
  
  if (stats.qualityIssues.manyChunksFailure.length > 0) {
    warnings.push({
      severity: 'ATENÇÃO',
      message: `${stats.qualityIssues.manyChunksFailure.length} consulta(s) falhada(s) com ${THRESHOLDS.EXPECTED_CHUNKS}+ chunks encontrados`,
      action: 'Investigar por que consultas com chunks suficientes estão falhando'
    });
  }
  
  // 4. Análise por tipo de query
  const uuidFailures = stats.failedQueries.filter(q => q.type === 'uuid').length;
  const textFailures = stats.failedQueries.filter(q => q.type === 'text').length;
  const imageSuccesses = stats.successfulQueries.filter(q => q.type === 'image').length;
  
  if (uuidFailures > 0) {
    info.push({
      severity: 'ESPERADO',
      message: `${uuidFailures} consulta(s) sobre UUIDs rejeitada(s) corretamente`,
      action: 'Comportamento esperado - UUIDs puros devem ser rejeitados'
    });
  }
  
  if (textFailures > 0) {
    const textFailureRate = stats.byQueryType.text > 0 
      ? (textFailures / stats.byQueryType.text) * 100 
      : 0;
    if (textFailureRate > 20) {
      issues.push({
        severity: 'CRÍTICO',
        message: `${textFailures} consulta(s) de texto falharam (${textFailureRate.toFixed(1)}% das consultas de texto)`,
        action: 'Revisar qualidade dos documentos indexados e considerar reduzir minScore para consultas de texto'
      });
    } else {
      warnings.push({
        severity: 'ATENÇÃO',
        message: `${textFailures} consulta(s) de texto falharam`,
        action: 'Revisar essas consultas específicas para entender padrões de falha'
      });
    }
  }
  
  if (imageSuccesses > 0) {
    info.push({
      severity: 'OK',
      message: `${imageSuccesses} consulta(s) sobre imagens processada(s) com sucesso`
    });
  }
  
  // 5. Chunks encontrados
  if (avgChunksFound > 0 && avgChunksFound < THRESHOLDS.MIN_CHUNKS) {
    warnings.push({
      severity: 'ATENÇÃO',
      message: `Média de chunks encontrados baixa: ${avgChunksFound.toFixed(1)} (esperado: >= ${THRESHOLDS.MIN_CHUNKS})`,
      action: 'Considerar aumentar topK ou melhorar qualidade dos documentos'
    });
  }
  
  // Exibe problemas por prioridade
  if (issues.length > 0) {
    console.log('\n🚨 PROBLEMAS CRÍTICOS (Ação Imediata Necessária)');
    console.log('-'.repeat(80));
    issues.forEach((issue, i) => {
      console.log(`\n${i + 1}. [${issue.severity}] ${issue.message}`);
      console.log(`   Ação: ${issue.action}`);
    });
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  AVISOS (Revisar Quando Possível)');
    console.log('-'.repeat(80));
    warnings.forEach((warning, i) => {
      console.log(`\n${i + 1}. [${warning.severity}] ${warning.message}`);
      console.log(`   Ação: ${warning.action}`);
    });
  }
  
  if (info.length > 0) {
    console.log('\nℹ️  INFORMAÇÕES');
    console.log('-'.repeat(80));
    info.forEach((item, i) => {
      console.log(`${i + 1}. [${item.severity}] ${item.message}`);
      if (item.action) {
        console.log(`   ${item.action}`);
      }
    });
  }
  
  // Detalhes de anomalias
  if (stats.qualityIssues.lowConfidenceSuccess.length > 0) {
    console.log('\n🔴 CONSULTAS COM SUCESSO MAS CONFIANÇA BAIXA');
    console.log('-'.repeat(80));
    stats.qualityIssues.lowConfidenceSuccess.slice(0, 5).forEach((q, i) => {
      console.log(`${(i + 1).toString().padStart(2)}. [${q.type}] Conf: ${q.confidence.toFixed(3)} | Chunks: ${q.chunksFound} | ${q.query}`);
    });
    if (stats.qualityIssues.lowConfidenceSuccess.length > 5) {
      console.log(`   ... e mais ${stats.qualityIssues.lowConfidenceSuccess.length - 5} consulta(s)`);
    }
  }
  
  if (stats.qualityIssues.highConfidenceFailure.length > 0) {
    console.log('\n🔴 CONSULTAS FALHADAS COM ALTA CONFIANÇA (ANOMALIA)');
    console.log('-'.repeat(80));
    stats.qualityIssues.highConfidenceFailure.slice(0, 5).forEach((q, i) => {
      console.log(`${(i + 1).toString().padStart(2)}. [${q.type}] Conf: ${q.confidence.toFixed(3)} | Chunks: ${q.chunksFound} | ${q.query}`);
    });
    if (stats.qualityIssues.highConfidenceFailure.length > 5) {
      console.log(`   ... e mais ${stats.qualityIssues.highConfidenceFailure.length - 5} consulta(s)`);
    }
  }
  
  // Resumo executivo
  console.log('\n' + '='.repeat(80));
  console.log('📋 RESUMO EXECUTIVO');
  console.log('='.repeat(80));
  console.log(`Total de consultas analisadas: ${stats.total}`);
  console.log(`Taxa de sucesso: ${(successRate * 100).toFixed(1)}% ${successRate >= THRESHOLDS.GOOD_SUCCESS_RATE ? '✅' : successRate >= THRESHOLDS.MIN_SUCCESS_RATE ? '⚠️' : '❌'}`);
  console.log(`Confiança média: ${avgConfidence > 0 ? avgConfidence.toFixed(4) : 'N/A'} ${avgConfidence >= THRESHOLDS.GOOD_CONFIDENCE ? '✅' : avgConfidence >= THRESHOLDS.MIN_CONFIDENCE ? '⚠️' : '❌'}`);
  console.log(`Chunks médios: ${avgChunksFound > 0 ? avgChunksFound.toFixed(1) : 'N/A'} ${avgChunksFound >= THRESHOLDS.EXPECTED_CHUNKS ? '✅' : avgChunksFound >= THRESHOLDS.MIN_CHUNKS ? '⚠️' : '❌'}`);
  console.log(`Problemas críticos: ${issues.length}`);
  console.log(`Avisos: ${warnings.length}`);
  console.log(`Anomalias detectadas: ${stats.qualityIssues.lowConfidenceSuccess.length + stats.qualityIssues.highConfidenceFailure.length + stats.qualityIssues.noChunksSuccess.length + stats.qualityIssues.manyChunksFailure.length}`);
  console.log('='.repeat(80));
});

