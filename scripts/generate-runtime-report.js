/**
 * Script para gerar relatório de runtime.
 * 
 * Analisa telemetria de QA runtime e gera relatório estruturado.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../api/utils/logger');
const { readQaResults, getQaStats } = require('../engine/qa/qaTelemetry');
const runtimeEscalationPolicy = require('../governance/runtime-escalation-policy.json');

/**
 * Analisa resultados de runtime e determina níveis de escalonamento
 */
function analyzeEscalationLevels(results) {
  const now = Date.now();
  const oneHourAgo = now - 3600 * 1000;
  
  // Filtra resultados da última hora
  const recentResults = results.filter(r => {
    const timestamp = new Date(r.meta?.timestamp || 0).getTime();
    return timestamp >= oneHourAgo;
  });
  
  // Agrupa por tipo de falha
  const failuresByType = {};
  recentResults.forEach(result => {
    if (result.status === 'FAIL') {
      result.checks.forEach(check => {
        if (check.result === 'FAIL') {
          const type = check.id || 'unknown';
          failuresByType[type] = (failuresByType[type] || 0) + 1;
        }
      });
    }
  });
  
  // Determina nível de escalonamento
  let maxLevel = 0;
  const escalationInfo = {};
  
  Object.entries(failuresByType).forEach(([type, count]) => {
    let level = 0;
    if (count >= 10) level = 4; // Emergência
    else if (count >= 5) level = 3; // Crítico
    else if (count >= 3) level = 2; // Atenção
    else if (count >= 1) level = 1; // Detecção
    
    if (level > maxLevel) maxLevel = level;
    
    escalationInfo[type] = {
      occurrences: count,
      level,
      levelName: runtimeEscalationPolicy.escalationLevels[`level${level}`]?.name || 'N/A'
    };
  });
  
  return {
    maxLevel,
    levelName: runtimeEscalationPolicy.escalationLevels[`level${maxLevel}`]?.name || 'NONE',
    failuresByType: escalationInfo,
    totalRecentFailures: recentResults.filter(r => r.status === 'FAIL').length
  };
}

/**
 * Gera relatório completo de runtime
 */
function generateRuntimeReport() {
  logger.info('[generate-runtime-report] Gerando relatório de runtime...');
  
  // Lê resultados de QA
  const results = readQaResults(1000);
  const stats = getQaStats();
  const escalation = analyzeEscalationLevels(results);
  
  // Calcula janelas de tempo
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  const last24h = results.filter(r => {
    const timestamp = new Date(r.meta?.timestamp || 0).getTime();
    return timestamp >= oneDayAgo;
  });
  
  const last7days = results.filter(r => {
    const timestamp = new Date(r.meta?.timestamp || 0).getTime();
    return timestamp >= sevenDaysAgo;
  });
  
  const report = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Relatório de Runtime - QA",
    "description": "Relatório de telemetria e qualidade em runtime",
    "version": "1.0.0",
    "timestamp": new Date().toISOString(),
    "summary": {
      "totalResults": stats.total,
      "byStatus": stats.byStatus,
      "blockingFailures": stats.blockingFailures,
      "escalationLevel": escalation.levelName,
      "maxEscalationLevel": escalation.maxLevel
    },
    "timeWindows": {
      "last24h": {
        "total": last24h.length,
        "pass": last24h.filter(r => r.status === 'PASS').length,
        "fail": last24h.filter(r => r.status === 'FAIL').length,
        "warn": last24h.filter(r => r.status === 'WARN').length
      },
      "last7days": {
        "total": last7days.length,
        "pass": last7days.filter(r => r.status === 'PASS').length,
        "fail": last7days.filter(r => r.status === 'FAIL').length,
        "warn": last7days.filter(r => r.status === 'WARN').length
      }
    },
    "escalation": {
      "currentLevel": escalation.levelName,
      "maxLevel": escalation.maxLevel,
      "recentFailures": escalation.totalRecentFailures,
      "failuresByType": escalation.failuresByType,
      "requiresAction": escalation.maxLevel >= 3,
      "requiresRollback": escalation.maxLevel >= 4
    },
    "byScope": stats.byScope,
    "bySource": stats.bySource,
    "recentResults": stats.recentResults.map(r => ({
      "status": r.status,
      "scope": r.scope,
      "timestamp": r.meta?.timestamp,
      "source": r.meta?.source,
      "checksCount": r.checks?.length || 0,
      "blockingFailures": r.checks?.filter(c => c.result === 'FAIL' && c.blocking).length || 0
    })),
    "recommendations": []
  };
  
  // Adiciona recomendações baseadas no estado
  if (escalation.maxLevel >= 4) {
    report.recommendations.push({
      "priority": "CRITICAL",
      "action": "ROLLBACK IMEDIATO",
      "reason": "Nível de escalonamento 4 (Emergência) detectado"
    });
  } else if (escalation.maxLevel >= 3) {
    report.recommendations.push({
      "priority": "HIGH",
      "action": "BLOQUEAR DEPLOY",
      "reason": "Nível de escalonamento 3 (Crítico) detectado"
    });
  } else if (escalation.maxLevel >= 2) {
    report.recommendations.push({
      "priority": "MEDIUM",
      "action": "NOTIFICAR TECH_LEAD",
      "reason": "Nível de escalonamento 2 (Atenção) detectado"
    });
  }
  
  if (stats.blockingFailures > 0) {
    report.recommendations.push({
      "priority": "HIGH",
      "action": "INVESTIGAR FALHAS BLOQUEANTES",
      "reason": `${stats.blockingFailures} falha(s) bloqueante(s) detectada(s)`
    });
  }
  
  // Salva relatório
  const reportPath = path.join(__dirname, '../qa/runtime-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  
  logger.info('[generate-runtime-report] Relatório gerado', {
    path: reportPath,
    totalResults: stats.total,
    escalationLevel: escalation.levelName
  });
  
  return report;
}

// Executa geração
if (require.main === module) {
  try {
    generateRuntimeReport();
    process.exit(0);
  } catch (error) {
    logger.error('[generate-runtime-report] Erro ao gerar relatório', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

module.exports = { generateRuntimeReport };










