import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { bpmnXmlToViewModel } from './bpmnXmlToViewModel';

function buildCollaborationDiagramXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  targetNamespace="http://r-agent2.test/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="Front Office" processRef="Process_1" />
    <bpmn:participant id="Participant_2" name="Back Office" processRef="Process_2" />
    <bpmn:messageFlow id="MessageFlow_1" name="handoff" sourceRef="Participant_1" targetRef="Participant_2" />
  </bpmn:collaboration>

  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Analyst">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1" name="Open" />
    <bpmn:serviceTask id="Task_1" name="Qualify" />
    <bpmn:endEvent id="End_1" name="Done" />
    <bpmn:sequenceFlow id="SequenceFlow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="SequenceFlow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>

  <bpmn:process id="Process_2" isExecutable="true">
    <bpmn:startEvent id="Start_2" name="Receive" />
    <bpmn:endEvent id="End_2" name="Close" />
    <bpmn:sequenceFlow id="SequenceFlow_3" sourceRef="Start_2" targetRef="End_2" />
  </bpmn:process>

  <bpmn:diagram id="Diagram_1">
    <bpmn:plane id="Plane_1" bpmnElement="Collaboration_1">
      <di:shape id="Participant_1_di" bpmnElement="Participant_1">
        <di:bounds x="80" y="80" width="720" height="220" />
      </di:shape>
      <di:shape id="Lane_1_di" bpmnElement="Lane_1">
        <di:bounds x="80" y="120" width="720" height="180" />
      </di:shape>
      <di:shape id="Start_1_di" bpmnElement="Start_1">
        <di:bounds x="150" y="185" width="36" height="36" />
      </di:shape>
      <di:shape id="Task_1_di" bpmnElement="Task_1">
        <di:bounds x="280" y="160" width="140" height="80" />
      </di:shape>
      <di:shape id="End_1_di" bpmnElement="End_1">
        <di:bounds x="500" y="185" width="36" height="36" />
      </di:shape>

      <di:shape id="Participant_2_di" bpmnElement="Participant_2">
        <di:bounds x="80" y="340" width="720" height="180" />
      </di:shape>
      <di:shape id="Start_2_di" bpmnElement="Start_2">
        <di:bounds x="180" y="415" width="36" height="36" />
      </di:shape>
      <di:shape id="End_2_di" bpmnElement="End_2">
        <di:bounds x="360" y="415" width="36" height="36" />
      </di:shape>

      <di:edge id="SequenceFlow_1_di" bpmnElement="SequenceFlow_1">
        <di:waypoint x="186" y="203" />
        <di:waypoint x="280" y="200" />
      </di:edge>
      <di:edge id="SequenceFlow_2_di" bpmnElement="SequenceFlow_2">
        <di:waypoint x="420" y="200" />
        <di:waypoint x="500" y="203" />
      </di:edge>
      <di:edge id="MessageFlow_1_di" bpmnElement="MessageFlow_1">
        <di:waypoint x="640" y="300" />
        <di:waypoint x="640" y="340" />
      </di:edge>
    </bpmn:plane>
  </bpmn:diagram>
