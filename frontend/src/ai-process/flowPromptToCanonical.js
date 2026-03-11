import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';
import { CANONICAL_NODE_TYPES } from '../process-canonical/canonicalTypes';

function createSimpleFlowFromPrompt(prompt) {
  const text = String(prompt || '').trim();
  const wantsAi = /ai|inteligencia|assistente|copiloto/i.test(text);
  const coreTaskType = wantsAi ? CANONICAL_NODE_TYPES.TASK_AI : CANONICAL_NODE_TYPES.TASK_SERVICE;

  return {
    id: 'canonical_from_prompt',
    name: 'Process Generated From Prompt',
    version: 1,
    metadata: {
      source: 'ai-prompt',
      promptPreview: text.slice(0, 200),
    },
    nodes: [
      {
        id: 'start_1',
        type: CANONICAL_NODE_TYPES.START,
        label: 'Start',
        config: {},
      },
      {
        id: 'task_1',
        type: coreTaskType,
        label: wantsAi ? 'AI Step' : 'Service Step',
        config: wantsAi
          ? { prompt: text || 'Execute AI step' }
          : { action: 'call_service' },
      },
      {
        id: 'end_1',
        type: CANONICAL_NODE_TYPES.END,
        label: 'End',
        config: {},
      },
    ],
    edges: [
      { source: 'start_1', target: 'task_1', priority: 0 },
      { source: 'task_1', target: 'end_1', priority: 0 },
    ],
    entrypoints: ['start_1'],
  };
}

export function flowPromptToCanonical(prompt, options = {}) {
  const draft = createSimpleFlowFromPrompt(prompt);
  const normalized = normalizeCanonicalProcessDefinition(draft, options);

  return {
    canonicalProcessDefinition: normalized.canonicalProcessDefinition,
    report: {
      warnings: normalized.report.warnings,
      source: 'ai-prompt',
    },
  };
}

export default flowPromptToCanonical;
