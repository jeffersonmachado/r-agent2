import { describe, expect, it } from 'vitest';

import { engineFlowToBpmnXml, BPMN_EXPORT_MODE } from './engineFlowToBpmnXml';
import { bpmnXmlToEngineFlow } from './bpmnXmlToEngineFlow';

function buildParallelGatewayFlow() {
  return {
    id: 'flow-parallel-gateway',
    nodes: [
      { id: '1', type: 'start', next: '2' },
      {
        id: '2',
        type: 'router',
        config: {
          bpmnGatewayType: 'parallel',
        },
        next: ['3', '4'],
      },
      { id: '3', type: 'end' },
      { id: '4', type: 'end' },
    ],
  };
}

function buildParallelGatewayXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:parallelGateway id="Gateway_1" />
    <bpmn:endEvent id="End_1" />
    <bpmn:endEvent id="End_2" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Gateway_1" targetRef="End_1" />
    <bpmn:sequenceFlow id="SF_3" sourceRef="Gateway_1" targetRef="End_2" />
  </bpmn:process>
</bpmn:definitions>`;
}

describe('Phase 9.1 parallel gateway', () => {
  it('exports router as parallelGateway by default', () => {
    const { xml } = engineFlowToBpmnXml(buildParallelGatewayFlow(), {
      mode: BPMN_EXPORT_MODE.SIMPLE,
    });

    expect(xml).toContain('bpmn:parallelGateway');
    expect(xml).not.toContain('bpmn:exclusiveGateway');
  });

  it('imports parallelGateway as router by default', () => {
    const { flowDefinition, report } = bpmnXmlToEngineFlow(buildParallelGatewayXml());

    const routerNode = flowDefinition.nodes.find((node) => node.type === 'router');
    expect(routerNode).toBeTruthy();
    expect(routerNode.config.bpmnGatewayType).toBe('parallel');
    expect(Array.isArray(routerNode.next)).toBe(true);
    expect(routerNode.next).toHaveLength(2);

    expect(report.unsupportedElements.some((item) => item.elementName === 'parallelGateway')).toBe(false);
    expect(report.warnings.some((item) => item.code === 'bpmn_gateway_without_conditions')).toBe(false);
  });
});
