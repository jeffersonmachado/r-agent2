import { BPMN_EXTENSION_TYPES } from './bpmnExtensions';
import { createBpmnElementRegistry } from './bpmnElementRegistry';
import { registerAdvancedGatewayHandlers } from './bpmnAdvancedGatewayHandlers';
import { registerBoundaryEventHandlers } from './bpmnBoundaryEventHandlers';
import { registerDiagramInterchangeHandlers } from './bpmnDiagramInterchangeHandlers';
import { registerMessageFlowHandlers } from './bpmnMessageFlowHandlers';
import { registerPoolLaneHandlers } from './bpmnPoolLaneHandlers';

const DEFAULT_TENANT_ID = 'demo-tenant';
const DEFAULT_FLOW_ID = 'imported-bpmn-flow';
const DEFAULT_FLOW_NAME = 'Imported BPMN Flow';

const ROUTER_NODE_TYPES = new Set(['router', 'schedule_router', 'options']);
const FLOW_NODE_LOCAL_NAMES = new Set([
  'startEvent',
  'endEvent',
  'serviceTask',
  'scriptTask',
  'userTask',
  'receiveTask',
  'sendTask',
  'exclusiveGateway',
  'parallelGateway',
  'boundaryEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'callActivity',
  'messageFlow',
  'participant',
  'lane',
  'diagram',
  'plane',
  'shape',
  'edge',
]);

