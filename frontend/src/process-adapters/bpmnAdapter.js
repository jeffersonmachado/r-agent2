/**
 * Adaptador BPMN Nativo para Formato Canônico
 * 
 * Conversões bidirecionais entre:
 * - BPMN 2.0 XML ↔ Canônico
 * 
 * Suporta elementos BPMN:
 * - StartEvent, EndEvent
 * - Task, ServiceTask, UserTask
 * - Gateway (Exclusive, Parallel, Inclusive)
 * - SequenceFlow
 * - SubProcess
 * 
 * @module process-adapters/bpmnAdapter
 */

/**
 * Converte XML BPMN para formato Canônico
 * 
 * @param {string} bpmnXml - Conteúdo XML do BPMN
 * @returns {Object} Definição de processo canônico
 * @example
 * const canonical = bpmnToCanonical(bpmnXml);
 */
export function bpmnToCanonical(bpmnXml) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(bpmnXml, 'text/xml');

  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid BPMN XML');
  }

  const processElement = xmlDoc.getElementsByTagName('bpmn:process')[0];
  if (!processElement) {
    throw new Error('No process element found in BPMN');
  }

  const processId = processElement.getAttribute('id');
  const processName = processElement.getAttribute('name') || processId;

  // Mapear elementos BPMN
  const bpmnElements = {
    startEvents: Array.from(
      xmlDoc.getElementsByTagName('bpmn:startEvent')
    ),
    endEvents: Array.from(xmlDoc.getElementsByTagName('bpmn:endEvent')),
    tasks: Array.from(xmlDoc.getElementsByTagName('bpmn:task')),
    serviceTasks: Array.from(xmlDoc.getElementsByTagName('bpmn:serviceTask')),
    userTasks: Array.from(xmlDoc.getElementsByTagName('bpmn:userTask')),
    gateways: Array.from(xmlDoc.getElementsByTagName('bpmn:exclusiveGateway')),
    parallelGateways: Array.from(
      xmlDoc.getElementsByTagName('bpmn:parallelGateway')
    ),
    sequenceFlows: Array.from(
      xmlDoc.getElementsByTagName('bpmn:sequenceFlow')
    ),
    subProcesses: Array.from(xmlDoc.getElementsByTagName('bpmn:subProcess')),
  };

  const nodes = [];
  const edges = [];

  // Converter StartEvents
  bpmnElements.startEvents.forEach((elem) => {
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.start',
      label: elem.getAttribute('name') || 'Start',
      config: { bpmnType: 'startEvent' },
    });
  });

  // Converter EndEvents
  bpmnElements.endEvents.forEach((elem) => {
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.end',
      label: elem.getAttribute('name') || 'End',
      config: { bpmnType: 'endEvent' },
    });
  });

  // Converter Tasks
  bpmnElements.tasks.forEach((elem) => {
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.task',
      label: elem.getAttribute('name') || 'Task',
      config: {
        bpmnType: 'task',
        documentation: extractDocumentation(elem),
      },
    });
  });

  // Converter ServiceTasks
  bpmnElements.serviceTasks.forEach((elem) => {
    const config = {
      bpmnType: 'serviceTask',
    };

    // Extrair informação de implementation
    const implementation = elem.getAttribute('implementation');
    if (implementation) {
      config.implementation = implementation;
    }

    // Extrair configuração de operação (se houver)
    const operationRef = elem.getAttribute('operationRef');
    if (operationRef) {
      config.operationRef = operationRef;
    }

    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.task.service',
      label: elem.getAttribute('name') || 'Service Task',
      config,
    });
  });

  // Converter UserTasks
  bpmnElements.userTasks.forEach((elem) => {
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.task.user',
      label: elem.getAttribute('name') || 'User Task',
      config: {
        bpmnType: 'userTask',
        documentation: extractDocumentation(elem),
      },
    });
  });

  // Converter Gateways (Exclusive)
  bpmnElements.gateways.forEach((elem) => {
    const defaultFlow = elem.getAttribute('default');
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.gateway.exclusive',
      label: elem.getAttribute('name') || 'Decision',
      config: {
        bpmnType: 'exclusiveGateway',
        default: defaultFlow,
      },
    });
  });

  // Converter Parallel Gateways
  bpmnElements.parallelGateways.forEach((elem) => {
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.gateway.parallel',
      label: elem.getAttribute('name') || 'Parallel',
      config: { bpmnType: 'parallelGateway' },
    });
  });

  // Converter SubProcesses (como nós compostos)
  bpmnElements.subProcesses.forEach((elem) => {
    nodes.push({
      id: elem.getAttribute('id'),
      type: 'canonical.subprocess',
      label: elem.getAttribute('name') || 'SubProcess',
      config: {
        bpmnType: 'subProcess',
        hasChildElements: Array.from(elem.children).length > 0,
      },
    });
  });

  // Converter SequenceFlows (edges)
  bpmnElements.sequenceFlows.forEach((elem) => {
    const sourceId = elem.getAttribute('sourceRef');
    const targetId = elem.getAttribute('targetRef');

    if (sourceId && targetId) {
      const edgeConfig = {
        bpmnType: 'sequenceFlow',
      };

      // Extrair condição se houver
      const conditionExpression = elem.querySelector(
        'bpmn:conditionExpression'
      );
      if (conditionExpression) {
        edgeConfig.condition = conditionExpression.textContent;
      }

      edges.push({
        id: elem.getAttribute('id') || `${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        label: elem.getAttribute('name'),
        type: edgeConfig.condition
          ? 'canonical.edge.conditional'
          : 'canonical.edge',
        config: edgeConfig,
      });
    }
  });

  return {
    id: processId,
    name: processName,
    type: 'canonical.process',
    format: 'bpmn',
    version: '1.0',
    nodes,
    edges,
    metadata: {
      source: 'bpmn',
      elementCount: bpmnElements.startEvents.length +
        bpmnElements.endEvents.length +
        bpmnElements.tasks.length +
        bpmnElements.serviceTasks.length +
        bpmnElements.userTasks.length +
        bpmnElements.gateways.length +
        bpmnElements.parallelGateways.length,
    },
  };
}

/**
 * Converte formato Canônico para BPMN 2.0 XML
 * 
 * @param {Object} canonical - Definição de processo canônico
 * @returns {string} XML BPMN 2.0
 * @example
 * const bpmnXml = canonicalToBpmn(canonical);
 */
export function canonicalToBpmn(canonical) {
  if (!canonical || !canonical.id) {
    throw new Error('Invalid canonical definition');
  }

  // Inicializar documento XML
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   id="definitions_${canonical.id}"
                   name="${escapeXml(canonical.name || canonical.id)}"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xsi:schemaLocation="http://www.omg.org/spec/BPMN/20100524/MODEL http://www.omg.org/spec/BPMN/20100524/BPMN20.xsd">`;

  xml += `\n  <bpmn:process id="${canonical.id}" name="${escapeXml(canonical.name || canonical.id)}">`;

  // Converter nós para elementos BPMN
  const positionMap = {}; // Para armazenar posições para DI depois

  canonical.nodes.forEach((node, index) => {
    const x = (index % 5) * 150;
    const y = Math.floor(index / 5) * 150;
    positionMap[node.id] = { x, y };

    if (node.type === 'canonical.start') {
      xml += `\n    <bpmn:startEvent id="${node.id}" name="${escapeXml(node.label || node.id)}" />`;
    } else if (node.type === 'canonical.end') {
      xml += `\n    <bpmn:endEvent id="${node.id}" name="${escapeXml(node.label || node.id)}" />`;
    } else if (node.type === 'canonical.task') {
      xml += `\n    <bpmn:task id="${node.id}" name="${escapeXml(node.label || node.id)}" />`;
    } else if (node.type === 'canonical.task.service') {
      let serviceAttrs = `id="${node.id}" name="${escapeXml(node.label || node.id)}"`;
      if (node.config?.implementation) {
        serviceAttrs += ` implementation="${escapeXml(node.config.implementation)}"`;
      }
      xml += `\n    <bpmn:serviceTask ${serviceAttrs} />`;
    } else if (node.type === 'canonical.task.user') {
      xml += `\n    <bpmn:userTask id="${node.id}" name="${escapeXml(node.label || node.id)}" />`;
    } else if (node.type === 'canonical.gateway.exclusive') {
      let gatewayAttrs = `id="${node.id}" name="${escapeXml(node.label || node.id)}"`;
      if (node.config?.default) {
        gatewayAttrs += ` default="${node.config.default}"`;
      }
      xml += `\n    <bpmn:exclusiveGateway ${gatewayAttrs} />`;
    } else if (node.type === 'canonical.gateway.parallel') {
      xml += `\n    <bpmn:parallelGateway id="${node.id}" name="${escapeXml(node.label || node.id)}" />`;
    } else if (node.type === 'canonical.subprocess') {
      xml += `\n    <bpmn:subProcess id="${node.id}" name="${escapeXml(node.label || node.id)}" />`;
    }
  });

  // Converter edges para sequenceFlows
  canonical.edges.forEach((edge) => {
    let flowAttrs = `id="${edge.id || `${edge.source}-${edge.target}`}"
                sourceRef="${edge.source}"
                targetRef="${edge.target}"`;

    if (edge.label) {
      flowAttrs += ` name="${escapeXml(edge.label)}"`;
    }

    xml += `\n    <bpmn:sequenceFlow ${flowAttrs}`;

    if (edge.config?.condition) {
      xml += `>
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escapeXml(edge.config.condition)}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>`;
    } else {
      xml += ' />';
    }
  });

  xml += '\n  </bpmn:process>';

  // Adicionar diagrama BPMNDI (opcional, para visualização)
  xml += `\n  <bpmndi:BPMNDiagram id="BPMNDiagram_${canonical.id}">`;
  xml += `\n    <bpmndi:BPMNPlane id="BPMNPlane_${canonical.id}" bpmnElement="${canonical.id}">`;

  // Adicionar shapes de nós
  canonical.nodes.forEach((node) => {
    const pos = positionMap[node.id];
    xml += `\n      <bpmndi:BPMNShape id="BPMNShape_${node.id}" bpmnElement="${node.id}">`;
    xml += `\n        <dc:Bounds x="${pos.x}" y="${pos.y}" width="100" height="80" />`;
    xml += '\n      </bpmndi:BPMNShape>';
  });

  // Adicionar edges
  canonical.edges.forEach((edge) => {
    xml += `\n      <bpmndi:BPMNEdge id="BPMNEdge_${edge.id || `${edge.source}-${edge.target}`}" bpmnElement="${edge.id || `${edge.source}-${edge.target}`}">`;
    xml += '\n      </bpmndi:BPMNEdge>';
  });

  xml += '\n    </bpmndi:BPMNPlane>';
  xml += '\n  </bpmndi:BPMNDiagram>';

  xml += '\n</bpmn:definitions>';

  return xml;
}

/**
 * Extrai documentation de um elemento BPMN
 * @private
 */
function extractDocumentation(elem) {
  const docElem = elem.querySelector('bpmn:documentation');
  return docElem ? docElem.textContent : undefined;
}

/**
 * Escapa caracteres especiais para XML
 * @private
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Valida compatibilidade de elemento BPMN
 * 
 * @param {string} elementType - Tipo de elemento BPMN
 * @returns {Object} Informação de suporte
 */
export function getElementSupport(elementType) {
  const supportMap = {
    'startEvent': { supported: true, canonicalType: 'canonical.start' },
    'endEvent': { supported: true, canonicalType: 'canonical.end' },
    'task': { supported: true, canonicalType: 'canonical.task' },
    'serviceTask': { supported: true, canonicalType: 'canonical.task.service' },
    'userTask': { supported: true, canonicalType: 'canonical.task.user' },
    'exclusiveGateway': {
      supported: true,
      canonicalType: 'canonical.gateway.exclusive',
    },
    'parallelGateway': {
      supported: true,
      canonicalType: 'canonical.gateway.parallel',
    },
    'inclusiveGateway': {
      supported: false,
      note: 'Will be mapped to exclusiveGateway',
      fallback: 'canonical.gateway.exclusive',
    },
    'subProcess': { supported: true, canonicalType: 'canonical.subprocess' },
    'callActivity': {
      supported: false,
      note: 'Not yet supported. Will be treated as subprocess',
      fallback: 'canonical.subprocess',
    },
  };

  return supportMap[elementType] || { supported: false, note: 'Unknown element' };
}

/**
 * Validação de BPMN XML
 * 
 * @param {string} bpmnXml - XML a validar
 * @returns {Object} Resultado da validação
 */
export function validateBpmnXml(bpmnXml) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(bpmnXml, 'text/xml');

  const errors = [];
  const warnings = [];

  // Verificar errors de parsing
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    errors.push('XML parsing failed');
    return { valid: false, errors, warnings };
  }

  // Verificar presença de process
  const processes = xmlDoc.getElementsByTagName('bpmn:process');
  if (processes.length === 0) {
    errors.push('No BPMN process element found');
  } else if (processes.length > 1) {
    warnings.push(`Multiple processes found (${processes.length}). Only first will be used.`);
  }

  // Validações básicas de estrutura
  const process = processes[0];
  if (process) {
    const startEvents = process.getElementsByTagName('bpmn:startEvent');
    const endEvents = process.getElementsByTagName('bpmn:endEvent');

    if (startEvents.length === 0) {
      warnings.push('No start event found');
    }
    if (endEvents.length === 0) {
      warnings.push('No end event found');
    }

    // Verificar elementos não suportados
    const callActivities = process.getElementsByTagName('bpmn:callActivity');
    if (callActivities.length > 0) {
      warnings.push(
        `Found ${callActivities.length} callActivity elements. Will be converted to subprocess.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export default {
  bpmnToCanonical,
  canonicalToBpmn,
  getElementSupport,
  validateBpmnXml,
};
