/**
 * Testes unitários de contrato para os módulos BPMN puros.
 * Cobre: bpmnNodeMapping, bpmnExtensions, bpmnSupportedSubset, bpmnXmlBuilder.
 */

import { describe, it, expect } from 'vitest';

import {
  BPMN_COMPATIBILITY_STATUS,
  BPMN_NODE_MAPPING,
  getNodeBpmnMapping,
  isNodeTypeMapped,
  isNodeTypeSupported,
  requiresExtension,
  getAllMappedNodeTypes,
  getMappingsByStatus,
} from './bpmnNodeMapping';

import {
  RAGENT2_BPMN_EXTENSION_NAMESPACE,
  BPMN_EXTENSION_TYPES,
  buildNodeExtensionPayload,
  shouldAttachExtension,
} from './bpmnExtensions';

import {
  getSupportedBpmnElements,
  isSupportedBpmnElement,
  isDegradationTarget,
} from './bpmnSupportedSubset';

import {
  escapeXml,
  sanitizeBpmnId,
  buildXmlAttributes,
  openTag,
  closeTag,
  selfClosingTag,
  textTag,
  indentLines,
  buildExtensionElementsLines,
} from './bpmnXmlBuilder';

// ====================================================
// bpmnNodeMapping
// ====================================================

describe('bpmnNodeMapping', () => {
  describe('getNodeBpmnMapping', () => {
    it('retorna mapeamento para tipo conhecido', () => {
      const mapping = getNodeBpmnMapping('start');
      expect(mapping).toBeTruthy();
      expect(mapping.bpmnElement).toBe('bpmn:startEvent');
      expect(mapping.status).toBe(BPMN_COMPATIBILITY_STATUS.SUPPORTED);
    });

    it('retorna null para tipo desconhecido', () => {
      expect(getNodeBpmnMapping('tipo_inexistente')).toBeNull();
    });

    it('tolera null/undefined sem lancar excecao', () => {
      expect(getNodeBpmnMapping(null)).toBeNull();
      expect(getNodeBpmnMapping(undefined)).toBeNull();
      expect(getNodeBpmnMapping('')).toBeNull();
    });
  });

  describe('isNodeTypeMapped / isNodeTypeSupported', () => {
    it('reconhece todos os tipos do mapa como mapeados', () => {
      for (const type of Object.keys(BPMN_NODE_MAPPING)) {
        expect(isNodeTypeMapped(type)).toBe(true);
      }
    });

    it('retorna false para tipo nao mapeado', () => {
      expect(isNodeTypeMapped('ghost_type')).toBe(false);
      expect(isNodeTypeSupported('ghost_type')).toBe(false);
    });

    it('retorna true para tipos com status suportado ou degradado', () => {
      expect(isNodeTypeSupported('start')).toBe(true);
      expect(isNodeTypeSupported('message')).toBe(true);
      expect(isNodeTypeSupported('api')).toBe(true);
    });
  });

  describe('requiresExtension', () => {
    const EXPECTED_TRUE = ['api', 'ai_task', 'ai', 'handoff', 'schedule_router'];
    const EXPECTED_FALSE = ['start', 'end', 'router', 'set_variable', 'subflow'];

    it.each(EXPECTED_TRUE)('requer extensao para %s', (type) => {
      expect(requiresExtension(type)).toBe(true);
    });

    it.each(EXPECTED_FALSE)('nao requer extensao para %s', (type) => {
      expect(requiresExtension(type)).toBe(false);
    });

    it('retorna false para tipo desconhecido', () => {
      expect(requiresExtension('nao_existe')).toBe(false);
    });
  });

  describe('getAllMappedNodeTypes', () => {
    it('retorna lista nao vazia de tipos', () => {
      const types = getAllMappedNodeTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(10);
    });

    it('inclui tipos essenciais do MVP', () => {
      const types = getAllMappedNodeTypes();
      for (const expected of ['start', 'end', 'message', 'router', 'api']) {
        expect(types).toContain(expected);
      }
    });
  });

  describe('getMappingsByStatus', () => {
    it('retorna somente mapeamentos do status solicitado', () => {
      const supported = getMappingsByStatus(BPMN_COMPATIBILITY_STATUS.SUPPORTED);
      expect(supported.every((m) => m.status === BPMN_COMPATIBILITY_STATUS.SUPPORTED)).toBe(true);
    });

    it('inclui nodeType em cada entrada retornada', () => {
      const entries = getMappingsByStatus(BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.nodeType).toBeTruthy();
        expect(entry.bpmnElement).toBeTruthy();
      }
    });

    it('retorna vazio para status nao existente', () => {
      expect(getMappingsByStatus('status_invalido')).toHaveLength(0);
    });
  });
});

