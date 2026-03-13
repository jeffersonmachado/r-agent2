import { describe, expect, it } from 'vitest';

import { engineFlowToBpmnXml } from './engineFlowToBpmnXml';
import { bpmnXmlToEngineFlow } from './bpmnXmlToEngineFlow';

function buildBpmnXmlWithDiagramInterchange() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:serviceTask id="Task_1" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmn:diagram id="Diagram_1">
    <bpmn:plane id="Plane_1" bpmnElement="Process_1">
      <di:shape id="Start_1_di" bpmnElement="Start_1">
        <di:bounds x="100" y="200" width="120" height="80" />
      </di:shape>
      <di:shape id="Task_1_di" bpmnElement="Task_1">
        <di:bounds x="300" y="150" width="180" height="90" />
      </di:shape>
      <di:edge id="SF_1_di" bpmnElement="SF_1">
        <di:waypoint x="110" y="210" />
        <di:waypoint x="190" y="210" />
        <di:waypoint x="300" y="195" />
      </di:edge>
    </bpmn:plane>
  </bpmn:diagram>
</bpmn:definitions>`;
}

function buildBpmnXmlWithGatewayDiagramInterchange() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:exclusiveGateway id="Gateway_1" />
    <bpmn:endEvent id="End_A" name="End A" />
    <bpmn:endEvent id="End_B" name="End B" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="SF_A" sourceRef="Gateway_1" targetRef="End_A" />
    <bpmn:sequenceFlow id="SF_B" sourceRef="Gateway_1" targetRef="End_B" />
  </bpmn:process>
  <bpmn:diagram id="Diagram_1">
    <bpmn:plane id="Plane_1" bpmnElement="Process_1">
      <di:shape id="Start_1_di" bpmnElement="Start_1">
        <di:bounds x="100" y="200" width="120" height="80" />
      </di:shape>
      <di:shape id="Gateway_1_di" bpmnElement="Gateway_1">
        <di:bounds x="250" y="190" width="80" height="80" />
      </di:shape>
      <di:shape id="End_A_di" bpmnElement="End_A">
        <di:bounds x="420" y="120" width="100" height="70" />
      </di:shape>
      <di:shape id="End_B_di" bpmnElement="End_B">
        <di:bounds x="420" y="280" width="100" height="70" />
      </di:shape>
      <di:edge id="SF_A_di" bpmnElement="SF_A">
        <di:waypoint x="290" y="200" />
        <di:waypoint x="360" y="160" />
        <di:waypoint x="420" y="140" />
      </di:edge>
      <di:edge id="SF_B_di" bpmnElement="SF_B">
        <di:waypoint x="290" y="240" />
        <di:waypoint x="360" y="300" />
        <di:waypoint x="420" y="320" />
      </di:edge>
    </bpmn:plane>
  </bpmn:diagram>
</bpmn:definitions>`;
}

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function getEdgeWaypointsByTargetName(xml) {
  const doc = parseXml(xml);
  const sequenceFlowTargetById = new Map();
  const targetNameByElementId = new Map();
  const edgeWaypointsByTargetName = new Map();

  Array.from(doc.getElementsByTagName('*'))
    .filter((element) => element.localName === 'endEvent')
    .forEach((element) => {
      targetNameByElementId.set(element.getAttribute('id'), element.getAttribute('name'));
    });

  Array.from(doc.getElementsByTagName('*'))
    .filter((element) => element.localName === 'sequenceFlow')
    .forEach((element) => {
      sequenceFlowTargetById.set(element.getAttribute('id'), element.getAttribute('targetRef'));
    });

  Array.from(doc.getElementsByTagName('*'))
    .filter((element) => element.localName === 'edge')
    .forEach((element) => {
      const bpmnElementId = element.getAttribute('bpmnElement');
      const targetRef = sequenceFlowTargetById.get(bpmnElementId);
      const targetName = targetNameByElementId.get(targetRef);
      if (!targetRef || !targetName) return;

      const waypoints = Array.from(element.children)
        .filter((child) => child.localName === 'waypoint')
        .map((child) => ({
          x: Number(child.getAttribute('x')),
          y: Number(child.getAttribute('y')),
        }));

      edgeWaypointsByTargetName.set(targetName, waypoints);
    });

  return edgeWaypointsByTargetName;
}

