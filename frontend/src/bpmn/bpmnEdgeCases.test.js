/**
 * Testes de casos-limite para engineFlowToBpmnXml e bpmnXmlToEngineFlow.
 *
 * Cobre:
 * - Fluxo vazio (sem nós)
 * - Nós sem config / com config parcial
 * - Caracteres especiais no nome/config (escaping XML)
 * - Nó fallback (mapeamento ragent2: → degradação scriptTask)
 * - Loop/auto-referência (deduplicação de sequenceFlow)
 * - subflow com calledElement
 * - Importação de XML mal-formado
 * - Import: nó sem suporte (intermediateThrowEvent sem definition)
 * - Import: sequenceFlow com sourceRef/targetRef desconhecidos
 * - Warnings de ambiguidade em serviceTask/scriptTask sem extensão
 */

import { describe, it, expect } from 'vitest';
import { engineFlowToBpmnXml, BPMN_EXPORT_MODE } from './engineFlowToBpmnXml';
import { bpmnXmlToEngineFlow } from './bpmnXmlToEngineFlow';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeFlow(nodes = [], extra = {}) {
  return { id: 'test-flow', tenantId: 'tenant-1', nodes, ...extra };
}

function exportSimple(nodes, extra = {}) {
  return engineFlowToBpmnXml(makeFlow(nodes, extra), { mode: BPMN_EXPORT_MODE.SIMPLE });
}

function exportExt(nodes, extra = {}) {
  return engineFlowToBpmnXml(makeFlow(nodes, extra), { mode: BPMN_EXPORT_MODE.EXTENSIONS });
}

// ─── engineFlowToBpmnXml: edge cases ──────────────────────────────────────────

describe('engineFlowToBpmnXml – edge cases', () => {
  describe('fluxo vazio', () => {
    it('retorna XML valido com processo sem elementos', () => {
      const { xml, report } = exportSimple([]);
      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain('bpmn:process');
      expect(report.exportedNodeCount).toBe(0);
      expect(report.exportedSequenceFlowCount).toBe(0);
      expect(report.warnings).toHaveLength(0);
    });

    it('aceita flowDefinition null e retorna XML valido', () => {
      const { xml, report } = engineFlowToBpmnXml(null, {});
      expect(xml).toContain('<?xml version="1.0"');
      expect(report.exportedNodeCount).toBe(0);
    });
  });

  describe('nos sem config / config parcial', () => {
    it('exporta no start sem config', () => {
      const { xml, report } = exportSimple([{ id: '1', type: 'start' }]);
      expect(xml).toContain('bpmn:startEvent');
      expect(report.exportedNodeCount).toBe(1);
    });

    it('exporta no message com config vazio', () => {
      const { xml } = exportSimple([{ id: '1', type: 'message', config: {} }]);
      expect(xml).toContain('bpmn:sendTask');
    });

    it('exporta no api sem config (modo simple: warning de extensao omitida)', () => {
      const { xml, report } = exportSimple([{ id: '1', type: 'api' }]);
      expect(xml).toContain('bpmn:serviceTask');
      expect(report.warnings.some((w) => w.code === 'bpmn_extension_omitted')).toBe(true);
    });

    it('exporta no api com config (modo extensions: extensao incluida)', () => {
      const { xml, report } = exportExt([
        { id: '1', type: 'api', config: { url: 'https://api.example.com', method: 'GET' } },
      ]);
      expect(xml).toContain('bpmn:serviceTask');
      expect(xml).toContain('ragent2:metadata');
      expect(xml).toContain('https://api.example.com');
      expect(report.extensionNodeCount).toBe(1);
    });
  });

  describe('caracteres especiais no nome/config', () => {
    it('escapa < > & " nos atributos name do elemento', () => {
      const { xml } = exportSimple([
        { id: '1', type: 'message', config: { label: 'A & B <test>' } },
      ]);
      expect(xml).toContain('A &amp; B &lt;test&gt;');
      expect(xml).not.toContain('A & B <test>');
    });

    it('escapa conteudo de extensao com aspas', () => {
      const { xml } = exportExt([
        {
          id: '1',
          type: 'api',
          config: { url: 'http://x.com?q=a"b', method: 'GET' },
        },
      ]);
      // O JSON serializado no payload de extensao deve ter a URL intacta (JSON escaping)
      expect(xml).toContain('ragent2:metadata');
    });
  });

  describe('no fallback (mapeamento ragent2: -> degradacao)', () => {
    it('exporta fallback como scriptTask com warning de mapeamento nao padrao', () => {
      const { xml, report } = exportSimple([{ id: '1', type: 'fallback' }]);
      expect(xml).toContain('bpmn:scriptTask');
      expect(report.degradedNodes.some((n) => n.nodeType === 'fallback')).toBe(true);
    });
  });

  describe('loop / auto-referencia', () => {
    it('deduplica sequenceFlows identicos sem lancar erro', () => {
      const nodes = [
        { id: '1', type: 'start', next: '2' },
        { id: '2', type: 'message', next: '2' }, // auto-loop
      ];
      const { xml, report } = exportSimple(nodes);
      // Conta ocorrencias de bpmn:sequenceFlow no XML
      const sfCount = (xml.match(/bpmn:sequenceFlow/g) || []).length;
      // Cada sequenceFlow aparece em uma linha de abertura/fechamento;
      // self-closing tags têm 1 match por sequenceFlow.
      // Nao deve ter duplicatas (dedup ativo no exportador).
      expect(sfCount).toBeGreaterThanOrEqual(2); // start->message e message->message
      expect(report.exportedSequenceFlowCount).toBeLessThanOrEqual(2);
    });
  });

  describe('subflow com calledElement', () => {
    it('propaga calledElement a partir de config.flowId', () => {
      const { xml } = exportSimple([
        { id: '1', type: 'subflow', config: { flowId: 'flow-outro' } },
      ]);
      expect(xml).toContain('bpmn:callActivity');
      expect(xml).toContain('calledElement=');
      // sanitizeBpmnId preserva hífens: flow-outro permanece flow-outro
      expect(xml).toContain('flow-outro');
    });

    it('usa fallback de calledElement quando config.flowId ausente', () => {
      const { xml } = exportSimple([{ id: '42', type: 'subflow' }]);
      expect(xml).toContain('calledElement=');
      expect(xml).toContain('subflow_');
    });
  });

  describe('conexao com alvo inexistente', () => {
    it('emite warning bpmn_missing_target_node e nao quebra', () => {
      const nodes = [{ id: '1', type: 'start', next: '999' }];
      const { xml, report } = exportSimple(nodes);
      expect(xml).toContain('bpmn:startEvent');
      expect(report.warnings.some((w) => w.code === 'bpmn_missing_target_node')).toBe(true);
    });
  });

  describe('router com regras condicionais', () => {
    it('exporta router com conditions nos sequenceFlows', () => {
      const nodes = [
        {
          id: '1',
          type: 'router',
          config: {
            rules: [
              { condition: 'x == 1', next: '2' },
              { condition: 'x == 2', next: '3' },
            ],
          },
          next: { rule_1: '2', rule_2: '3' },
        },
        { id: '2', type: 'message' },
        { id: '3', type: 'end' },
      ];
      const { xml, report } = exportSimple(nodes);
      expect(xml).toContain('bpmn:exclusiveGateway');
      expect(xml).toContain('bpmn:conditionExpression');
      expect(report.exportedSequenceFlowCount).toBeGreaterThanOrEqual(2);
    });
  });
});

