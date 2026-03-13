import { describe, expect, it } from 'vitest';
import { normalizeCanonicalProcessDefinition } from './canonicalNormalizer';
import { validateCanonicalProcessDefinition } from './canonicalValidator';

describe('canonical validator', () => {
  it('detecta ausência de start e timer inválido', () => {
    const process = normalizeCanonicalProcessDefinition({
      id: 'proc-1',
      name: 'Proc 1',
      nodes: [
        { id: 'timer-1', type: 'wait.timer', subtype: 'delay', label: 'Timer', config: {} },
      ],
      edges: [],
    });

    const result = validateCanonicalProcessDefinition(process);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['CANONICAL_START_MISSING', 'CANONICAL_TIMER_INVALID']),
    );
  });

  it('detecta nó de IA sem config mínima e sem fallback explícito', () => {
    const process = normalizeCanonicalProcessDefinition({
      id: 'proc-2',
      name: 'Proc 2',
      nodes: [
        { id: 'start-1', type: 'start', label: 'Início', config: {} },
        { id: 'ai-1', type: 'task.ai', subtype: 'ai_task', label: 'IA', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'ai-1', metadata: { sourcePort: 'out' } },
      ],
      entrypoints: ['start-1'],
    });

    const result = validateCanonicalProcessDefinition(process);

    expect(result.errors.map((error) => error.code)).toContain('CANONICAL_AI_CONFIG_MISSING');
    expect(result.warnings.map((warning) => warning.code)).toContain('CANONICAL_AI_FALLBACK_MISSING');
  });

  it('detecta handoff incompleto', () => {
    const process = normalizeCanonicalProcessDefinition({
      id: 'proc-3',
      name: 'Proc 3',
      nodes: [
        { id: 'start-1', type: 'start', label: 'Início', config: {} },
        { id: 'handoff-1', type: 'task.user', subtype: 'handoff', label: 'Handoff', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'handoff-1', metadata: { sourcePort: 'out' } },
      ],
      entrypoints: ['start-1'],
    });

    const result = validateCanonicalProcessDefinition(process);

    expect(result.errors.map((error) => error.code)).toContain('CANONICAL_HANDOFF_INCOMPLETE');
  });
});
