import { describe, it, expect } from 'vitest';
import { validateCanonicalProcess } from './canonicalValidator';
import { compileCanonicalProcess } from './canonicalCompiler';
import { CANONICAL_NODE_TYPES } from './canonicalTypes';

describe('process-canonical/canonicalCompiler', () => {
  it('compila processo canônico e gera indexes + versionHash', () => {
    const process = {
      id: 'proc_1',
      name: 'Proc 1',
      version: 2,
      metadata: { source: 'test' },
      nodes: [
        { id: 'start_1', type: CANONICAL_NODE_TYPES.START, config: {} },
        { id: 'svc_1', type: CANONICAL_NODE_TYPES.TASK_SERVICE, config: { action: 'x' } },
        { id: 'end_1', type: CANONICAL_NODE_TYPES.END, config: {} },
      ],
      edges: [
        { source: 'start_1', target: 'svc_1', priority: 0 },
        { source: 'svc_1', target: 'end_1', priority: 0 },
      ],
      entrypoints: ['start_1'],
    };

    const compiled = compileCanonicalProcess(process);

    expect(compiled.report.valid).toBe(true);
    expect(compiled.compiledProcessDefinition.format).toBe('canonical-compiled');
    expect(typeof compiled.compiledProcessDefinition.versionHash).toBe('string');
    expect(compiled.compiledProcessDefinition.nodeById.start_1.id).toBe('start_1');
    expect(compiled.compiledProcessDefinition.outgoingByNodeId.start_1).toHaveLength(1);
  });

  it('valida erro semântico de task.ai sem prompt/task', () => {
    const process = {
      id: 'proc_ai',
      nodes: [
        { id: 'start_1', type: CANONICAL_NODE_TYPES.START, config: {} },
        { id: 'ai_1', type: CANONICAL_NODE_TYPES.TASK_AI, config: {} },
        { id: 'end_1', type: CANONICAL_NODE_TYPES.END, config: {} },
      ],
      edges: [
        { source: 'start_1', target: 'ai_1', priority: 0 },
        { source: 'ai_1', target: 'end_1', priority: 0 },
      ],
      entrypoints: ['start_1'],
    };

    const validation = validateCanonicalProcess(process);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.code === 'canonical_ai_task_missing_config')).toBe(true);
  });

  it('aplica normalização quando entrypoint não é fornecido', () => {
    const process = {
      id: 'proc_missing_entry',
      nodes: [
        { id: 'n1', type: CANONICAL_NODE_TYPES.START, config: {} },
        { id: 'n2', type: CANONICAL_NODE_TYPES.END, config: {} },
      ],
      edges: [{ source: 'n1', target: 'n2', priority: 0 }],
    };

    const compiled = compileCanonicalProcess(process);
    expect(compiled.compiledProcessDefinition.entrypoints).toEqual(['n1']);
  });
});