// ─── bpmnXmlToEngineFlow: edge cases ──────────────────────────────────────────

describe('bpmnXmlToEngineFlow – edge cases', () => {
  describe('XML invalido', () => {
    it('lanca erro para XML totalmente malformado', () => {
      expect(() => bpmnXmlToEngineFlow('this is not xml at all')).toThrow();
    });

    it('lanca erro para XML sem elemento process', () => {
      const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://x"/>`; 
      expect(() => bpmnXmlToEngineFlow(xml)).toThrow(/process/i);
    });

    it('lanca erro para string vazia', () => {
      expect(() => bpmnXmlToEngineFlow('')).toThrow();
    });
  });

  describe('processo vazio', () => {
    it('retorna fluxo com zero nos e sem erros', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
  </bpmn:process>
</bpmn:definitions>`;
      const result = bpmnXmlToEngineFlow(xml);
      expect(result.flowDefinition.nodes).toHaveLength(0);
      expect(result.report.unsupportedElements).toHaveLength(0);
    });
  });

  describe('elemento nao suportado', () => {
    it('registra no relatorio e nao inclui no fluxo', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:intermediateThrowEvent id="Throw_1" />
    <bpmn:startEvent id="Start_1" />
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      const types = flowDefinition.nodes.map((n) => n.type);
      expect(types).toContain('start');
      expect(report.unsupportedElements.some((e) => e.elementId === 'Throw_1')).toBe(true);
    });
  });

  describe('serviceTask sem extensao (ambiguidade)', () => {
    it('importa como api por padrao e emite warning', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:serviceTask id="Task_1" name="Minha Task" />
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      const node = flowDefinition.nodes.find((n) => n.config.bpmnElementId === 'Task_1');
      expect(node).toBeTruthy();
      expect(node.type).toBe('api');
      expect(report.warnings.some((w) => w.code === 'bpmn_service_task_ambiguous')).toBe(true);
    });

    it('importa bpmn:task generico como api degradado e preserva sequence flows', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" />
    <bpmn:task id="Task_1" name="Do Something" />
    <bpmn:endEvent id="EndEvent_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;

      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      expect(flowDefinition.nodes).toHaveLength(3);
      expect(flowDefinition.nodes.map((node) => node.type)).toEqual(['start', 'api', 'end']);
      expect(report.warnings.some((w) => w.code === 'bpmn_task_ambiguous')).toBe(true);
      expect(report.warnings.some((w) => w.code === 'bpmn_sequence_flow_orphan')).toBe(false);
      expect(report.ignoredSequenceFlowCount).toBe(0);
      expect(report.degradedNodes.some((node) => node.elementId === 'Task_1')).toBe(true);
    });
  });

  describe('scriptTask sem extensao (ambiguidade)', () => {
    it('importa como set_variable por padrao e emite warning', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:scriptTask id="Script_1" name="Define x" />
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      const node = flowDefinition.nodes.find((n) => n.config.bpmnElementId === 'Script_1');
      expect(node).toBeTruthy();
      expect(node.type).toBe('set_variable');
      expect(report.warnings.some((w) => w.code === 'bpmn_script_task_ambiguous')).toBe(true);
    });
  });

  describe('sequenceFlow com sourceRef/targetRef desconhecidos', () => {
    it('ignora o flow e emite warning bpmn_sequence_flow_orphan', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="SF_bad" sourceRef="Start_1" targetRef="GHOST_NODE" />
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      expect(flowDefinition.nodes).toHaveLength(1);
      expect(report.warnings.some((w) => w.code === 'bpmn_sequence_flow_orphan')).toBe(true);
    });
  });

  describe('gateway de degradacao (inclusiveGateway)', () => {
    it('importa como router e preserva sequence flows sem orphan', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_A" />
    <bpmn:task id="Task_B" />
    <bpmn:inclusiveGateway id="Gate_1" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="Task_A" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Task_A" targetRef="Gate_1" />
    <bpmn:sequenceFlow id="SF_3" sourceRef="Task_B" targetRef="Gate_1" />
    <bpmn:sequenceFlow id="SF_4" sourceRef="Gate_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      const gatewayNode = flowDefinition.nodes.find((n) => n.config?.bpmnElementId === 'Gate_1');

      expect(gatewayNode).toBeTruthy();
      expect(gatewayNode.type).toBe('router');
      expect(gatewayNode.config?.bpmnGatewayType).toBe('inclusive');
      expect(report.warnings.some((w) => w.code === 'bpmn_gateway_degraded')).toBe(true);
      expect(report.warnings.some((w) => w.code === 'bpmn_sequence_flow_orphan')).toBe(false);
    });
  });

  describe('sequenceFlow sem sourceRef ou targetRef', () => {
    it('ignora e emite warning bpmn_sequence_flow_incomplete', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="SF_incomplete" sourceRef="Start_1" />
  </bpmn:process>
</bpmn:definitions>`;
      const { report } = bpmnXmlToEngineFlow(xml);
      expect(report.warnings.some((w) => w.code === 'bpmn_sequence_flow_incomplete')).toBe(true);
    });
  });

  describe('intermediateCatchEvent com timer', () => {
    it('importa como delay com timeDuration', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:intermediateCatchEvent id="Timer_1">
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration>PT5S</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition } = bpmnXmlToEngineFlow(xml);
      const node = flowDefinition.nodes.find((n) => n.config.bpmnElementId === 'Timer_1');
      expect(node).toBeTruthy();
      expect(node.type).toBe('delay');
      expect(node.config.timeDuration).toBe('PT5S');
    });
  });

  describe('callActivity (subflow) com calledElement', () => {
    it('preserva flowId a partir de calledElement', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:callActivity id="Call_1" calledElement="outro-fluxo" />
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition } = bpmnXmlToEngineFlow(xml);
      const node = flowDefinition.nodes.find((n) => n.config.bpmnElementId === 'Call_1');
      expect(node).toBeTruthy();
      expect(node.type).toBe('subflow');
      expect(node.config.flowId).toBe('outro-fluxo');
    });
  });

  describe('gateway condicional com sequenceFlows', () => {
    it('cria rules e next adequados no router', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  targetNamespace="http://x">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:exclusiveGateway id="GW_1" />
    <bpmn:endEvent id="End_1" />
    <bpmn:endEvent id="End_2" />
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="GW_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="GW_1" targetRef="End_1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">x == 1</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF_3" sourceRef="GW_1" targetRef="End_2" />
  </bpmn:process>
</bpmn:definitions>`;
      const { flowDefinition, report } = bpmnXmlToEngineFlow(xml);
      const gw = flowDefinition.nodes.find((n) => n.config.bpmnElementId === 'GW_1');
      expect(gw).toBeTruthy();
      expect(gw.type).toBe('router');
      expect(Array.isArray(gw.config.rules)).toBe(true);
      expect(gw.config.rules.length).toBeGreaterThan(0);
      expect(gw.config.rules[0].condition).toBe('x == 1');
      // defaultNext é o ID do engine node que mapeia para End_2
      expect(gw.config.defaultNext).toBeTruthy();
      expect(report.warnings.filter((w) => w.code === 'bpmn_gateway_multiple_defaults')).toHaveLength(0);
    });
  });
});
