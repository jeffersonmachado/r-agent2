import { describe, expect, test } from 'vitest';
import { bpmnToCanonical } from './bpmnToCanonical';
import { canonicalToBpmn } from './canonicalToBpmn';

describe('bpmn canonical adapter', () => {
  test('converte canonical para BPMN e volta para canonical', () => {
    const canonical = {
      id: 'proc-bpmn-canonical',
      name: 'Canonical BPMN',
      version: 1,
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {} },
        { id: 'task-1', type: 'task.service', label: 'Task', config: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'task-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'task-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    };

    const exported = canonicalToBpmn(canonical, { mode: 'extensions' });
    const imported = bpmnToCanonical(exported.xml);

    expect(exported.xml).toContain('bpmn:definitions');
    expect(imported.canonical.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['start-1', 'task-1', 'end-1']),
    );
  });
});