describe('Phase 9.4 BPMN DI (diagram interchange)', () => {
  it('test 1: di:shape bounds import correctly for multiple nodes by default', () => {
    const { flowDefinition } = bpmnXmlToEngineFlow(buildBpmnXmlWithDiagramInterchange());

    const startNode = flowDefinition.nodes.find((node) => node.config?.bpmnElementId === 'Start_1');
    const taskNode = flowDefinition.nodes.find((node) => node.config?.bpmnElementId === 'Task_1');

    expect(startNode?.config?.bpmnDiShape).toEqual({
      id: 'Start_1_di',
      bounds: { x: 100, y: 200, width: 120, height: 80 },
    });

    expect(taskNode?.config?.bpmnDiShape).toEqual({
      id: 'Task_1_di',
      bounds: { x: 300, y: 150, width: 180, height: 90 },
    });
  });

  it('test 2: di:edge waypoints import with ordering preserved by default', () => {
    const { flowDefinition } = bpmnXmlToEngineFlow(buildBpmnXmlWithDiagramInterchange());

    const sourceNode = flowDefinition.nodes.find((node) => node.config?.bpmnElementId === 'Start_1');
    const edgeData = sourceNode?.config?.bpmnDiEdges?.SF_1;

    expect(edgeData?.waypoints).toEqual([
      { x: 110, y: 210 },
      { x: 190, y: 210 },
      { x: 300, y: 195 },
    ]);
  });

  it('test 3: export preserves bounds in di:shape and emits diagram/plane by default', () => {
    const flow = {
      id: 'flow-di-export',
      nodes: [
        {
          id: '1',
          type: 'start',
          config: {
            bpmnDiShape: {
              bounds: { x: 50, y: 100, width: 150, height: 60 },
            },
          },
          next: '2',
        },
        { id: '2', type: 'end' },
      ],
    };

    const { xml } = engineFlowToBpmnXml(flow);

    expect(xml).toContain('<bpmn:diagram id="Diagram_1">');
    expect(xml).toContain('<bpmn:plane id="Plane_1" bpmnElement="Process_flow-di-export">');
    expect(xml).toContain('<di:shape');
    expect(xml).toContain('<di:bounds x="50" y="100" width="150" height="60" />');
  });

  it('test 4: round-trip preserves DI bounds and waypoints by default', () => {
    const imported = bpmnXmlToEngineFlow(buildBpmnXmlWithDiagramInterchange());

    imported.flowDefinition.nodes.push({
      id: '99',
      type: 'message',
      config: {
        bpmnDiShape: {
          bounds: { x: 320, y: 60, width: 140, height: 70 },
        },
      },
    });

    const endNode = imported.flowDefinition.nodes.find((node) => node.config?.bpmnElementId === 'End_1');
    if (endNode) endNode.next = '99';

    const exported = engineFlowToBpmnXml(imported.flowDefinition);

    expect(exported.xml).toContain('<di:bounds x="100" y="200" width="120" height="80" />');
    expect(exported.xml).toContain('<di:waypoint x="110" y="210" />');
    expect(exported.xml).toContain('<di:waypoint x="300" y="195" />');
    expect(exported.xml).toContain('<di:bounds x="320" y="60" width="140" height="70" />');
  });

  it('test 5: DI edges keep target-specific waypoints even if stored edge order is reversed', () => {
    const imported = bpmnXmlToEngineFlow(buildBpmnXmlWithGatewayDiagramInterchange());

    const gatewayNode = imported.flowDefinition.nodes.find(
      (node) => node.config?.bpmnElementId === 'Gateway_1'
    );

    expect(gatewayNode?.config?.bpmnDiEdges).toBeTruthy();

    const originalEdges = gatewayNode.config.bpmnDiEdges;
    gatewayNode.config.bpmnDiEdges = {
      SF_B: originalEdges.SF_B,
      SF_A: originalEdges.SF_A,
    };

    const exported = engineFlowToBpmnXml(imported.flowDefinition);

    const edgeWaypointsByTargetName = getEdgeWaypointsByTargetName(exported.xml);

    expect(edgeWaypointsByTargetName.get('End A')).toEqual([
      { x: 290, y: 200 },
      { x: 360, y: 160 },
      { x: 420, y: 140 },
    ]);

    expect(edgeWaypointsByTargetName.get('End B')).toEqual([
      { x: 290, y: 240 },
      { x: 360, y: 300 },
      { x: 420, y: 320 },
    ]);
  });
});
