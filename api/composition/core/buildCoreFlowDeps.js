'use strict';

const { triggerWebhooks } = require('../../services/webhookService');
const { emitEvent } = require('../../services/websocketService');
const { orchestrateGeneration } = require('../../services/generationOrchestrator');
const { generateAuditReport } = require('../../services/auditService');
const { executeRpaFlowPipeline, previewRpaFlowPipeline } = require('../../services/rpaFlowPipelineService');
const { listConversations: listChannelConversations, listConversationMessages } = require('../../services/channelConversationService');
const { validateFlow, addUiMessage } = require('../../../engine/validator');
const { validateVoiceFlow } = require('../../utils/voiceFlowValidator');
const { simulateFlow } = require('../../../engine/flowSimulation');
const { buildConversationReplay } = require('../../../engine/replay');
const rpaDependencyResolver = require('../../services/rpaDependencyResolver.js');

function buildCoreFlowDeps(localDeps) {
  const {
    validateFlowStructure,
    ensureFlowHasMeta,
    flows,
    persistFlowBestEffort,
    deleteFlowBestEffort,
    sessionEvents,
    sessionTenants,
    saveSessionEventsToFile,
  } = localDeps;

  return {
    validateFlow,
    validateVoiceFlow,
    validateFlowStructure,
    ensureFlowHasMeta,
    flows,
    persistFlowBestEffort,
    deleteFlowBestEffort,
    triggerWebhooks,
    emitEvent,
    addUiMessage,
    orchestrateGeneration,
    generateAuditReport,
    rpaDependencyResolver,
    previewRpaFlowPipeline,
    executeRpaFlowPipeline,
    simulateFlow,
    sessionEvents,
    sessionTenants,
    saveSessionEventsToFile,
    buildConversationReplay,
    listChannelConversations,
    listConversationMessages,
  };
}

module.exports = {
  buildCoreFlowDeps,
};
