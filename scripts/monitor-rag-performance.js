#!/usr/bin/env node

/**
 * Script para monitorar performance do RAG em tempo real
 * 
 * Uso:
 *   node scripts/monitor-rag-performance.js
 *   ou
 *   npm run monitor:rag
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Configuração
const LOG_FILE = process.env.RAG_LOG_FILE || 'api/logs/app.log';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '5000', 10); // 5 segundos
const WINDOW_SIZE = parseInt(process.env.WINDOW_SIZE || '100', 10); // Últimas 100 consultas

// Métricas em tempo real
const metrics = {
  window: [],
  total: 0,
  success: 0,
  failed: 0,
  avgConfidence: 0,
  avgChunks: 0,
  lastUpdate: new Date()
};

// Thresholds de alerta
const ALERTS = {
  LOW_SUCCESS_RATE: 0.7,      // Taxa de sucesso < 70%
  LOW_AVG_CONFIDENCE: 0.5,    // Confiança média < 0.5
  HIGH_FAILURE_RATE: 0.3      // Taxa de falha > 30%
};

function parseLogLine(line) {
  // Procura por linhas de resposta RAG
  if (!line.includes('[RAGService] Resposta RAG recebida')) {
    return null;
  }
  
  try {
    // Extrai JSON da linha
    const jsonMatch = line.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const data = JSON.parse(jsonMatch[0]);
    return {
      success: data.success === true,
      confidence: data.confidence || 0,
      chunksFound: data.chunksFound || 0,
      timestamp: new Date()
    };
  } catch (e) {
    return null;
  }
}

function updateMetrics(data) {
  metrics.window.push(data);
  
  // Mantém apenas últimas N consultas
  if (metrics.window.length > WINDOW_SIZE) {
    metrics.window.shift();
  }
  
  // Recalcula métricas
  metrics.total = metrics.window.length;
  metrics.success = metrics.window.filter(d => d.success).length;
  metrics.failed = metrics.total - metrics.success;
  
  const successful = metrics.window.filter(d => d.success && d.confidence > 0);
  if (successful.length > 0) {
    metrics.avgConfidence = successful.reduce((sum, d) => sum + d.confidence, 0) / successful.length;
  }
  
  const withChunks = metrics.window.filter(d => d.chunksFound > 0);
  if (withChunks.length > 0) {
    metrics.avgChunks = withChunks.reduce((sum, d) => sum + d.chunksFound, 0) / withChunks.length;
  }
  
  metrics.lastUpdate = new Date();
}

function checkAlerts() {
  const successRate = metrics.total > 0 ? metrics.success / metrics.total : 0;
  const failureRate = 1 - successRate;
  const alerts = [];
  
  if (successRate < ALERTS.LOW_SUCCESS_RATE && metrics.total >= 10) {
    alerts.push({
      level: 'CRÍTICO',
      message: `Taxa de sucesso baixa: ${(successRate * 100).toFixed(1)}%`,
      action: 'Revisar configurações RAG ou qualidade dos documentos'
    });
  }
  
  if (metrics.avgConfidence < ALERTS.LOW_AVG_CONFIDENCE && metrics.total >= 10) {
    alerts.push({
      level: 'ATENÇÃO',
      message: `Confiança média baixa: ${metrics.avgConfidence.toFixed(3)}`,
      action: 'Considerar reduzir minScore ou melhorar documentos'
    });
  }
  
  if (failureRate > ALERTS.HIGH_FAILURE_RATE && metrics.total >= 10) {
    alerts.push({
      level: 'CRÍTICO',
      message: `Taxa de falha alta: ${(failureRate * 100).toFixed(1)}%`,
      action: 'Executar npm run optimize:rag-thresholds para obter recomendações'
    });
  }
  
  return alerts;
}

function displayMetrics() {
  // Limpa console
  process.stdout.write('\x1B[2J\x1B[0f');
  
  console.log('='.repeat(80));
  console.log('📊 MONITORAMENTO RAG - TEMPO REAL');
  console.log('='.repeat(80));
  console.log(`Última atualização: ${metrics.lastUpdate.toLocaleTimeString()}`);
  console.log(`Janela de análise: últimas ${metrics.total} consultas (máx: ${WINDOW_SIZE})`);
  console.log('');
  
  const successRate = metrics.total > 0 ? (metrics.success / metrics.total) * 100 : 0;
  const failureRate = 100 - successRate;
  
  console.log('📈 MÉTRICAS GERAIS');
  console.log('-'.repeat(80));
  console.log(`Total de consultas:        ${metrics.total}`);
  console.log(`Taxa de sucesso:           ${successRate.toFixed(1)}% ${successRate >= 85 ? '✅' : successRate >= 70 ? '⚠️' : '❌'}`);
  console.log(`Taxa de falha:             ${failureRate.toFixed(1)}%`);
  console.log(`Confiança média:           ${metrics.avgConfidence.toFixed(4)} ${metrics.avgConfidence >= 0.7 ? '✅' : metrics.avgConfidence >= 0.5 ? '⚠️' : '❌'}`);
  console.log(`Chunks médios:             ${metrics.avgChunks.toFixed(1)}`);
  console.log('');
  
  // Alertas
  const alerts = checkAlerts();
  if (alerts.length > 0) {
    console.log('🚨 ALERTAS');
    console.log('-'.repeat(80));
    alerts.forEach((alert, i) => {
      const icon = alert.level === 'CRÍTICO' ? '🔴' : '🟡';
      console.log(`${i + 1}. ${icon} [${alert.level}] ${alert.message}`);
      console.log(`   Ação: ${alert.action}`);
    });
    console.log('');
  } else {
    console.log('✅ Nenhum alerta - Sistema operando normalmente');
    console.log('');
  }
  
  // Distribuição recente (últimas 20)
  if (metrics.window.length > 0) {
    const recent = metrics.window.slice(-20);
    const recentSuccess = recent.filter(d => d.success).length;
    const recentRate = (recentSuccess / recent.length) * 100;
    
    console.log('📊 TENDÊNCIA RECENTE (últimas 20 consultas)');
    console.log('-'.repeat(80));
    console.log(`Taxa de sucesso:           ${recentRate.toFixed(1)}%`);
    console.log(`Tendência:                 ${recentRate > successRate ? '📈 Melhorando' : recentRate < successRate ? '📉 Piorando' : '➡️ Estável'}`);
    console.log('');
  }
  
  console.log('='.repeat(80));
  console.log('Pressione Ctrl+C para parar');
  console.log('='.repeat(80));
}

function watchLogFile() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Arquivo de log não encontrado: ${LOG_FILE}`);
    console.error('Configure RAG_LOG_FILE ou verifique o caminho do log');
    process.exit(1);
  }
  
  let lastSize = fs.statSync(LOG_FILE).size;
  let buffer = '';
  
  const stream = fs.createReadStream(LOG_FILE, { start: lastSize });
  
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Mantém linha incompleta
    
    lines.forEach(line => {
      const data = parseLogLine(line);
      if (data) {
        updateMetrics(data);
      }
    });
  });
  
  stream.on('error', (err) => {
    if (err.code === 'ENOENT') {
      // Arquivo pode ter sido rotacionado, tenta novamente
      setTimeout(() => {
        if (fs.existsSync(LOG_FILE)) {
          lastSize = 0;
          watchLogFile();
        }
      }, 1000);
    } else {
      console.error('Erro ao ler log:', err.message);
    }
  });
  
  // Atualiza display a cada intervalo
  setInterval(() => {
    displayMetrics();
  }, CHECK_INTERVAL);
  
  // Display inicial
  displayMetrics();
}

// Modo alternativo: ler stdin (útil para pipes)
if (process.stdin.isTTY) {
  // Modo arquivo
  watchLogFile();
} else {
  // Modo stdin
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  
  rl.on('line', (line) => {
    const data = parseLogLine(line);
    if (data) {
      updateMetrics(data);
    }
  });
  
  setInterval(() => {
    displayMetrics();
  }, CHECK_INTERVAL);
  
  displayMetrics();
}

// Tratamento de saída
process.on('SIGINT', () => {
  console.log('\n\n📊 RESUMO FINAL');
  console.log('='.repeat(80));
  const successRate = metrics.total > 0 ? (metrics.success / metrics.total) * 100 : 0;
  console.log(`Total analisado:           ${metrics.total} consultas`);
  console.log(`Taxa de sucesso final:     ${successRate.toFixed(1)}%`);
  console.log(`Confiança média final:     ${metrics.avgConfidence.toFixed(4)}`);
  console.log('='.repeat(80));
  process.exit(0);
});

