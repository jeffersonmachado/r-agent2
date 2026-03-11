import { describe, expect, it } from 'vitest';
import { validateBpmnCompatibility } from './validateBpmnCompatibility';

describe('validateBpmnCompatibility', () => {
  it('retorna sem warnings para subconjunto suportado sem degradacao', () => {
    const reteJson = {
      nodes: {
        1: { data: { type: 'start' } },
        2: { data: { type: 'set_variable' } },
        3: { data: { type: 'end' } },
      },
      connections: [
        { source: '1', target: '2' },
        { source: '2', target: '3' },
      ],
    };

    const result = validateBpmnCompatibility(reteJson);
    expect(result.compatible).toBe(true);
    expect(result.warningCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('sinaliza degradacao, extensoes e tipo nao mapeado', () => {
    const reteJson = {
      nodes: {
        1: { data: { type: 'start' } },
        2: { data: { type: 'fallback' } },
        3: { data: { type: 'api' } },
        4: { data: { type: 'legacy_custom' } },
      },
      connections: [],
    };

    const result = validateBpmnCompatibility(reteJson);
    const codes = result.warnings.map((w) => w.code);

    expect(result.compatible).toBe(false);
    expect(codes).toContain('BPMN_NODE_DEGRADATION');
    expect(codes).toContain('BPMN_NODE_REQUIRES_EXTENSION');
    expect(codes).toContain('BPMN_UNMAPPED_NODE_TYPE');
  });

  it('sinaliza ausencia de start/end e multiplos starts', () => {
    const missingStartEnd = validateBpmnCompatibility({
      nodes: {
        1: { data: { type: 'message' } },
      },
      connections: [],
    });

    expect(missingStartEnd.warnings.some((w) => w.code === 'BPMN_START_EVENT_MISSING')).toBe(true);
    expect(missingStartEnd.warnings.some((w) => w.code === 'BPMN_END_EVENT_MISSING')).toBe(true);

    const multipleStarts = validateBpmnCompatibility({
      nodes: {
        1: { data: { type: 'start' } },
        2: { data: { type: 'start' } },
        3: { data: { type: 'end' } },
      },
      connections: [],
    });

    expect(multipleStarts.warnings.some((w) => w.code === 'BPMN_MULTIPLE_START_EVENTS')).toBe(true);
  });
});
