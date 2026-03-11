import { describe, expect, it } from 'vitest';

import { engineFlowToBpmnXml, BPMN_EXPORT_MODE } from './engineFlowToBpmnXml';
import { bpmnXmlToEngineFlow } from './bpmnXmlToEngineFlow';

function buildMessageFlowFlow() {
  return {
    id: 'flow-message-flow',
    nodes: [
      { id: '1', type: 'start', next: '2' },
      {
        id: '2',
        type: 'degradedPool',
        config: {
          label: 'Participant A',
          bpmnPoolType: true,
        },
        next: '4',
      },
      {
        id: '3',
        type: 'degradedPool',
        config: {
          label: 'Participant B',
          bpmnPoolType: true,
        },
        next: '4',
      },
      {
        id: '4',
        type: 'degradedMessageFlow',
        config: {
          bpmnMessageFlowType: 'messageFlow',
          bpmnMessageFlowSource: '2',
          bpmnMessageFlowTarget: '3',
        },
        next: '5',
      },
      { id: '5', type: 'end' },
    ],
  };
}

function buildParticipantPoolXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:participant id="Participant_1" name="Pool A" processRef="Process_1">
      <bpmn:lane id="Lane_1" name="Lane 1" />
      <bpmn:lane id="Lane_2" name="Lane 2" />
    </bpmn:participant>
    <bpmn:participant id="Participant_2" name="Pool B" processRef="Process_2" />
    <bpmn:messageFlow id="MessageFlow_1" sourceRef="Participant_1" targetRef="Participant_2" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;
}

function buildMessageFlowXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:participant id="Participant_A" name="Pool A" processRef="Process_A" />
    <bpmn:participant id="Participant_B" name="Pool B" processRef="Process_B" />
    <bpmn:messageFlow id="MessageFlow_1" name="Message" sourceRef="Participant_A" targetRef="Participant_B" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;
}

