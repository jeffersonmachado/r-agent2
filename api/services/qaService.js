/**
 * Serviço de QA.
 * 
 * Fornece acesso aos resultados de QA:
 * - Último resultado
 * - Histórico
 * - Resultado por ID
 * - Execução manual de QA
 */

const fs = require('fs');
const path = require('path');
const { runQa } = require('../../qa/qaRunner');
const { readQaResults, getQaStats } = require('../../engine/qa/qaTelemetry');
const qaMeshService = require('./qaMeshService');
const logger = require('../utils/logger');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');
const { resolveRuntimePath } = require('../utils/runtimePaths');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

// Diretório onde resultados de QA são salvos
const QA_RESULTS_DIR = path.join(__dirname, '../../qa');
const QA_RESULT_FILE = path.join(QA_RESULTS_DIR, 'qa-result.json');

/**
 * Obtém o último resultado de QA (do arquivo ou telemetria).
 * 
 * @returns {Object|null} Último QaResult ou null
 */
function getLatestQaResult() {
  try {
    const latestMesh = qaMeshService.getLatestExecution();
    if (latestMesh?.summary) {
      return {
        status: latestMesh.summary.goNoGo === 'GO' ? 'PASS' : 'FAIL',
        scope: [],
        checks: (latestMesh.results || []).map((item) => ({
          id: item.id,
          status: item.status,
          scope: item.domain,
          blocking: item.criticality === 'blocking',
        })),
        meta: {
          timestamp: latestMesh.startedAt,
          source: 'qa-mesh',
          executionId: latestMesh.executionId,
        },
        governance: latestMesh.governance,
        mesh: latestMesh.summary,
      };
    }
    // Tenta ler do arquivo (CI/local)
    if (fs.existsSync(QA_RESULT_FILE)) {
      const content = fs.readFileSync(QA_RESULT_FILE, 'utf8');
      return JSON.parse(content);
    }

    // Se não encontrar, busca na telemetria (runtime)
    const results = readQaResults(1);
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    logger.error('[qaService] Erro ao obter último resultado QA', { error: safeErrorMessage(error) });
    return null;
  }
}

/**
 * Obtém histórico de resultados de QA.
 * 
 * @param {Object} options
 * @param {number} [options.limit] - Limite de resultados (padrão: 50)
 * @param {string} [options.source] - Filtrar por source ('ci', 'local', 'runtime', 'manual')
 * @returns {Array} Lista de QaResult
 */
function getQaHistory(options = {}) {
  const { limit = 50, source } = options;

  try {
    const meshHistory = qaMeshService.getMeshHistory({ limit });
    if (meshHistory.length > 0 && (!source || source === 'qa-mesh')) {
      return meshHistory.map((item) => ({
        status: item.summary?.goNoGo === 'GO' ? 'PASS' : 'FAIL',
        scope: [],
        checks: item.results || [],
        meta: {
          timestamp: item.startedAt,
          source: 'qa-mesh',
          executionId: item.executionId,
        },
        governance: item.governance,
        mesh: item.summary,
      }));
    }
    let results = readQaResults(limit * 2); // Lê mais para filtrar depois

    // Filtra por source se fornecido
    if (source) {
      results = results.filter(result => result.meta?.source === source);
    }

    // Limita resultados
    return results.slice(0, limit);
  } catch (error) {
    logger.error('[qaService] Erro ao obter histórico QA', { error: safeErrorMessage(error) });
    return [];
  }
}

/**
 * Obtém resultado de QA por ID (commit hash ou timestamp).
 * 
 * @param {string} id - ID do resultado (commit hash ou timestamp)
 * @returns {Object|null} QaResult ou null
 */
function getQaResultById(id) {
  try {
    const meshResult = qaMeshService.getExecutionById(id);
    if (meshResult) {
      return {
        status: meshResult.summary?.goNoGo === 'GO' ? 'PASS' : 'FAIL',
        scope: [],
        checks: meshResult.results || [],
        meta: {
          timestamp: meshResult.startedAt,
          source: 'qa-mesh',
          executionId: meshResult.executionId,
        },
        governance: meshResult.governance,
        mesh: meshResult.summary,
      };
    }
    const results = readQaResults(1000); // Busca em mais resultados

    // Tenta encontrar por commit
    let result = results.find(r => r.meta?.commit === id);
    if (result) return result;

    // Tenta encontrar por timestamp (aproximado)
    result = results.find(r => {
      const ts = r.meta?.timestamp;
      return ts && (ts.includes(id) || ts.startsWith(id));
    });

    return result || null;
  } catch (error) {
    logger.error('[qaService] Erro ao obter resultado QA por ID', { error: safeErrorMessage(error) });
    return null;
  }
}

/**
 * Executa QA manualmente.
 * 
 * @param {Object} options
 * @param {Array<string>} [options.changedFiles] - Lista de arquivos alterados
 * @param {string} [options.source] - Source da execução ('manual' por padrão)
 * @returns {Object} QaResult
 */
