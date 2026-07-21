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
const { createValidationEngine } = require('./validation-engine');
const { createLearningEngine } = require('./learning-engine');
const { createCognitiveOrchestrator, getCognitiveOrchestrator } = require('./cognitive-orchestrator');
const visibility = require('./visibility');
const { sanitize } = require('./sanitize');

module.exports = {
  createContextEngine,
  createIntentEngine,
  createActionPlanner,
  createToolRegistry,
  registerDefaultTools,
  createExecutionEngine,
  createValidationEngine,
  createLearningEngine,
  createCognitiveOrchestrator,
  getCognitiveOrchestrator,
  visibility,
  sanitize,
  INTENTS,
  CONFIDENCE_THRESHOLD,
  PLAN_TEMPLATES,
};
