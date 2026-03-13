import { describe, expect, it } from 'vitest';

import { engineFlowToBpmnXml, BPMN_EXPORT_MODE } from './engineFlowToBpmnXml';
import { bpmnXmlToEngineFlow } from './bpmnXmlToEngineFlow';

function buildBoundaryTimerFlow() {
  return {
    id: 'flow-boundary-timer',
    nodes: [
      { id: '1', type: 'start', next: '2' },
      { id: '2', type: 'message', next: '3' },
      {
        id: '4',
        type: 'delay',
        config: {
          bpmnBoundaryEventType: 'timer',
          bpmnAttachedToNodeId: '2',
          timeDuration: 'PT30S',
        },
        next: '3',
      },
      { id: '3', type: 'end' },
    ],
  };
}

function buildBoundaryTimerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:serviceTask id="Task_1" />
    <bpmn:boundaryEvent id="Boundary_1" attachedToRef="Task_1">
      <bpmn:timerEventDefinition />
    </bpmn:boundaryEvent>
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Task_1" targetRef="End_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Boundary_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;
}

function buildBoundaryErrorXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:userTask id="Task_1" />
    <bpmn:boundaryEvent id="Boundary_1" attachedToRef="Task_1">
      <bpmn:errorEventDefinition />
    </bpmn:boundaryEvent>
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Task_1" targetRef="End_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Boundary_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;
}

describe('Phase 9.2 boundary events', () => {
  it('exports timer boundaryEvent by default', () => {
    const { xml } = engineFlowToBpmnXml(buildBoundaryTimerFlow(), {
      mode: BPMN_EXPORT_MODE.SIMPLE,
    });

    expect(xml).toContain('bpmn:boundaryEvent');
    expect(xml).toContain('attachedToRef="SendTask__2"');
    expect(xml).toContain('<bpmn:timerEventDefinition />');
    expect((xml.match(/bpmn:timerEventDefinition/g) || []).length).toBe(1);
  });

  it('resolves boundary attachedToRef from internal node id when provided in bpmnAttachedToRef', () => {
    const flow = {
      id: 'flow-boundary-ref-by-node-id',
      nodes: [
        { id: '1', type: 'start', next: '2' },
        { id: '2', type: 'message', next: '3' },
        {
          id: '4',
          type: 'delay',
          config: {
            bpmnBoundaryEventType: 'timer',
            bpmnAttachedToRef: '2',
          },
          next: '3',
        },
        { id: '3', type: 'end' },
      ],
    };

    const { xml } = engineFlowToBpmnXml(flow, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
    });

    const attachedTaskId = xml.match(/<bpmn:sendTask[^>]*id="([^"]+)"/)?.[1];
    const boundaryAttachedTo = xml.match(/<bpmn:boundaryEvent[^>]*attachedToRef="([^"]+)"/)?.[1];

    expect(attachedTaskId).toBeTruthy();
    expect(boundaryAttachedTo).toBe(attachedTaskId);
  });

  it('prioritizes bpmnAttachedToNodeId over bpmnAttachedToRef when both are provided', () => {
    const flow = {
      id: 'flow-boundary-attachment-precedence',
      nodes: [
        { id: '1', type: 'start', next: '2' },
        { id: '2', type: 'message', next: '3' },
        {
          id: '4',
          type: 'delay',
          config: {
            bpmnBoundaryEventType: 'timer',
            bpmnAttachedToNodeId: '2',
            bpmnAttachedToRef: 'Ghost_Pool_1',
          },
          next: '3',
        },
        { id: '3', type: 'end' },
      ],
    };

    const { xml } = engineFlowToBpmnXml(flow, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
    });

    const attachedTaskId = xml.match(/<bpmn:sendTask[^>]*id="([^"]+)"/)?.[1];
    const boundaryAttachedTo = xml.match(/<bpmn:boundaryEvent[^>]*attachedToRef="([^"]+)"/)?.[1];

    expect(attachedTaskId).toBeTruthy();
    expect(boundaryAttachedTo).toBe(attachedTaskId);
    expect(boundaryAttachedTo).not.toBe('Ghost_Pool_1');
  });

  it('imports timer boundaryEvent as degraded delay by default', () => {
    const { flowDefinition, report } = bpmnXmlToEngineFlow(buildBoundaryTimerXml());

    const boundaryDelay = flowDefinition.nodes.find(
      (node) =>
        node.type === 'delay' &&
        node.config.bpmnElementName === 'boundaryEvent' &&
        node.config.bpmnBoundaryEventType === 'timer'
    );

    expect(boundaryDelay).toBeTruthy();
    expect(boundaryDelay.config.bpmnAttachedToRef).toBe('Task_1');
    expect(boundaryDelay.config.bpmnAttachedToNodeId).toBeTruthy();
    expect(report.warnings.some((item) => item.code === 'bpmn_boundary_event_degraded')).toBe(true);
  });

  it('imports error boundaryEvent as degraded fallback by default', () => {
    const { flowDefinition, report } = bpmnXmlToEngineFlow(buildBoundaryErrorXml());

    const boundaryFallback = flowDefinition.nodes.find(
      (node) =>
        node.type === 'fallback' &&
        node.config.bpmnElementName === 'boundaryEvent' &&
        node.config.bpmnBoundaryEventType === 'error'
    );

    expect(boundaryFallback).toBeTruthy();
    expect(boundaryFallback.config.bpmnAttachedToRef).toBe('Task_1');
    expect(report.warnings.some((item) => item.code === 'bpmn_boundary_event_degraded')).toBe(true);
  });
});
