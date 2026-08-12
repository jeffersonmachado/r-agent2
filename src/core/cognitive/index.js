'use strict';

/**
 * RAP Cognitive Core — núcleo central de inteligência da plataforma.
 *
 * Pipeline obrigatório:
 *   INPUT → CONTEXT → INTENT → PLAN → EXECUTE → VALIDATE → LEARN
 *
 * Agentes (Agent OS em api/modules/agent-os e afins) são camada OPCIONAL
 * sobre este núcleo — ver src/core/agents/README.md.
 *
 * Documentação: docs/cognitive-core/architecture.md
 */

const { createContextEngine } = require('./context-engine');
const { createIntentEngine, INTENTS, CONFIDENCE_THRESHOLD } = require('./intent-engine');
const { createActionPlanner, PLAN_TEMPLATES } = require('./action-planner');
const { createToolRegistry, registerDefaultTools } = require('./tool-registry');
const { createExecutionEngine } = require('./execution-engine');
const { createExecutionRouter, decideExecutionMode } = require('./execution-router');
const { createAgentSupervisor } = require('./agent-supervisor');
const { createCapabilityRegistry, getCapabilityRegistry } = require('./capability-registry');
const principal = require('./principal');
const { createValidationEngine } = require('./validation-engine');
const { createLearningEngine } = require('./learning-engine');
const { createCognitiveOrchestrator, getCognitiveOrchestrator } = require('./cognitive-orchestrator');
const visibility = require('./visibility');
const { sanitize } = require('./sanitize');
const outcome = require('./outcome');

module.exports = {
  createContextEngine,
  createIntentEngine,
  createActionPlanner,
  createToolRegistry,
  registerDefaultTools,
  createExecutionEngine,
  createExecutionRouter,
  decideExecutionMode,
  createAgentSupervisor,
  createCapabilityRegistry,
  getCapabilityRegistry,
  principal,
  createValidationEngine,
  createLearningEngine,
  createCognitiveOrchestrator,
  getCognitiveOrchestrator,
  visibility,
  sanitize,
  outcome,
  INTENTS,
  CONFIDENCE_THRESHOLD,
  PLAN_TEMPLATES,
};
