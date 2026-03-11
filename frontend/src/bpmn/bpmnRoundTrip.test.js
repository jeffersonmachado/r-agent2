import { describe, expect, it } from 'vitest';
import { BPMN_EXPORT_MODE, engineFlowToBpmnXml } from './engineFlowToBpmnXml';
import { bpmnXmlToEngineFlow } from './bpmnXmlToEngineFlow';

describe('BPMN export/import round-trip', () => {
  it('exporta em modo simple com warning de extensao omitida', () => {
    const flowDefinition = {
      id: 'flow-simple',
      name: 'Flow Simple',
      nodes: [
        { id: '1', type: 'start', next: '2' },
        {
          id: '2',
          type: 'api',
          config: { url: 'https://example.org/hook', method: 'POST' },
          next: '3',
        },
        { id: '3', type: 'end' },
      ],
    };

    const { xml, report } = engineFlowToBpmnXml(flowDefinition, {
      mode: BPMN_EXPORT_MODE.SIMPLE,
    });

    expect(xml).toContain('<bpmn:serviceTask');
    expect(xml).not.toContain('<bpmn:extensionElements>');
    expect(report.mode).toBe(BPMN_EXPORT_MODE.SIMPLE);
    expect(report.exportedNodeCount).toBe(3);
    expect(report.exportedSequenceFlowCount).toBe(2);
    expect(report.warnings.some((w) => w.code === 'bpmn_extension_omitted')).toBe(true);
  });

  it('exporta em modo extensions com namespace e metadados r-agent2', () => {
    const flowDefinition = {
      id: 'flow-ext',
      name: 'Flow Ext',
      nodes: [
        { id: '1', type: 'start', next: '2' },
        {
          id: '2',
          type: 'api',
          config: {
            url: 'https://example.org/hook',
            method: 'GET',
            headers: { 'x-id': '1' },
          },
          next: '3',
        },
        { id: '3', type: 'end' },
      ],
    };

    const { xml, report } = engineFlowToBpmnXml(flowDefinition, {
      mode: BPMN_EXPORT_MODE.EXTENSIONS,
    });

    expect(xml).toContain('xmlns:ragent2="http://r-agent2.io/bpmn/extensions"');
    expect(xml).toContain('<bpmn:extensionElements>');
    expect(xml).toContain('<ragent2:metadata type="api">');
    expect(report.mode).toBe(BPMN_EXPORT_MODE.EXTENSIONS);
    expect(report.extensionNodeCount).toBeGreaterThan(0);
    expect(report.warnings.some((w) => w.code === 'bpmn_extension_omitted')).toBe(false);
  });

  it('importa BPMN com extensoes e mapeia gateway condicional/default', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:ragent2="http://r-agent2.io/bpmn/extensions"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  id="Definitions_Import"
  targetNamespace="http://r-agent2.io/bpmn/definitions">
  <bpmn:process id="Process_Import" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:serviceTask id="Task_1" name="API">
      <bpmn:extensionElements>
        <ragent2:metadata type="api">{"url":"https://example.org/import","method":"POST"}</ragent2:metadata>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:exclusiveGateway id="Gateway_1" name="Gate">
      <bpmn:extensionElements>
        <ragent2:metadata type="schedule_router">{"timezone":"UTC"}</ragent2:metadata>
      </bpmn:extensionElements>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_1" name="End A" />
    <bpmn:endEvent id="End_2" name="End B" />
    <bpmn:intermediateThrowEvent id="Throw_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Task_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="SF_3" sourceRef="Gateway_1" targetRef="End_1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">ticket == 'a'</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF_4" sourceRef="Gateway_1" targetRef="End_2" />
  </bpmn:process>
</bpmn:definitions>`;

    const { flowDefinition, report } = bpmnXmlToEngineFlow(xml, {
      id: 'flow-imported',
      name: 'Imported Flow',
      tenantId: 'tenant-a',
      version: 7,
    });

    expect(flowDefinition.id).toBe('flow-imported');
    expect(flowDefinition.name).toBe('Imported Flow');
    expect(flowDefinition.tenantId).toBe('tenant-a');
    expect(flowDefinition.version).toBe(7);
    expect(flowDefinition.nodes.length).toBe(5);

    const apiNode = flowDefinition.nodes.find((n) => n.type === 'api');
    expect(apiNode).toBeTruthy();
    expect(apiNode.config.url).toBe('https://example.org/import');
    expect(apiNode.config.method).toBe('POST');

    const scheduleNode = flowDefinition.nodes.find((n) => n.type === 'schedule_router');
    expect(scheduleNode).toBeTruthy();
    expect(scheduleNode.config.timezone).toBe('UTC');
    expect(scheduleNode.config.rules?.length).toBe(1);
    expect(scheduleNode.config.defaultNext).toBeTruthy();

    expect(report.preservedExtensionCount).toBe(2);
    expect(report.unsupportedElements.some((e) => e.elementName === 'intermediateThrowEvent')).toBe(true);
  });

  it('faz round-trip com extensoes preservando tipos principais', () => {
    const original = {
      id: 'flow-roundtrip',
      name: 'RoundTrip',
      tenantId: 'tenant-rt',
      version: 2,
      nodes: [
        { id: '1', type: 'start', next: '2' },
        {
          id: '2',
          type: 'api',
          config: { url: 'https://api.local/rt', method: 'GET' },
          next: '3',
        },
        {
          id: '3',
          type: 'schedule_router',
          config: {
            schedules: [{ when: 'weekday', next: '4' }],
            defaultNext: '5',
          },
        },
        { id: '4', type: 'end' },
        { id: '5', type: 'end' },
      ],
    };

    const exported = engineFlowToBpmnXml(original, {
      mode: BPMN_EXPORT_MODE.EXTENSIONS,
    });

    const imported = bpmnXmlToEngineFlow(exported.xml, {
      id: 'flow-roundtrip-imported',
      tenantId: 'tenant-rt',
      version: 3,
    });

    const importedTypes = imported.flowDefinition.nodes.map((n) => n.type);
    expect(importedTypes).toContain('start');
    expect(importedTypes).toContain('api');
    expect(importedTypes).toContain('schedule_router');
    expect(importedTypes.filter((t) => t === 'end').length).toBeGreaterThanOrEqual(2);

    expect(imported.flowDefinition.metadata?.bpmnImportReport).toBeTruthy();
    expect(imported.report.importedSequenceFlowCount).toBeGreaterThan(0);
  });
});