// ====================================================
// bpmnExtensions
// ====================================================

describe('bpmnExtensions', () => {
  it('exporta namespace correto', () => {
    expect(RAGENT2_BPMN_EXTENSION_NAMESPACE).toBe('http://r-agent2.io/bpmn/extensions');
  });

  describe('buildNodeExtensionPayload', () => {
    it('retorna payload para ai_task com campos de config', () => {
      const payload = buildNodeExtensionPayload('ai_task', {
        provider: 'openai',
        model: 'gpt-4',
        prompt: 'ola',
        extra: 'ignorado',
      });
      expect(payload).toBeTruthy();
      expect(payload.type).toBe(BPMN_EXTENSION_TYPES.AI_TASK);
      expect(payload.data.provider).toBe('openai');
      expect(payload.data.model).toBe('gpt-4');
      expect(payload.data).not.toHaveProperty('extra');
    });

    it('retorna payload para api com campos de config', () => {
      const payload = buildNodeExtensionPayload('api', {
        url: 'https://example.com',
        method: 'POST',
        ignored: true,
      });
      expect(payload.type).toBe(BPMN_EXTENSION_TYPES.API);
      expect(payload.data.url).toBe('https://example.com');
      expect(payload.data.method).toBe('POST');
      expect(payload.data).not.toHaveProperty('ignored');
    });

    it('retorna payload para handoff', () => {
      const payload = buildNodeExtensionPayload('handoff', { queue: 'suporte' });
      expect(payload.type).toBe(BPMN_EXTENSION_TYPES.HANDOFF);
      expect(payload.data.queue).toBe('suporte');
    });

    it('retorna payload para schedule_router', () => {
      const payload = buildNodeExtensionPayload('schedule_router', { timezone: 'America/Sao_Paulo' });
      expect(payload.type).toBe(BPMN_EXTENSION_TYPES.SCHEDULE_ROUTER);
      expect(payload.data.timezone).toBe('America/Sao_Paulo');
    });

    it('retorna payload para fallback', () => {
      const payload = buildNodeExtensionPayload('fallback', { maxAttempts: 3 });
      expect(payload.type).toBe(BPMN_EXTENSION_TYPES.FALLBACK);
      expect(payload.data.maxAttempts).toBe(3);
    });

    it('retorna null para tipo sem extensao', () => {
      expect(buildNodeExtensionPayload('start', {})).toBeNull();
      expect(buildNodeExtensionPayload('message', {})).toBeNull();
      expect(buildNodeExtensionPayload('router', {})).toBeNull();
    });

    it('retorna null para tipo desconhecido', () => {
      expect(buildNodeExtensionPayload('outro', {})).toBeNull();
    });
  });

  describe('shouldAttachExtension', () => {
    it('retorna true para tipos com extensao', () => {
      for (const type of Object.values(BPMN_EXTENSION_TYPES)) {
        expect(shouldAttachExtension(type)).toBe(true);
      }
    });

    it('retorna false para tipos sem extensao', () => {
      expect(shouldAttachExtension('start')).toBe(false);
      expect(shouldAttachExtension('message')).toBe(false);
    });
  });
});

// ====================================================
// bpmnSupportedSubset
// ====================================================

describe('bpmnSupportedSubset', () => {
  describe('getSupportedBpmnElements', () => {
    it('retorna lista nao vazia de elementos', () => {
      const elements = getSupportedBpmnElements();
      expect(Array.isArray(elements)).toBe(true);
      expect(elements.length).toBeGreaterThan(5);
    });

    it('inclui elementos obrigatorios do MVP', () => {
      const elements = getSupportedBpmnElements();
      for (const expected of [
        'bpmn:startEvent',
        'bpmn:endEvent',
        'bpmn:serviceTask',
        'bpmn:exclusiveGateway',
        'bpmn:sequenceFlow',
      ]) {
        expect(elements).toContain(expected);
      }
    });
  });

  describe('isSupportedBpmnElement', () => {
    it('retorna true para elementos suportados', () => {
      expect(isSupportedBpmnElement('bpmn:startEvent')).toBe(true);
      expect(isSupportedBpmnElement('bpmn:serviceTask')).toBe(true);
      expect(isSupportedBpmnElement('bpmn:callActivity')).toBe(true);
    });

    it('retorna false para elementos fora do subconjunto', () => {
      expect(isSupportedBpmnElement('bpmn:parallelGateway')).toBe(false);
      expect(isSupportedBpmnElement('bpmn:boundaryEvent')).toBe(false);
      expect(isSupportedBpmnElement('elemento_inventado')).toBe(false);
    });

    it('tolera null/undefined sem lancar excecao', () => {
      expect(isSupportedBpmnElement(null)).toBe(false);
      expect(isSupportedBpmnElement(undefined)).toBe(false);
    });
  });

  describe('isDegradationTarget', () => {
    it('retorna true para alvos conhecidos de degradacao', () => {
      expect(isDegradationTarget('bpmn:parallelGateway')).toBe(true);
      expect(isDegradationTarget('bpmn:boundaryEvent')).toBe(true);
      expect(isDegradationTarget('bpmn:laneSet')).toBe(true);
    });

    it('retorna false para elementos suportados', () => {
      expect(isDegradationTarget('bpmn:startEvent')).toBe(false);
      expect(isDegradationTarget('bpmn:serviceTask')).toBe(false);
    });
  });
});

