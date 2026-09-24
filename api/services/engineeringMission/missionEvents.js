'use strict';

/**
 * api/services/engineeringMission/missionEvents.js
 *
 * Feedback em tempo real do Engineering Mission Compiler, reutilizando o MESMO WebSocket do
 * Router (`api/services/websocketService.emitEvent`) — nenhum transporte novo é criado.
 * Best-effort: uma falha ao notificar NUNCA pode interromper o pipeline real.
 */

const { emitEvent } = require('../websocketService');
const logger = require('../../utils/logger');

function emitMissionStage(tenantId, missionId, stageInfo) {
  if (!tenantId || !missionId || !stageInfo?.stage) return;
  try {
    emitEvent('engineering.mission.stage', {
      missionId,
      stage: stageInfo.stage,
      status: stageInfo.status || 'info',
      phase: stageInfo.phase || null,
      missionVersion: stageInfo.missionVersion ?? null,
      approvalMode: stageInfo.approvalMode || null,
      displayStatus: stageInfo.displayStatus || null,
      message: stageInfo.message || '',
      meta: stageInfo.meta || null,
      ts: Date.now(),
    }, { tenantId });
  } catch (err) {
    logger.warn('[missionEvents] falha ao emitir evento WS (best-effort)', {
      missionId, stage: stageInfo.stage, error: err.message,
    });
  }
}

module.exports = { emitMissionStage };