</bpmn:definitions>`;
}

describe('bpmnXmlToViewModel', () => {
  it('preserves collaboration, lanes, message flows, and DI layout', () => {
    const xml = buildCollaborationDiagramXml();

    const viewModel = bpmnXmlToViewModel(xml, { name: 'Pizza Store' });

    expect(viewModel.diagramType).toBe('bpmn');
    expect(viewModel.sourceXml).toContain('<bpmn:collaboration');
    expect(viewModel.metadata.sourceName).toBe('Pizza Store');

    expect(viewModel.participants).toHaveLength(2);
    expect(viewModel.participants[0]).toMatchObject({
      id: 'Participant_1',
      processRef: 'Process_1',
      bounds: { x: 80, y: 80, width: 720, height: 220 },
    });

    expect(viewModel.lanes).toHaveLength(1);
    expect(viewModel.lanes[0]).toMatchObject({
      id: 'Lane_1',
      participantRef: 'Participant_1',
      processRef: 'Process_1',
      bounds: { x: 80, y: 120, width: 720, height: 180 },
    });

    expect(viewModel.nodes.find((node) => node.id === 'Task_1')).toMatchObject({
      name: 'Qualify',
      processRef: 'Process_1',
      participantRef: 'Participant_1',
      laneRef: 'Lane_1',
      bounds: { x: 280, y: 160, width: 140, height: 80 },
    });

    expect(viewModel.nodes.find((node) => node.id === 'Start_2')?.bounds).toEqual({
      x: 180,
      y: 415,
      width: 36,
      height: 36,
    });

    expect(viewModel.sequenceFlows.find((flow) => flow.id === 'SequenceFlow_1')?.waypoints).toEqual([
      { x: 186, y: 203 },
      { x: 280, y: 200 },
    ]);

    expect(viewModel.messageFlows).toEqual([
      expect.objectContaining({
        id: 'MessageFlow_1',
        sourceParticipantRef: 'Participant_1',
        targetParticipantRef: 'Participant_2',
        waypoints: [
          { x: 640, y: 300 },
          { x: 640, y: 340 },
        ],
      }),
    ]);

    expect(viewModel.viewport).toMatchObject({
      minX: 80,
      minY: 80,
      maxX: 800,
      maxY: 520,
      width: 1200,
      height: 800,
    });
  });

  it('does not recalculate participant and lane bounds when DI metadata exists but their shapes are absent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  targetNamespace="http://r-agent2.test/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="Front Office" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Analyst">
        <bpmn:flowNodeRef>Task_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:serviceTask id="Task_1" name="Qualify" />
  </bpmn:process>
  <bpmn:diagram id="Diagram_1">
    <bpmn:plane id="Plane_1" bpmnElement="Collaboration_1">
      <di:shape id="Task_1_di" bpmnElement="Task_1">
        <di:bounds x="280" y="160" width="140" height="80" />
      </di:shape>
    </bpmn:plane>
  </bpmn:diagram>
</bpmn:definitions>`;

    const viewModel = bpmnXmlToViewModel(xml);

    expect(viewModel.participants[0]?.bounds).toBeNull();
    expect(viewModel.lanes[0]?.bounds).toBeNull();
    expect(viewModel.nodes.find((node) => node.id === 'Task_1')?.bounds).toEqual({
      x: 280,
      y: 160,
      width: 140,
      height: 80,
    });
  });

  it('does not synthesize waypoints when DI exists but edge waypoints are absent', () => {
    const xmlWithoutDiEdges = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  targetNamespace="http://r-agent2.test/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Open" />
    <bpmn:serviceTask id="Task_1" name="Qualify" />
    <bpmn:endEvent id="End_1" name="Done" />
    <bpmn:sequenceFlow id="SequenceFlow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="SequenceFlow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmn:diagram id="Diagram_1">
    <bpmn:plane id="Plane_1" bpmnElement="Process_1">
      <di:shape id="Start_1_di" bpmnElement="Start_1">
        <di:bounds x="150" y="185" width="36" height="36" />
      </di:shape>
      <di:shape id="Task_1_di" bpmnElement="Task_1">
        <di:bounds x="280" y="160" width="140" height="80" />
      </di:shape>
      <di:shape id="End_1_di" bpmnElement="End_1">
        <di:bounds x="500" y="185" width="36" height="36" />
      </di:shape>
    </bpmn:plane>
  </bpmn:diagram>
</bpmn:definitions>`;

    const viewModel = bpmnXmlToViewModel(xmlWithoutDiEdges);

    const firstFlow = viewModel.sequenceFlows.find((flow) => flow.id === 'SequenceFlow_1');
    const secondFlow = viewModel.sequenceFlows.find((flow) => flow.id === 'SequenceFlow_2');

    expect(firstFlow?.waypoints).toEqual([]);
    expect(secondFlow?.waypoints).toEqual([]);
  });

  it('creates fallback waypoints only when no DI diagram data is present', () => {
    const xmlWithoutDi = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  targetNamespace="http://r-agent2.test/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Open" />
    <bpmn:serviceTask id="Task_1" name="Qualify" />
    <bpmn:sequenceFlow id="SequenceFlow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
</bpmn:definitions>`;

    const viewModel = bpmnXmlToViewModel(xmlWithoutDi);
    const flow = viewModel.sequenceFlows.find((item) => item.id === 'SequenceFlow_1');

    expect(flow?.waypoints).toHaveLength(2);
    expect(flow?.waypoints[0]?.x).toBeLessThan(flow?.waypoints[1]?.x);
  });

  it('parses dataStoreReference with dedicated type and preserves DI bounds + label bounds', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  targetNamespace="http://r-agent2.test/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:dataStoreReference id="DataStore_1" name="Database" />
  </bpmn:process>
  <bpmn:diagram id="Diagram_1">
    <bpmn:plane id="Plane_1" bpmnElement="Process_1">
      <di:shape id="DataStore_1_di" bpmnElement="DataStore_1">
        <dc:bounds x="600" y="260" width="72" height="90" />
        <bpmn:label id="DataStore_1_label">
          <dc:bounds x="586" y="356" width="100" height="22" />
        </bpmn:label>
      </di:shape>
    </bpmn:plane>
  </bpmn:diagram>
</bpmn:definitions>`;

    const viewModel = bpmnXmlToViewModel(xml);
    const dataStore = viewModel.nodes.find((node) => node.id === 'DataStore_1');

    expect(dataStore).toMatchObject({
      bpmnType: 'dataStoreReference',
      category: 'data',
      bounds: { x: 600, y: 260, width: 72, height: 90 },
      labelBounds: { x: 586, y: 356, width: 100, height: 22 },
    });
  });

  it('parses the real Pizza-Store fixture with all primary visual BPMN elements present', () => {
    const fixturePath = path.resolve(process.cwd(), 'src/bpmn/__fixtures__/Pizza-Store.bpmn');
    const xml = fs.readFileSync(fixturePath, 'utf8');

    const viewModel = bpmnXmlToViewModel(xml, { name: 'Pizza Store real fixture' });

    expect(viewModel.participants).toHaveLength(2);
    expect(viewModel.lanes).toHaveLength(3);
    expect(viewModel.messageFlows).toHaveLength(6);
    expect(viewModel.sequenceFlows).toHaveLength(18);
    expect(viewModel.nodes).toHaveLength(19);
    expect(viewModel.nodes.some((node) => node.bpmnType === 'eventBasedGateway')).toBe(true);
    expect(viewModel.nodes.some((node) => node.bpmnType === 'parallelGateway')).toBe(true);
    expect(viewModel.nodes.some((node) => node.bpmnType === 'dataStoreReference')).toBe(true);
    expect(viewModel.nodes.some((node) => node.eventDefinitionType === 'message')).toBe(true);
    expect(viewModel.nodes.some((node) => node.eventDefinitionType === 'timer')).toBe(true);
  });
});