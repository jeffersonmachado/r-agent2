'use strict';

/**
 * api/services/engineeringRouter/engineeringRouterEvents.js
 *
 * Feedback em tempo real do Engineering Router V1, reaproveitando a infraestrutura de
 * WebSocket já existente (`api/services/websocketService.js`, o mesmo `emitEvent` usado por
 * `qaMeshService`/`qaWavesExecutionService`) — nenhum transporte novo é criado.
 *
 * Emite o evento `engineering.task.stage` por tenant (broadcast — o mesmo padrão de
 * `pipeline.status`); o frontend filtra client-side pelo `taskId` da tela aberta, exatamente
 * como `useGenerateSystemPipelineRealtime.js` já faz para `pipeline.status`. Best-effort: uma
 * falha ao emitir NUNCA pode interromper o pipeline real (RED/FIX/REVIEW segue sendo a única
 * fonte de verdade — o WS é só notificação).
 */

const { emitEvent } = require('../websocketService');
const logger = require('../../utils/logger');

/**
 * @param {string} tenantId
 * @param {string} taskId
 * @param {Object} stageInfo
 * @param {string} stageInfo.stage - ex.: 'CODING', 'PATCH_APPLIED', 'TESTING', 'REVIEWING', 'GREEN', 'RED'
 * @param {'running'|'success'|'error'|'info'} [stageInfo.status]
 * @param {string} [stageInfo.message]
 * @param {number|null} [stageInfo.attemptNumber]
 * @param {string[]|null} [stageInfo.changedFiles] - arquivos tocados pelo patch nesta tentativa
 * @param {Object|null} [stageInfo.meta] - dados extras livres (provider/model, exitCode, decision, etc.)
 */
function emitTaskStage(tenantId, taskId, stageInfo) {
  if (!tenantId || !taskId || !stageInfo?.stage) return;
  try {
    emitEvent('engineering.task.stage', {
      taskId,
      attemptNumber: stageInfo.attemptNumber ?? null,
      stage: stageInfo.stage,
      status: stageInfo.status || 'info',
      message: stageInfo.message || '',
      changedFiles: stageInfo.changedFiles || null,
      meta: stageInfo.meta || null,
      ts: Date.now(),
    }, { tenantId });
  } catch (err) {
    logger.warn('[engineeringRouterEvents] falha ao emitir evento WS (best-effort, não afeta o pipeline)', {
      taskId, stage: stageInfo.stage, error: err.message,
    });
  }
}

module.exports = { emitTaskStage };
