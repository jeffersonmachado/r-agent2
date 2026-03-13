const REQUIRED_BPMN_TYPES = new Set([
  'StartEvent',
  'EndEvent',
  'Task',
  'UserTask',
  'ServiceTask',
  'ScriptTask',
  'ManualTask',
  'ExclusiveGateway',
  'ParallelGateway',
  'InclusiveGateway',
  'EventBasedGateway',
  'SubProcess',
  'SequenceFlow',
  'MessageFlow',
  'Association',
  'DataStoreReference',
  'TextAnnotation',
  'Lane',
  'Participant',
]);

const EXECUTABLE_BPMN_TYPES = new Set([
  'StartEvent',
  'EndEvent',
  'Task',
  'UserTask',
  'ServiceTask',
  'ScriptTask',
  'ManualTask',
  'ExclusiveGateway',
  'ParallelGateway',
  'InclusiveGateway',
  'EventBasedGateway',
  'SubProcess',
]);

function toShortType(rawType) {
  const value = String(rawType || '');
  return value.startsWith('bpmn:') ? value.slice(5) : value;
}

function normalizeLabel(element) {
  const businessObject = element?.businessObject;
  const byName = String(businessObject?.name || '').trim();
  if (byName) return byName;
  return String(businessObject?.id || element?.id || '').trim();
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractBounds(element) {
  const x = finiteOrNull(element?.x);
  const y = finiteOrNull(element?.y);
  const width = finiteOrNull(element?.width);
  const height = finiteOrNull(element?.height);

  return {
    x,
    y,
    width,
    height,
  };
}

function extractWaypoints(element) {
  if (!Array.isArray(element?.waypoints)) return [];

  return element.waypoints
    .map((point) => ({
      x: finiteOrNull(point?.x),
      y: finiteOrNull(point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function mapElementRecord(element) {
  const businessObject = element?.businessObject;
  const bpmnType = toShortType(businessObject?.$type || element?.type || '');
  const id = String(businessObject?.id || element?.id || '').trim();
  if (!id || !bpmnType) return null;

  const bounds = extractBounds(element);
  const waypoints = extractWaypoints(element);

  const source = String(
    businessObject?.sourceRef?.id ||
    element?.source?.businessObject?.id ||
    element?.source?.id ||
    ''
  ).trim();

  const target = String(
    businessObject?.targetRef?.id ||
    element?.target?.businessObject?.id ||
    element?.target?.id ||
    ''
  ).trim();

  const record = {
    id,
    type: bpmnType,
    label: normalizeLabel(element),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    waypoints,
    source: source || null,
    target: target || null,
  };

  return record;
}

function mapBpmnTypeToInternalType(bpmnType) {
  if (bpmnType === 'StartEvent') return 'start';
  if (bpmnType === 'EndEvent') return 'end';

  if (
    bpmnType === 'Task' ||
    bpmnType === 'UserTask' ||
    bpmnType === 'ServiceTask' ||
    bpmnType === 'ScriptTask' ||
    bpmnType === 'ManualTask' ||
    bpmnType === 'SubProcess'
  ) {
    return 'message';
  }

  if (
    bpmnType === 'ExclusiveGateway' ||
    bpmnType === 'ParallelGateway' ||
    bpmnType === 'InclusiveGateway' ||
    bpmnType === 'EventBasedGateway'
  ) {
    return 'router';
  }

  return null;
}

function isSupportedBpmnRecord(record) {
  return !!record && REQUIRED_BPMN_TYPES.has(record.type);
}

function getRootMetadata(modeler, options = {}) {
  const canvas = modeler.get('canvas');
  const rootElement = canvas?.getRootElement?.();
  const rootBusinessObject = rootElement?.businessObject;

  const inferredId = String(options.flowId || rootBusinessObject?.id || 'bpmn-imported-flow').trim();
  const inferredName = String(options.flowName || rootBusinessObject?.name || inferredId || 'Imported BPMN Flow').trim();

  return {
    id: inferredId || 'bpmn-imported-flow',
    name: inferredName || 'Imported BPMN Flow',
    rootType: toShortType(rootBusinessObject?.$type || rootElement?.type || ''),
  };
}

export async function bpmnToInternalFlow(modeler, options = {}) {
  if (!modeler || typeof modeler.get !== 'function') {
    throw new Error('BPMN modeler instance is required.');
  }

  const elementRegistry = modeler.get('elementRegistry');
  const allElements = Array.isArray(elementRegistry?.getAll?.()) ? elementRegistry.getAll() : [];

  const mappedRecords = allElements
    .filter((element) => !!element?.businessObject && !element?.labelTarget)
    .map(mapElementRecord)
    .filter(isSupportedBpmnRecord);

  const nodesForEditor = [];
  const nodeById = new Map();
  const positions = {};

  mappedRecords
    .filter((record) => EXECUTABLE_BPMN_TYPES.has(record.type))
    .forEach((record) => {
      const internalType = mapBpmnTypeToInternalType(record.type);
      if (!internalType) return;

      const node = {
        id: record.id,
        type: internalType,
        config: {},
        next: null,
      };

      if (internalType === 'message') {
        node.config = {
          text: record.label || record.id,
          bpmnType: record.type,
          bpmnElementId: record.id,
        };
      }

      if (internalType === 'router') {
        node.config = {
          bpmnType: record.type,
          bpmnElementId: record.id,
          rules: [],
        };
      }

      nodeById.set(node.id, node);
      nodesForEditor.push(node);

      if (Number.isFinite(record.x) && Number.isFinite(record.y)) {
        positions[node.id] = [record.x, record.y];
      }
    });

  const sequenceFlows = mappedRecords.filter((record) => record.type === 'SequenceFlow');
  const outgoingBySource = new Map();

  sequenceFlows.forEach((edge) => {
    if (!edge.source || !edge.target) return;
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;

    const current = outgoingBySource.get(edge.source) || [];
    current.push(edge);
    outgoingBySource.set(edge.source, current);
  });

  nodesForEditor.forEach((node) => {
    const outgoing = outgoingBySource.get(node.id) || [];
    if (outgoing.length === 0) {
      node.next = null;
      return;
    }

    const targets = outgoing
      .map((edge) => edge.target)
      .filter((targetId) => !!targetId && nodeById.has(targetId));

    if (targets.length === 0) {
      node.next = null;
      return;
    }

    if (node.type === 'router') {
      node.config.rules = outgoing.map((edge, index) => {
        const fallback = index === outgoing.length - 1;
        return {
          id: `rule_${index + 1}`,
          condition: fallback
            ? { op: 'always' }
            : {
              op: 'equals',
              var: 'bpmn_route',
              value: edge.label || `route_${index + 1}`,
            },
          next: edge.target,
        };
      });

      node.next = targets.length === 1 ? targets[0] : targets;
      return;
    }

    node.next = targets.length === 1 ? targets[0] : targets;
  });

  const root = getRootMetadata(modeler, options);

  let sourceXml = typeof options.sourceXml === 'string' ? options.sourceXml : null;
  if (!sourceXml && options.includeSourceXml === true && typeof modeler.saveXML === 'function') {
    try {
      const result = await modeler.saveXML({ format: true, preamble: true });
      sourceXml = String(result?.xml || '').trim() || null;
    } catch {
      sourceXml = null;
    }
  }

  const internalFlow = {
    tenantId: String(options.tenantId || 'demo-tenant'),
    id: root.id,
    name: root.name,
    version: Number.isFinite(options.version) ? Number(options.version) : 1,
    kind: String(options.kind || 'chat'),
    nodes: nodesForEditor,
    metadata: {
      positions,
      bpmn: {
        rootType: root.rootType,
        elements: mappedRecords,
        sourceXml,
      },
    },
  };

  return {
    internalFlow,
    mappedElements: mappedRecords,
  };
}

export default bpmnToInternalFlow;