function runQaManual(options = {}) {
  const { changedFiles, source = 'manual' } = options;

  // Inicializa replay
  // Replay é exclusivo de interações via UI (RPA browser). Execução de QA é
  // backend — replay fica opt-in via ENABLE_QA_REPLAY=true.
  const replay = new ReplaySystem({
    storagePath: resolveRuntimePath('replays', 'qa'),
    context: 'qa',
    enableScreenshots: false,
    enabled: process.env.ENABLE_QA_REPLAY === 'true',
  });

  // Inicializa gravação
  const recording = new RecordingSystem({
    storagePath: resolveRuntimePath('recordings', 'qa'),
    context: 'qa',
    enableTimestamps: true,
  });

  const replayId = `qa-${source}-${Date.now()}`;
  const recordingId = `qa-${source}-${Date.now()}`;
  
  replay.start(replayId, {
    source,
    changedFiles: changedFiles?.length || 0,
  });

  recording.start(recordingId, {
    name: `Execução de QA - ${source}`,
    description: 'Execução manual de QA',
    source,
    changedFilesCount: changedFiles?.length || 0,
  });

  try {
    replay.recordEvent('qa_execution_started', { source });
    recording.recordAction({
      type: 'qa-execution',
      step: 'run-qa',
      value: { source, changedFilesCount: changedFiles?.length || 0 },
    });
    
    const qaStartTime = new Date().toISOString();
    const result = runQa({ changedFiles, source });
    const qaEndTime = new Date().toISOString();

    // Salva resultado
    if (!fs.existsSync(QA_RESULTS_DIR)) {
      fs.mkdirSync(QA_RESULTS_DIR, { recursive: true });
    }
    fs.writeFileSync(QA_RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');

    // Registra ações de QA
    replay.recordAction(
      { type: 'qa_execution', step: 'run-qa' },
      {
        success: result.status === 'PASS',
        startTime: qaStartTime,
        endTime: qaEndTime,
        actual: {
          status: result.status,
          checksCount: result.checks?.length || 0,
          scopes: result.scope,
        },
      }
    );

    // Registra cada check
    if (result.checks) {
      result.checks.forEach((check, index) => {
        replay.recordAction(
          { type: 'qa_check', step: `check-${index + 1}` },
          {
            success: check.status === 'PASS',
            actual: {
              name: check.name,
              status: check.status,
              scope: check.scope,
            },
          }
        );
      });
    }

    replay.recordEvent('qa_execution_completed', {
      status: result.status,
    });
    replay.stop();
    const replayPath = replay.save(replayId);
    result.replayPath = replayPath;

    logger.info('[qaService] QA manual executado', {
      status: result.status,
      scopes: result.scope,
      checks: result.checks.length,
      replayPath,
    });

    return result;
  } catch (error) {
    const errorMessage = safeErrorMessage(error, 'Erro ao executar QA manual');
    replay.recordError(error, 'qa-execution');
    replay.recordEvent('qa_execution_failed', {
      error: errorMessage,
    });
    replay.stop();
    const replayPath = replay.save(`${replayId}-error`);

    // Registra erro na gravação
    recording.recordCustom('error', {
      step: 'qa-execution-error',
      value: { error: errorMessage },
    });
    recording.stop();
    const recordingPath = recording.save(`${recordingId}-error`);
    
    logger.error('[qaService] Erro ao executar QA manual', {
      error: errorMessage,
      replayPath,
      recordingPath,
    });
    throw error;
  }
}

/**
 * Obtém estatísticas de QA.
 * 
 * @returns {Object} Estatísticas agregadas
 */
function getQaStatistics() {
  try {
    const latestMesh = qaMeshService.getLatestExecution();
    if (latestMesh?.summary) {
      return {
        total: latestMesh.summary.total,
        byStatus: {
          PASS: latestMesh.summary.passed,
          FAIL: latestMesh.summary.failed,
          WARN: latestMesh.summary.warnings,
        },
        byScope: latestMesh.summary.domains,
        bySource: { 'qa-mesh': latestMesh.summary.total },
        blockingFailures: (latestMesh.results || []).filter((item) => item.status === 'FAIL' && item.criticality === 'blocking').length,
        recentResults: qaMeshService.getMeshHistory({ limit: 5 }),
      };
    }
    return getQaStats();
  } catch (error) {
    logger.error('[qaService] Erro ao obter estatísticas QA', { error: safeErrorMessage(error) });
    return {
      total: 0,
      byStatus: { PASS: 0, FAIL: 0, WARN: 0 },
      byScope: {},
      bySource: {},
      blockingFailures: 0,
      recentResults: []
    };
  }
}

module.exports = {
  getLatestQaResult,
  getQaHistory,
  getQaResultById,
  runQaManual,
  getQaStatistics
};