function asTrimmedString(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function getDomParser() {
  if (typeof DOMParser !== 'undefined') return DOMParser;

  if (typeof globalThis !== 'undefined' && typeof globalThis.DOMParser !== 'undefined') {
    return globalThis.DOMParser;
  }

  return null;
}

function parseXml(xml) {
  const Parser = getDomParser();
  if (!Parser) {
    throw new Error('DOMParser is not available in this environment.');
  }

  const doc = new Parser().parseFromString(String(xml || ''), 'application/xml');
  const parserErrors = doc.getElementsByTagName('parsererror');

  if (parserErrors.length > 0) {
    const errorMessage = asTrimmedString(parserErrors[0].textContent) || 'Invalid BPMN XML.';
    throw new Error(errorMessage);
  }

  return doc;
}

function directChildElements(element) {
  if (!element || !element.children) return [];
  return Array.from(element.children);
}

function directChildByLocalName(element, localName) {
  return directChildElements(element).find((child) => child.localName === localName) || null;
}

function directChildrenByLocalName(element, localName) {
  return directChildElements(element).filter((child) => child.localName === localName);
}

function asFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDiBounds(rawBounds = {}) {
  return {
    x: asFiniteNumber(rawBounds.x, 0),
    y: asFiniteNumber(rawBounds.y, 0),
    width: asFiniteNumber(rawBounds.width, 100),
    height: asFiniteNumber(rawBounds.height, 100),
  };
}

function normalizeDiWaypoints(waypointElements = []) {
  return waypointElements
    .map((waypointElement) => ({
      x: asFiniteNumber(waypointElement?.getAttribute('x'), 0),
      y: asFiniteNumber(waypointElement?.getAttribute('y'), 0),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function collectDiagramInterchange(definitionsElement) {
  const shapeByBpmnElementId = new Map();
  const edgeBySequenceFlowId = new Map();

  const diagrams = directChildrenByLocalName(definitionsElement, 'diagram');
  diagrams.forEach((diagramElement) => {
    const planes = directChildrenByLocalName(diagramElement, 'plane');
    planes.forEach((planeElement) => {
      const shapeElements = directChildrenByLocalName(planeElement, 'shape');
      shapeElements.forEach((shapeElement) => {
        const bpmnElement = asTrimmedString(shapeElement.getAttribute('bpmnElement'));
        if (!bpmnElement) return;

        const boundsElement = directChildByLocalName(shapeElement, 'bounds');
        const bounds = normalizeDiBounds({
          x: boundsElement?.getAttribute('x'),
          y: boundsElement?.getAttribute('y'),
          width: boundsElement?.getAttribute('width'),
          height: boundsElement?.getAttribute('height'),
        });

        shapeByBpmnElementId.set(bpmnElement, {
          id: asTrimmedString(shapeElement.getAttribute('id')) || `${bpmnElement}_di`,
          bounds,
        });
      });

      const edgeElements = directChildrenByLocalName(planeElement, 'edge');
      edgeElements.forEach((edgeElement) => {
        const bpmnElement = asTrimmedString(edgeElement.getAttribute('bpmnElement'));
        if (!bpmnElement) return;

        const waypointElements = directChildrenByLocalName(edgeElement, 'waypoint');
        const waypoints = normalizeDiWaypoints(waypointElements);
        if (waypoints.length === 0) return;

        edgeBySequenceFlowId.set(bpmnElement, {
          id: asTrimmedString(edgeElement.getAttribute('id')) || `${bpmnElement}_di`,
          waypoints,
        });
      });
    });
  });

  return {
    shapeByBpmnElementId,
    edgeBySequenceFlowId,
  };
}

function parseJsonSafe(rawText) {
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch (error) {
    return { ok: false, error };
  }
}

function parseExtensionMetadata(element, report) {
  const extensionElements = directChildByLocalName(element, 'extensionElements');
  if (!extensionElements) return null;

  const metadataElement = directChildElements(extensionElements).find(
    (child) => child.localName === 'metadata'
  );

  if (!metadataElement) {
    report.warnings.push({
      code: 'bpmn_extension_unknown',
      elementId: asTrimmedString(element.getAttribute('id')),
      message: 'Extension elements were found but no r-agent2 metadata payload was recognized.',
    });
    report.discardedExtensionCount += 1;
    return null;
  }

  const payloadType = asTrimmedString(metadataElement.getAttribute('type'));
  const payloadText = asTrimmedString(metadataElement.textContent);

  if (!payloadText) {
    report.warnings.push({
      code: 'bpmn_extension_empty_payload',
      elementId: asTrimmedString(element.getAttribute('id')),
      message: 'Extension metadata payload is empty and was ignored.',
    });
    report.discardedExtensionCount += 1;
    return null;
  }

  const parsed = parseJsonSafe(payloadText);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    report.warnings.push({
      code: 'bpmn_extension_invalid_payload',
      elementId: asTrimmedString(element.getAttribute('id')),
      message: 'Extension metadata payload is not valid JSON and was ignored.',
    });
    report.discardedExtensionCount += 1;
    return null;
  }

  report.preservedExtensionCount += 1;
  return {
    type: payloadType,
    data: parsed.value,
  };
}

function normalizeNodeName(element, fallback) {
  const byName = asTrimmedString(element.getAttribute('name'));
  return byName || fallback;
}

function parseTimerConfig(element) {
  const timerEventDefinition = directChildByLocalName(element, 'timerEventDefinition');
  if (!timerEventDefinition) return null;

  const timeDuration = directChildByLocalName(timerEventDefinition, 'timeDuration');
  const timeDate = directChildByLocalName(timerEventDefinition, 'timeDate');
  const timeCycle = directChildByLocalName(timerEventDefinition, 'timeCycle');

  const config = {};

  const durationValue = asTrimmedString(timeDuration && timeDuration.textContent);
  const dateValue = asTrimmedString(timeDate && timeDate.textContent);
  const cycleValue = asTrimmedString(timeCycle && timeCycle.textContent);

  if (durationValue) config.timeDuration = durationValue;
  if (dateValue) config.timeDate = dateValue;
  if (cycleValue) config.timeCycle = cycleValue;

  return Object.keys(config).length > 0 ? config : {};
}

function hasMessageEventDefinition(element) {
  return !!directChildByLocalName(element, 'messageEventDefinition');
}

function resolveServiceTaskType(extensionMetadata, report, elementId) {
  const extensionType = asTrimmedString(extensionMetadata && extensionMetadata.type);

  if (extensionType && extensionMetadata && extensionMetadata.data) {
    return extensionType;
  }

  report.warnings.push({
    code: 'bpmn_service_task_ambiguous',
    elementId,
    message: 'Service task has no extension metadata. Imported as api by default.',
  });
  return 'api';
}

function resolveScriptTaskType(extensionMetadata, report, elementId) {
  const extensionType = asTrimmedString(extensionMetadata && extensionMetadata.type);

  if (extensionType && extensionMetadata && extensionMetadata.data) {
    return extensionType;
  }

  report.warnings.push({
    code: 'bpmn_script_task_ambiguous',
    elementId,
    message: 'Script task has no extension metadata. Imported as set_variable by default.',
  });
  return 'set_variable';
}

function resolveGatewayType(extensionMetadata) {
  const extensionType = asTrimmedString(extensionMetadata && extensionMetadata.type);
  if (extensionType === BPMN_EXTENSION_TYPES.SCHEDULE_ROUTER) return 'schedule_router';
  return 'router';
}

function resolveNodeDescriptor(element, report, registry, options = {}) {
  const localName = element.localName;
  const bpmnElementId =
    asTrimmedString(element.getAttribute('id')) ||
    `${localName}_${Math.random().toString(36).slice(2, 8)}`;
  const extensionMetadata = parseExtensionMetadata(element, report);

  const descriptor = {
    bpmnElementId,
    localName,
    nodeType: null,
    config: {
      name: normalizeNodeName(element, localName),
    },
    degraded: false,
  };

  const registryResult = registry?.runImport(`bpmn:${localName}`, {
    element,
    report,
    extensionMetadata,
    elementId: bpmnElementId,
  });

  if (registryResult) {
    if (registryResult.nodeType) {
      descriptor.nodeType = registryResult.nodeType;
      descriptor.degraded = registryResult.degraded === true;
    }

    descriptor.config = {
      ...descriptor.config,
      ...(registryResult.configPatch && typeof registryResult.configPatch === 'object'
        ? registryResult.configPatch
        : {}),
    };
  }

  if (!descriptor.nodeType) {
    switch (localName) {
    case 'startEvent':
      descriptor.nodeType = 'start';
      break;

    case 'endEvent':
      descriptor.nodeType = 'end';
      break;

    case 'sendTask':
      descriptor.nodeType = 'message';
      descriptor.degraded = true;
      break;

    case 'receiveTask':
      descriptor.nodeType = 'user_input';
      descriptor.degraded = true;
      break;

    case 'userTask':
      descriptor.nodeType = 'handoff';
      break;

    case 'callActivity': {
      descriptor.nodeType = 'subflow';
      const calledElement = asTrimmedString(element.getAttribute('calledElement'));
      if (calledElement) descriptor.config.flowId = calledElement;
      break;
    }

    case 'serviceTask':
      descriptor.nodeType = resolveServiceTaskType(extensionMetadata, report, bpmnElementId);
      break;

    case 'scriptTask':
      descriptor.nodeType = resolveScriptTaskType(extensionMetadata, report, bpmnElementId);
      break;

    case 'exclusiveGateway':
      descriptor.nodeType = resolveGatewayType(extensionMetadata);
      break;

    case 'intermediateCatchEvent': {
      const timerConfig = parseTimerConfig(element);
      if (timerConfig !== null) {
        descriptor.nodeType = 'delay';
        descriptor.config = {
          ...descriptor.config,
          ...timerConfig,
        };
      } else if (hasMessageEventDefinition(element)) {
        descriptor.nodeType = 'user_input';
        descriptor.degraded = true;
      }
      break;
    }

    case 'intermediateThrowEvent': {
      if (hasMessageEventDefinition(element)) {
        descriptor.nodeType = 'message';
        descriptor.degraded = true;
      }
      break;
    }

    default:
      break;
    }
  }

  const diResult = registry?.runImport('bpmn:diagramInterchange', {
    element,
    report,
    elementId: bpmnElementId,
    nodeType: descriptor.nodeType,
    diShape: options.diShapeByBpmnElementId?.get(bpmnElementId) || null,
    diEdges: options.diEdgesBySourceElementId?.get(bpmnElementId) || null,
  });

  if (diResult && diResult.configPatch && typeof diResult.configPatch === 'object') {
    descriptor.config = {
      ...descriptor.config,
      ...diResult.configPatch,
    };
  }

  if (!descriptor.nodeType) {
    report.unsupportedElements.push({
      code: 'bpmn_unsupported_element',
      elementId: bpmnElementId,
      elementName: localName,
      message: 'Element is not supported in the MVP subset and was ignored.',
    });
    report.ignoredElementCount += 1;
    return null;
  }

  if (extensionMetadata && extensionMetadata.data) {
    descriptor.config = {
      ...descriptor.config,
      ...extensionMetadata.data,
    };
  }

  if (descriptor.degraded) {
    report.degradedNodes.push({
      elementId: bpmnElementId,
      elementName: localName,
      nodeType: descriptor.nodeType,
    });
  }

  return descriptor;
}

function parseSequenceFlows(processElement, report) {
  const sequenceFlows = [];

  directChildrenByLocalName(processElement, 'sequenceFlow').forEach((sequenceFlowElement) => {
    const flowId = asTrimmedString(sequenceFlowElement.getAttribute('id')) || `sf_${sequenceFlows.length + 1}`;
    const sourceRef = asTrimmedString(sequenceFlowElement.getAttribute('sourceRef'));
    const targetRef = asTrimmedString(sequenceFlowElement.getAttribute('targetRef'));

    if (!sourceRef || !targetRef) {
      report.warnings.push({
        code: 'bpmn_sequence_flow_incomplete',
        sequenceFlowId: flowId,
        message: 'Sequence flow without sourceRef/targetRef was ignored.',
      });
      report.ignoredSequenceFlowCount += 1;
      return;
    }

    const conditionExpression = directChildByLocalName(sequenceFlowElement, 'conditionExpression');
    const condition = asTrimmedString(conditionExpression && conditionExpression.textContent);

    sequenceFlows.push({
      id: flowId,
      sourceRef,
      targetRef,
      condition,
    });
  });

  return sequenceFlows;
}

function buildDiEdgesBySourceElementId(sequenceFlows, edgeBySequenceFlowId) {
  const edgesBySourceElementId = new Map();

  sequenceFlows.forEach((sequenceFlow) => {
    const diEdge = edgeBySequenceFlowId.get(sequenceFlow.id);
    if (!diEdge) return;

    if (!edgesBySourceElementId.has(sequenceFlow.sourceRef)) {
      edgesBySourceElementId.set(sequenceFlow.sourceRef, {});
    }

    edgesBySourceElementId.get(sequenceFlow.sourceRef)[sequenceFlow.id] = {
      id: diEdge.id,
      sourceRef: sequenceFlow.sourceRef,
      targetRef: sequenceFlow.targetRef,
      waypoints: diEdge.waypoints,
    };
  });

  return edgesBySourceElementId;
}

function applyConnectionsToNodes(flowNodes, outgoingBySource, report) {
  flowNodes.forEach((node) => {
    const links = outgoingBySource.get(node.id) || [];
    if (links.length === 0) return;

    if (!node.config || typeof node.config !== 'object') {
      node.config = {};
    }

    if (ROUTER_NODE_TYPES.has(node.type)) {
      const isParallelGateway =
        String(node?.config?.bpmnGatewayType || '').trim() === 'parallel';
      const conditioned = links.filter((link) => !!link.condition);
      const unconditioned = links.filter((link) => !link.condition);

      if (isParallelGateway) {
        if (conditioned.length > 0) {
          report.warnings.push({
            code: 'bpmn_parallel_gateway_condition_ignored',
            nodeId: node.id,
            message: 'Condition expressions on parallelGateway outputs were ignored.',
          });
        }

        if (links.length === 1) {
          node.next = links[0].targetId;
          return;
        }

        node.next = links.map((link) => link.targetId);
        return;
      }

      if (conditioned.length > 0) {
        const rules = conditioned.map((link, index) => ({
          condition: link.condition,
          next: link.targetId,
          output: `rule_${index + 1}`,
        }));

        node.config.rules = rules.map((rule) => ({ condition: rule.condition, next: rule.next }));

        const nextByRule = {};
        rules.forEach((rule) => {
          nextByRule[rule.output] = rule.next;
        });
        node.next = nextByRule;

        if (unconditioned.length > 0) {
          node.config.defaultNext = unconditioned[0].targetId;
          if (unconditioned.length > 1) {
            report.warnings.push({
              code: 'bpmn_gateway_multiple_defaults',
              nodeId: node.id,
              message: 'Gateway has multiple unconditional exits. Only the first one was kept as defaultNext.',
            });
          }
        }

        return;
      }

      if (links.length === 1) {
        node.next = links[0].targetId;
        return;
      }

      node.next = links.map((link) => link.targetId);
      report.warnings.push({
        code: 'bpmn_gateway_without_conditions',
        nodeId: node.id,
        message: 'Gateway has multiple exits without explicit conditions. Imported as multiple generic outputs.',
      });
      return;
    }

    const conditionedLinks = links.filter((link) => !!link.condition);
    if (conditionedLinks.length > 0) {
      report.warnings.push({
        code: 'bpmn_condition_dropped',
        nodeId: node.id,
        message: 'Condition expressions on non-gateway node outputs were ignored.',
      });
    }

    if (links.length === 1) {
      node.next = links[0].targetId;
      return;
    }

    node.next = links.map((link) => link.targetId);
    report.warnings.push({
      code: 'bpmn_multiple_outputs_non_gateway',
      nodeId: node.id,
      message: 'Non-gateway node has multiple outgoing sequence flows. Imported as multi-next array.',
    });
  });
}

function buildOutgoingMap(sequenceFlows, bpmnToEngineNodeId, report) {
  const outgoingBySource = new Map();

  sequenceFlows.forEach((sequenceFlow) => {
    const sourceNodeId = bpmnToEngineNodeId.get(sequenceFlow.sourceRef);
    const targetNodeId = bpmnToEngineNodeId.get(sequenceFlow.targetRef);

    if (!sourceNodeId || !targetNodeId) {
      report.warnings.push({
        code: 'bpmn_sequence_flow_orphan',
        sequenceFlowId: sequenceFlow.id,
        message: 'Sequence flow references unknown source/target and was ignored.',
        details: {
          sourceRef: sequenceFlow.sourceRef,
          targetRef: sequenceFlow.targetRef,
        },
      });
      report.ignoredSequenceFlowCount += 1;
      return;
    }

    if (!outgoingBySource.has(sourceNodeId)) {
      outgoingBySource.set(sourceNodeId, []);
    }

    outgoingBySource.get(sourceNodeId).push({
      targetId: targetNodeId,
      condition: sequenceFlow.condition,
      sequenceFlowId: sequenceFlow.id,
    });
  });

  return outgoingBySource;
}

function resolveProcess(doc) {
  const definitions = directChildByLocalName(doc.documentElement, 'definitions') || doc.documentElement;

  let processElement = null;
  if (definitions.localName === 'process') {
    processElement = definitions;
  } else {
    processElement = directChildrenByLocalName(definitions, 'process')[0] || null;
  }

  if (!processElement) {
    throw new Error('No BPMN process element was found in XML input.');
  }

  return {
    definitionsElement: definitions,
    processElement,
  };
}

function normalizeVersion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

export function bpmnXmlToEngineFlow(xml, options = {}) {
  const doc = parseXml(xml);
  const { definitionsElement, processElement } = resolveProcess(doc);
  const bpmnRegistry = registerDiagramInterchangeHandlers(registerPoolLaneHandlers(
    registerMessageFlowHandlers(
      registerBoundaryEventHandlers(
        registerAdvancedGatewayHandlers(createBpmnElementRegistry({ flags: options.flags }))
      )
    )
  ));

  const report = {
    warnings: [],
    degradedNodes: [],
    unsupportedElements: [],
    ignoredElementCount: 0,
    importedNodeCount: 0,
    importedSequenceFlowCount: 0,
    ignoredSequenceFlowCount: 0,
    preservedExtensionCount: 0,
    discardedExtensionCount: 0,
  };

  const sequenceFlows = parseSequenceFlows(processElement, report);
  report.importedSequenceFlowCount = sequenceFlows.length;

  const diagramInterchange = collectDiagramInterchange(definitionsElement);
  const diEdgesBySourceElementId = buildDiEdgesBySourceElementId(
    sequenceFlows,
    diagramInterchange.edgeBySequenceFlowId
  );

  const flowNodeElements = directChildElements(processElement).filter((child) =>
    FLOW_NODE_LOCAL_NAMES.has(child.localName)
  );

  const nodeDescriptors = [];
  flowNodeElements.forEach((element) => {
    const descriptor = resolveNodeDescriptor(element, report, bpmnRegistry, {
      diShapeByBpmnElementId: diagramInterchange.shapeByBpmnElementId,
      diEdgesBySourceElementId,
    });
    if (descriptor) nodeDescriptors.push(descriptor);
  });

  const flowNodes = [];
  const bpmnToEngineNodeId = new Map();

  nodeDescriptors.forEach((descriptor, index) => {
    const engineNodeId = String(index + 1);
    bpmnToEngineNodeId.set(descriptor.bpmnElementId, engineNodeId);

    flowNodes.push({
      id: engineNodeId,
      type: descriptor.nodeType,
      config: {
        ...descriptor.config,
        bpmnElementId: descriptor.bpmnElementId,
        bpmnElementName: descriptor.localName,
      },
      next: null,
    });
  });

  flowNodes.forEach((node) => {
    const attachedToRef = asTrimmedString(node?.config?.bpmnAttachedToRef);
    if (!attachedToRef) return;

    const attachedEngineId = bpmnToEngineNodeId.get(attachedToRef);
    if (attachedEngineId) {
      node.config.bpmnAttachedToNodeId = attachedEngineId;
      return;
    }

    report.warnings.push({
      code: 'bpmn_boundary_event_orphan_attachment',
      nodeId: node.id,
      message: 'Boundary event attachment target was not found in imported nodes.',
      details: { attachedToRef },
    });
  });

  flowNodes.forEach((node) => {
    const messageFlowSource = asTrimmedString(node?.config?.bpmnMessageFlowSource);
    const messageFlowTarget = asTrimmedString(node?.config?.bpmnMessageFlowTarget);

    if (messageFlowSource) {
      const sourceEngineId = bpmnToEngineNodeId.get(messageFlowSource);
      if (sourceEngineId) {
        node.config.bpmnMessageFlowSource = sourceEngineId;
      } else {
        report.warnings.push({
          code: 'bpmn_message_flow_orphan_source',
          nodeId: node.id,
          message: 'Message flow source reference was not found in imported nodes.',
          details: { originalSourceRef: messageFlowSource },
        });
      }
    }

    if (messageFlowTarget) {
      const targetEngineId = bpmnToEngineNodeId.get(messageFlowTarget);
      if (targetEngineId) {
        node.config.bpmnMessageFlowTarget = targetEngineId;
      } else {
        report.warnings.push({
          code: 'bpmn_message_flow_orphan_target',
          nodeId: node.id,
          message: 'Message flow target reference was not found in imported nodes.',
          details: { originalTargetRef: messageFlowTarget },
        });
      }
    }
  });

  const outgoingBySource = buildOutgoingMap(sequenceFlows, bpmnToEngineNodeId, report);
  applyConnectionsToNodes(flowNodes, outgoingBySource, report);

  report.importedNodeCount = flowNodes.length;

  const processId = asTrimmedString(processElement.getAttribute('id'));
  const processName = asTrimmedString(processElement.getAttribute('name'));
  const definitionsId = asTrimmedString(definitionsElement.getAttribute('id'));

  const flowId = asTrimmedString(options.id) || processId || DEFAULT_FLOW_ID;
  const flowName = asTrimmedString(options.name) || processName || DEFAULT_FLOW_NAME;

  const flowDefinition = {
    tenantId: asTrimmedString(options.tenantId) || DEFAULT_TENANT_ID,
    id: flowId,
    name: flowName,
    version: normalizeVersion(options.version),
    nodes: flowNodes,
    metadata: {
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
      bpmn: {
        sourceFormat: 'bpmn2',
        importedAt: new Date().toISOString(),
        definitionsId,
        processId,
      },
      bpmnImportReport: {
        warnings: report.warnings,
        degradedNodes: report.degradedNodes,
        unsupportedElements: report.unsupportedElements,
      },
    },
  };

  return {
    flowDefinition,
    report,
  };
}

export default bpmnXmlToEngineFlow;