describe('Phase 9.3 message flow & pools/lanes', () => {
  it('test 1: Flag OFF - messageFlow exports as default (not as bpmn:messageFlow)', () => {
    const flow = buildMessageFlowFlow();
    const { xml, report } = engineFlowToBpmnXml(flow, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
    });

    // When flag is OFF, degradedMessageFlow should export as scriptTask (default)
    expect(xml).not.toContain('bpmn:messageFlow');
    expect(xml).toContain('bpmn:scriptTask');
  });

  it('test 2: Flag ON - messageFlow exports as bpmn:messageFlow + sourceRef/targetRef', () => {
    const flow = buildMessageFlowFlow();
    const { xml } = engineFlowToBpmnXml(flow, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
      flags: { MESSAGE_FLOW: true },
    });

    // When flag is ON with MESSAGE_FLOW, should export as bpmn:messageFlow
    expect(xml).toContain('bpmn:messageFlow');

    // The messageFlow refs must target BPMN participant IDs, not internal engine node IDs.
    const participantIds = Array.from(xml.matchAll(/<bpmn:participant[^>]*id="([^"]+)"/g)).map(
      (match) => match[1]
    );

    const messageFlowMatch = xml.match(/<bpmn:messageFlow[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"[^>]*\/>/);
    expect(messageFlowMatch).toBeTruthy();
    expect(participantIds).toHaveLength(2);
    expect(messageFlowMatch?.[1]).toBe(participantIds[0]);
    expect(messageFlowMatch?.[2]).toBe(participantIds[1]);
  });

  it('test 2b: Flag ON - lane exports as bpmn:lane with parentPoolRef resolved from internal node id', () => {
    const flow = {
      id: 'flow-lane-export',
      nodes: [
        { id: '1', type: 'start', next: '2' },
        {
          id: '2',
          type: 'degradedPool',
          config: {
            label: 'Participant A',
            bpmnPoolType: true,
          },
          next: '3',
        },
        {
          id: '3',
          type: 'degradedLane',
          config: {
            label: 'Lane A1',
            bpmnLaneType: 'lane',
            bpmnParentPoolId: '2',
          },
          next: '4',
        },
        { id: '4', type: 'end' },
      ],
    };

    const { xml } = engineFlowToBpmnXml(flow, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
      flags: { MESSAGE_FLOW: true },
    });

    const participantId = xml.match(/<bpmn:participant[^>]*id="([^"]+)"/)?.[1];
    const laneParentPoolRef = xml.match(/<bpmn:lane[^>]*parentPoolRef="([^"]+)"/)?.[1];

    expect(participantId).toBeTruthy();
    expect(laneParentPoolRef).toBe(participantId);
  });

  it('test 2c: Flag ON - lane without parent pool emits bpmn_lane_missing_parent_pool warning', () => {
    const flow = {
      id: 'flow-lane-without-parent',
      nodes: [
        { id: '1', type: 'start', next: '2' },
        {
          id: '2',
          type: 'degradedLane',
          config: {
            label: 'Orphan Lane',
            bpmnLaneType: 'lane',
          },
          next: '3',
        },
        { id: '3', type: 'end' },
      ],
    };

    const { xml, report } = engineFlowToBpmnXml(flow, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
      flags: { MESSAGE_FLOW: true },
    });

    expect(xml).toContain('<bpmn:lane');
    expect(xml).not.toContain('parentPoolRef=');
    expect(report.warnings.some((w) => w.code === 'bpmn_lane_missing_parent_pool')).toBe(true);
  });

  it('test 3: Flag OFF - participant/lane XML ignored on import', () => {
    const { flowDefinition, report } = bpmnXmlToEngineFlow(buildParticipantPoolXml());

    // When flag is OFF, participants and lanes should not be imported
    const hasParticipants = flowDefinition.nodes.some((n) => n.type === 'degradedPool');
    const hasLanes = flowDefinition.nodes.some((n) => n.type === 'degradedLane');

    expect(hasParticipants).toBe(false);
    expect(hasLanes).toBe(false);

    // Should have marked them as unsupported
    const unsupportedParticipants = report.unsupportedElements.filter((e) => e.elementName === 'participant');
    expect(unsupportedParticipants.length).toBeGreaterThan(0);
  });

  it('test 4: Flag ON - participant imports as degradedPool + lanes as degradedLane', () => {
    const { flowDefinition, report } = bpmnXmlToEngineFlow(buildParticipantPoolXml(), {
      flags: { MESSAGE_FLOW: true },
    });

    // Should have degraded pool nodes
    const poolNodes = flowDefinition.nodes.filter((n) => n.type === 'degradedPool');
    expect(poolNodes.length).toBeGreaterThan(0);

    // At least one pool should have lanes
    const poolWithLanes = poolNodes.find((n) =>
      flowDefinition.nodes.some((lane) => lane.config?.bpmnParentPoolId === n.id && lane.type === 'degradedLane')
    );

    if (poolWithLanes) {
      const lanes = flowDefinition.nodes.filter(
        (n) => n.type === 'degradedLane' && n.config?.bpmnParentPoolId === poolWithLanes.id
      );
      expect(lanes.length).toBe(2);
    }

    // Should have degradation warnings
    const degradationWarnings = report.warnings.filter((w) =>
      w.code.includes('participant') || w.code.includes('lane')
    );
    expect(degradationWarnings.length).toBeGreaterThan(0);
  });

  it('test 5: Flag ON - messageFlow imports as degradedMessageFlow with cross-ref resolution', () => {
    const { flowDefinition, report } = bpmnXmlToEngineFlow(buildMessageFlowXml(), {
      flags: { MESSAGE_FLOW: true },
    });

    // Should have degraded pool nodes for participants
    const poolNodes = flowDefinition.nodes.filter((n) => n.type === 'degradedPool');
    expect(poolNodes.length).toBe(2);

    // Should have degradedMessageFlow node
    const messageFlowNode = flowDefinition.nodes.find((n) => n.type === 'degradedMessageFlow');
    expect(messageFlowNode).toBeTruthy();

    if (messageFlowNode) {
      // Source and target should be internal node IDs (not string BPMN IDs)
      const sourceRef = messageFlowNode.config?.bpmnMessageFlowSource;
      const targetRef = messageFlowNode.config?.bpmnMessageFlowTarget;

      expect(sourceRef).toBeTruthy();
      expect(targetRef).toBeTruthy();

      // Check they map to actual nodes
      const sourceNode = flowDefinition.nodes.find((n) => n.id === sourceRef);
      const targetNode = flowDefinition.nodes.find((n) => n.id === targetRef);

      expect(sourceNode).toBeTruthy();
      expect(targetNode).toBeTruthy();
      expect(sourceNode?.type).toBe('degradedPool');
      expect(targetNode?.type).toBe('degradedPool');
    }

    // Should have degradation warning for messageFlow
    const messageFlowWarnings = report.warnings.filter((w) => w.code === 'bpmn_message_flow_degraded');
    expect(messageFlowWarnings.length).toBeGreaterThan(0);
  });

  it('test 6: Round-trip with flag ON - messageFlow survives export→import', () => {
    // Start with a flow that has messageFlow nodes
    const originalFlow = buildMessageFlowFlow();

    // Export with MESSAGE_FLOW flag ON
    const { xml: exportedXml } = engineFlowToBpmnXml(originalFlow, {
      flags: { MESSAGE_FLOW: true },
    });

    // Import the exported XML
    const { flowDefinition: reimportedFlow, report } = bpmnXmlToEngineFlow(exportedXml, {
      flags: { MESSAGE_FLOW: true },
    });

    // Should have messageFlow node
    const messageFlowNode = reimportedFlow.nodes.find((n) => n.type === 'degradedMessageFlow');
    expect(messageFlowNode).toBeTruthy();

    if (messageFlowNode) {
      // Config should have bpmnMessageFlowType
      expect(messageFlowNode.config?.bpmnMessageFlowType).toBe('messageFlow');

      // Source and target should be present and point to valid nodes
      const sourceRef = messageFlowNode.config?.bpmnMessageFlowSource;
      const targetRef = messageFlowNode.config?.bpmnMessageFlowTarget;

      expect(sourceRef).toBeTruthy();
      expect(targetRef).toBeTruthy();

      const sourceNode = reimportedFlow.nodes.find((n) => n.id === sourceRef);
      const targetNode = reimportedFlow.nodes.find((n) => n.id === targetRef);

      expect(sourceNode).toBeTruthy();
      expect(targetNode).toBeTruthy();
    }

    expect(report.warnings.some((w) => w.code === 'bpmn_message_flow_orphan_source')).toBe(false);
    expect(report.warnings.some((w) => w.code === 'bpmn_message_flow_orphan_target')).toBe(false);
  });
});