// ====================================================
// bpmnXmlBuilder
// ====================================================

describe('bpmnXmlBuilder', () => {
  describe('escapeXml', () => {
    it('escapa caracteres especiais XML', () => {
      expect(escapeXml('<div class="a">a&b</div>')).toBe(
        '&lt;div class=&quot;a&quot;&gt;a&amp;b&lt;/div&gt;',
      );
    });

    it('escapa aspas simples', () => {
      expect(escapeXml("it's")).toBe('it&apos;s');
    });

    it('retorna string vazia para null/undefined', () => {
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });
  });

  describe('sanitizeBpmnId', () => {
    it('mantém ids já válidos', () => {
      expect(sanitizeBpmnId('Node_1')).toBe('Node_1');
    });

    it('prefixa com _ quando começa com dígito', () => {
      expect(sanitizeBpmnId('1_node')).toBe('_1_node');
    });

    it('substitui caracteres inválidos por underscore', () => {
      expect(sanitizeBpmnId('nó com espaço')).toContain('_');
    });

    it('retorna fallback para entrada vazia', () => {
      expect(sanitizeBpmnId('', 'fallback')).toBe('fallback');
      expect(sanitizeBpmnId(null, 'fb')).toBe('fb');
    });
  });

  describe('buildXmlAttributes', () => {
    it('gera string de atributos escapados', () => {
      const result = buildXmlAttributes({ id: 'node_1', name: 'A & B' });
      expect(result).toContain('id="node_1"');
      expect(result).toContain('name="A &amp; B"');
    });

    it('omite atributos null/undefined', () => {
      const result = buildXmlAttributes({ id: 'x', skip: null, also: undefined });
      expect(result).toBe('id="x"');
    });

    it('retorna string vazia para objeto vazio', () => {
      expect(buildXmlAttributes({})).toBe('');
    });
  });

  describe('openTag / closeTag / selfClosingTag / textTag', () => {
    it('openTag sem atributos', () => {
      expect(openTag('bpmn:startEvent')).toBe('<bpmn:startEvent>');
    });

    it('openTag com atributos', () => {
      expect(openTag('bpmn:task', { id: 't1' })).toBe('<bpmn:task id="t1">');
    });

    it('closeTag retorna tag de fechamento', () => {
      expect(closeTag('bpmn:startEvent')).toBe('</bpmn:startEvent>');
    });

    it('selfClosingTag gera tag auto-fechante', () => {
      expect(selfClosingTag('bpmn:incoming')).toBe('<bpmn:incoming />');
      expect(selfClosingTag('bpmn:flow', { id: 'f1' })).toBe(
        '<bpmn:flow id="f1" />',
      );
    });

    it('textTag gera tag com texto escapado', () => {
      expect(textTag('bpmn:name', 'A&B')).toBe('<bpmn:name>A&amp;B</bpmn:name>');
    });
  });

  describe('indentLines', () => {
    it('adiciona prefix a cada linha', () => {
      const result = indentLines(['a', 'b'], 1);
      expect(result).toEqual(['  a', '  b']);
    });

    it('usa level 2 com spacer customizado', () => {
      const result = indentLines(['x'], 2, '\t');
      expect(result).toEqual(['\t\tx']);
    });
  });

  describe('buildExtensionElementsLines', () => {
    it('retorna array vazio para payload nulo', () => {
      expect(buildExtensionElementsLines(null)).toHaveLength(0);
      expect(buildExtensionElementsLines(undefined)).toHaveLength(0);
    });

    it('gera linhas de extensionElements com tipo e dados', () => {
      const lines = buildExtensionElementsLines(
        { type: 'api', data: { url: 'http://x.com' } },
        { prefix: 'ragent2' },
      );
      expect(lines[0]).toBe('<bpmn:extensionElements>');
      expect(lines[1]).toContain('ragent2:metadata');
      expect(lines[1]).toContain('type="api"');
      expect(lines[1]).toContain('http://x.com');
      expect(lines[2]).toBe('</bpmn:extensionElements>');
    });
  });
});
