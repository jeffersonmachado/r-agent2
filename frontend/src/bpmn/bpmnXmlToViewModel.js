const BPMN_VIEW_NODE_LOCAL_NAMES = new Set([
  'startEvent',
  'endEvent',
  'task',
  'manualTask',
  'serviceTask',
  'scriptTask',
  'userTask',
  'receiveTask',
  'sendTask',
  'exclusiveGateway',
  'eventBasedGateway',
  'inclusiveGateway',
  'parallelGateway',
  'boundaryEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'callActivity',
  'dataStoreReference',
  'dataObjectReference',
]);

function asTrimmedString(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function asFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localNameEquals(element, expected) {
  const actual = String(element?.localName || '').trim().toLowerCase();
  const normalizedExpected = String(expected || '').trim().toLowerCase();
  if (!actual || !normalizedExpected) return false;
  return actual === normalizedExpected || actual.endsWith(normalizedExpected);
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
  return directChildElements(element).find((child) => localNameEquals(child, localName)) || null;
}

function directChildrenByLocalName(element, localName) {
  return directChildElements(element).filter((child) => localNameEquals(child, localName));
}

function normalizeBounds(rawBounds = {}, fallback = {}) {
  const defaults = {
    x: asFiniteNumber(fallback.x, 0),
    y: asFiniteNumber(fallback.y, 0),
    width: asFiniteNumber(fallback.width, 140),
    height: asFiniteNumber(fallback.height, 80),
  };

  return {
    x: asFiniteNumber(rawBounds.x, defaults.x),
    y: asFiniteNumber(rawBounds.y, defaults.y),
    width: asFiniteNumber(rawBounds.width, defaults.width),
    height: asFiniteNumber(rawBounds.height, defaults.height),
  };
}

function normalizeWaypoints(rawWaypoints = []) {
  if (!Array.isArray(rawWaypoints)) return [];

  return rawWaypoints
    .map((point) => ({
      x: asFiniteNumber(point?.x, NaN),
      y: asFiniteNumber(point?.y, NaN),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function defaultNodeBounds(localName, index) {
  const column = index % 5;
  const row = Math.floor(index / 5);
  const base = {
    x: 120 + column * 220,
    y: 120 + row * 140,
    width: 140,
    height: 80,
  };

  if (localName === 'startEvent' || localName === 'endEvent' || localName === 'intermediateCatchEvent' || localName === 'intermediateThrowEvent' || localName === 'boundaryEvent') {
    return { ...base, width: 42, height: 42 };
  }

  if (localName === 'exclusiveGateway' || localName === 'parallelGateway' || localName === 'eventBasedGateway' || localName === 'inclusiveGateway') {
    return { ...base, width: 64, height: 64 };
  }

  if (localName === 'dataStoreReference' || localName === 'dataObjectReference') {
    return { ...base, width: 72, height: 90 };
  }

  return base;
}

function computeBoundsFromBoundsList(boundsList, padding = 40) {
  const normalized = (Array.isArray(boundsList) ? boundsList : [])
    .filter((bounds) => bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y))
    .map((bounds) => normalizeBounds(bounds));

  if (normalized.length === 0) return null;

  const minX = Math.min(...normalized.map((bounds) => bounds.x));
  const minY = Math.min(...normalized.map((bounds) => bounds.y));
  const maxX = Math.max(...normalized.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...normalized.map((bounds) => bounds.y + bounds.height));

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(200, maxX - minX + padding * 2),
    height: Math.max(120, maxY - minY + padding * 2),
  };
}

function collectLabelBounds(containerElement) {
  const labelElement = directChildElements(containerElement).find((child) => localNameEquals(child, 'label'));
  if (!labelElement) return null;

  const boundsElement = directChildElements(labelElement).find((child) => localNameEquals(child, 'bounds'));
  if (!boundsElement) return null;

  return {
    id: asTrimmedString(labelElement.getAttribute('id')) || null,
    bounds: normalizeBounds({
      x: boundsElement.getAttribute('x'),
      y: boundsElement.getAttribute('y'),
      width: boundsElement.getAttribute('width'),
      height: boundsElement.getAttribute('height'),
    }),
  };
}

function collectDiagramInterchange(definitionsElement) {
  const shapeByElementId = new Map();
  const edgeByElementId = new Map();
  const labelByElementId = new Map();
  const diagramMeta = [];

  directChildrenByLocalName(definitionsElement, 'diagram').forEach((diagramElement) => {
    const diagramId = asTrimmedString(diagramElement.getAttribute('id')) || `Diagram_${diagramMeta.length + 1}`;

    directChildrenByLocalName(diagramElement, 'plane').forEach((planeElement) => {
      const planeId = asTrimmedString(planeElement.getAttribute('id')) || `${diagramId}_plane`;
      const planeBpmnElement = asTrimmedString(planeElement.getAttribute('bpmnElement'));

      diagramMeta.push({
        id: diagramId,
        planeId,
        planeBpmnElement,
      });

      directChildrenByLocalName(planeElement, 'shape').forEach((shapeElement) => {
        const elementId = asTrimmedString(shapeElement.getAttribute('bpmnElement'));
        if (!elementId) return;

        const boundsElement = directChildElements(shapeElement).find((child) => localNameEquals(child, 'bounds'));
        if (boundsElement) {
          shapeByElementId.set(elementId, {
            id: asTrimmedString(shapeElement.getAttribute('id')) || `${elementId}_di`,
            bounds: normalizeBounds({
              x: boundsElement.getAttribute('x'),
              y: boundsElement.getAttribute('y'),
              width: boundsElement.getAttribute('width'),
              height: boundsElement.getAttribute('height'),
            }),
          });
        }

        const label = collectLabelBounds(shapeElement);
        if (label) {
          labelByElementId.set(elementId, label);
        }
      });

      directChildrenByLocalName(planeElement, 'edge').forEach((edgeElement) => {
        const elementId = asTrimmedString(edgeElement.getAttribute('bpmnElement'));
        if (!elementId) return;

        const waypoints = normalizeWaypoints(
          directChildrenByLocalName(edgeElement, 'waypoint').map((waypointElement) => ({
            x: waypointElement.getAttribute('x'),
            y: waypointElement.getAttribute('y'),
          }))
        );

        edgeByElementId.set(elementId, {
          id: asTrimmedString(edgeElement.getAttribute('id')) || `${elementId}_di`,
          waypoints,
        });

        const label = collectLabelBounds(edgeElement);
        if (label) {
          labelByElementId.set(elementId, label);
        }
      });
    });
  });

  return {
    shapeByElementId,
    edgeByElementId,
    labelByElementId,
    diagramMeta,
  };
}

function resolveDefinitions(doc) {
  const root = doc?.documentElement || null;
  if (!root) {
    throw new Error('No BPMN XML root element was found.');
  }

  if (localNameEquals(root, 'definitions')) {
    return root;
  }

  return directChildByLocalName(root, 'definitions') || root;
}

function findEventDefinitionType(element) {
  if (!element) return null;
  if (directChildByLocalName(element, 'timerEventDefinition')) return 'timer';
  if (directChildByLocalName(element, 'messageEventDefinition')) return 'message';
  if (directChildByLocalName(element, 'errorEventDefinition')) return 'error';
  return null;
}

function inferNodeCategory(localName) {
  if (localName === 'exclusiveGateway' || localName === 'parallelGateway' || localName === 'inclusiveGateway' || localName === 'eventBasedGateway') return 'gateway';
  if (localName === 'dataStoreReference' || localName === 'dataObjectReference') return 'data';
  if (localName.endsWith('Event')) return 'event';
  return 'task';
}

function collectLaneRecords({
  laneElements,
  laneSetRef,
  participantRef,
  processRef,
  shapeByElementId,
  labelByElementId,
  lanes,
}) {
  laneElements.forEach((laneElement) => {
    const laneId = asTrimmedString(laneElement.getAttribute('id'));
    if (!laneId) return;

    const childLaneSets = directChildrenByLocalName(laneElement, 'childLaneSet');
    const directChildLanes = directChildrenByLocalName(laneElement, 'lane');
    const nodeRefs = directChildrenByLocalName(laneElement, 'flowNodeRef')
      .map((flowNodeRefElement) => asTrimmedString(flowNodeRefElement.textContent))
      .filter(Boolean);

    lanes.push({
      id: laneId,
      name: asTrimmedString(laneElement.getAttribute('name')) || laneId,
      participantRef,
      processRef,
      laneSetRef,
      bounds: shapeByElementId.get(laneId)?.bounds || null,
      labelBounds: labelByElementId.get(laneId)?.bounds || null,
      nodeRefs,
      childLaneIds: [],
    });

    childLaneSets.forEach((childLaneSetElement) => {
      const childLaneSetRef = asTrimmedString(childLaneSetElement.getAttribute('id')) || `${laneId}_childLaneSet`;
      const nestedLaneElements = directChildrenByLocalName(childLaneSetElement, 'lane');
      const nestedLanes = [];
      collectLaneRecords({
        laneElements: nestedLaneElements,
        laneSetRef: childLaneSetRef,
        participantRef,
        processRef,
        shapeByElementId,
        labelByElementId,
        lanes: nestedLanes,
      });
      const currentLane = lanes.find((lane) => lane.id === laneId);
      if (currentLane) {
        currentLane.childLaneIds = nestedLanes.map((lane) => lane.id);
      }
      lanes.push(...nestedLanes);
    });

    if (directChildLanes.length > 0) {
      const nestedLanes = [];
      collectLaneRecords({
        laneElements: directChildLanes,
        laneSetRef: laneSetRef || `${laneId}_laneSet`,
        participantRef,
        processRef,
        shapeByElementId,
        labelByElementId,
        lanes: nestedLanes,
      });
      lanes.push(...nestedLanes);
    }
  });
}

function ensureParticipantBounds(participant, lanes, nodes) {
  if (participant.bounds) return participant;

  const laneBounds = lanes
    .filter((lane) => lane.participantRef === participant.id && lane.bounds)
    .map((lane) => lane.bounds);
  const nodeBounds = nodes
    .filter((node) => node.participantRef === participant.id || node.processRef === participant.processRef)
    .map((node) => node.bounds);

  const computed = computeBoundsFromBoundsList([...laneBounds, ...nodeBounds], 48);
  if (!computed) return participant;

  return {
    ...participant,
    bounds: computed,
  };
}

function fillLaneBounds(participants, lanes) {
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  return lanes.map((lane, index, allLanes) => {
    if (lane.bounds) return lane;

    const participant = participantById.get(lane.participantRef);
    if (!participant?.bounds) return lane;

    const siblingLanes = allLanes.filter((candidate) => candidate.participantRef === lane.participantRef);
    const siblingIndex = Math.max(0, siblingLanes.findIndex((candidate) => candidate.id === lane.id));
    const laneHeight = participant.bounds.height / Math.max(1, siblingLanes.length);

    return {
      ...lane,
      bounds: {
        x: participant.bounds.x,
        y: participant.bounds.y + laneHeight * siblingIndex,
        width: participant.bounds.width,
        height: laneHeight,
      },
    };
  });
}

function getBoundsCenter(bounds) {
  if (!bounds) return null;

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function buildFallbackWaypoints(sourceBounds, targetBounds) {
  const sourceCenter = getBoundsCenter(sourceBounds);
  const targetCenter = getBoundsCenter(targetBounds);
  if (!sourceCenter || !targetCenter) return [];

  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  // Connect from the nearest side of each element when BPMN DI edges are missing.
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sourceAnchorX = sourceCenter.x + (dx >= 0 ? sourceBounds.width / 2 : -sourceBounds.width / 2);
    const targetAnchorX = targetCenter.x - (dx >= 0 ? targetBounds.width / 2 : -targetBounds.width / 2);
    return [
      { x: sourceAnchorX, y: sourceCenter.y },
      { x: targetAnchorX, y: targetCenter.y },
    ];
  }

  const sourceAnchorY = sourceCenter.y + (dy >= 0 ? sourceBounds.height / 2 : -sourceBounds.height / 2);
  const targetAnchorY = targetCenter.y - (dy >= 0 ? targetBounds.height / 2 : -targetBounds.height / 2);
  return [
    { x: sourceCenter.x, y: sourceAnchorY },
    { x: targetCenter.x, y: targetAnchorY },
  ];
}

function resolveFlowEndpointBounds(endpointRef, nodeById, participantById) {
  if (!endpointRef) return null;

  const node = nodeById.get(endpointRef);
  if (node?.bounds) return node.bounds;

  const participant = participantById.get(endpointRef);
  if (participant?.bounds) return participant.bounds;

  return null;
}

function buildViewport(participants, lanes, nodes, sequenceFlows, messageFlows, options = {}) {
  const preserveDiCoordinates = options.preserveDiCoordinates === true;
  const boundsCandidates = [
    ...participants.map((participant) => participant.bounds),
    ...lanes.map((lane) => lane.bounds),
    ...nodes.map((node) => node.bounds),
  ].filter(Boolean);

  const waypointCandidates = [
    ...sequenceFlows.flatMap((flow) => flow.waypoints || []),
    ...messageFlows.flatMap((flow) => flow.waypoints || []),
  ];

  const hasBounds = boundsCandidates.length > 0;
  const hasWaypoints = waypointCandidates.length > 0;
  if (!hasBounds && !hasWaypoints) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
      width: 1200,
      height: 800,
    };
  }

  const boundsMinX = hasBounds ? Math.min(...boundsCandidates.map((bounds) => bounds.x)) : Infinity;
  const boundsMinY = hasBounds ? Math.min(...boundsCandidates.map((bounds) => bounds.y)) : Infinity;
  const waypointMinX = hasWaypoints ? Math.min(...waypointCandidates.map((point) => point.x)) : Infinity;
  const waypointMinY = hasWaypoints ? Math.min(...waypointCandidates.map((point) => point.y)) : Infinity;

  const boundsMaxX = hasBounds ? Math.max(...boundsCandidates.map((bounds) => bounds.x + bounds.width)) : -Infinity;
  const boundsMaxY = hasBounds ? Math.max(...boundsCandidates.map((bounds) => bounds.y + bounds.height)) : -Infinity;
  const waypointMaxX = hasWaypoints ? Math.max(...waypointCandidates.map((point) => point.x)) : -Infinity;
  const waypointMaxY = hasWaypoints ? Math.max(...waypointCandidates.map((point) => point.y)) : -Infinity;

  const computedMinX = Math.min(boundsMinX, waypointMinX);
  const computedMinY = Math.min(boundsMinY, waypointMinY);
  const computedMaxX = Math.max(boundsMaxX, waypointMaxX);
  const computedMaxY = Math.max(boundsMaxY, waypointMaxY);

  if (preserveDiCoordinates) {
    return {
      minX: computedMinX,
      minY: computedMinY,
      maxX: computedMaxX,
      maxY: computedMaxY,
      width: Math.max(1200, Math.ceil(Math.max(0, computedMaxX) + 120)),
      height: Math.max(800, Math.ceil(Math.max(0, computedMaxY) + 120)),
    };
  }

  const minX = Math.min(
    ...boundsCandidates.map((bounds) => bounds.x),
    ...waypointCandidates.map((point) => point.x),
    0
  );
  const minY = Math.min(
    ...boundsCandidates.map((bounds) => bounds.y),
    ...waypointCandidates.map((point) => point.y),
    0
  );
  const maxX = Math.max(
    ...boundsCandidates.map((bounds) => bounds.x + bounds.width),
    ...waypointCandidates.map((point) => point.x),
    1200
  );
  const maxY = Math.max(
    ...boundsCandidates.map((bounds) => bounds.y + bounds.height),
    ...waypointCandidates.map((point) => point.y),
    800
  );

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1200, maxX - minX + 120),
    height: Math.max(800, maxY - minY + 120),
  };
}

export function bpmnXmlToViewModel(xml, options = {}) {
  const doc = parseXml(xml);
  const definitionsElement = resolveDefinitions(doc);
  const processElements = directChildrenByLocalName(definitionsElement, 'process');
  if (processElements.length === 0) {
    throw new Error('No BPMN process element was found in XML input.');
  }

  const collaborationElement = directChildByLocalName(definitionsElement, 'collaboration');
  const { shapeByElementId, edgeByElementId, labelByElementId, diagramMeta } = collectDiagramInterchange(definitionsElement);
  const hasDiagramInterchangeData =
    diagramMeta.length > 0 &&
    (shapeByElementId.size > 0 || edgeByElementId.size > 0 || labelByElementId.size > 0);

  const participants = [];
  const participantByProcessRef = new Map();

  if (collaborationElement) {
    directChildrenByLocalName(collaborationElement, 'participant').forEach((participantElement) => {
      const participantId = asTrimmedString(participantElement.getAttribute('id'));
      if (!participantId) return;

      const processRef = asTrimmedString(participantElement.getAttribute('processRef'));
      const participant = {
        id: participantId,
        name: asTrimmedString(participantElement.getAttribute('name')) || participantId,
        processRef,
        bounds: shapeByElementId.get(participantId)?.bounds || null,
        labelBounds: labelByElementId.get(participantId)?.bounds || null,
      };

      participants.push(participant);
      if (processRef) {
        participantByProcessRef.set(processRef, participantId);
      }
    });
  }

  const laneSets = [];
  const lanes = [];
  processElements.forEach((processElement) => {
    const processRef = asTrimmedString(processElement.getAttribute('id'));
    const participantRef = processRef ? participantByProcessRef.get(processRef) || null : null;

    directChildrenByLocalName(processElement, 'laneSet').forEach((laneSetElement, laneSetIndex) => {
      const laneSetId = asTrimmedString(laneSetElement.getAttribute('id')) || `${processRef || 'Process'}_laneSet_${laneSetIndex + 1}`;
      const laneElements = directChildrenByLocalName(laneSetElement, 'lane');
      laneSets.push({
        id: laneSetId,
        processRef,
        participantRef,
        laneIds: laneElements.map((laneElement) => asTrimmedString(laneElement.getAttribute('id'))).filter(Boolean),
      });

      collectLaneRecords({
        laneElements,
        laneSetRef: laneSetId,
        participantRef,
        processRef,
        shapeByElementId,
        labelByElementId,
        lanes,
      });
    });
  });

  const nodeLaneMap = new Map();
  lanes.forEach((lane) => {
    (lane.nodeRefs || []).forEach((nodeRef) => {
      if (!nodeRef || nodeLaneMap.has(nodeRef)) return;
      nodeLaneMap.set(nodeRef, lane.id);
    });
  });

  const nodes = [];
  processElements.forEach((processElement) => {
    const processRef = asTrimmedString(processElement.getAttribute('id'));
    const participantRef = processRef ? participantByProcessRef.get(processRef) || null : null;
    const flowNodeElements = directChildElements(processElement).filter((child) => BPMN_VIEW_NODE_LOCAL_NAMES.has(child.localName));

    flowNodeElements.forEach((element, index) => {
      const elementId = asTrimmedString(element.getAttribute('id'));
      if (!elementId) return;

      nodes.push({
        id: elementId,
        name: asTrimmedString(element.getAttribute('name')) || elementId,
        bpmnType: element.localName,
        category: inferNodeCategory(element.localName),
        processRef,
        participantRef,
        laneRef: nodeLaneMap.get(elementId) || null,
        bounds: hasDiagramInterchangeData
          ? shapeByElementId.get(elementId)?.bounds || null
          : shapeByElementId.get(elementId)?.bounds || defaultNodeBounds(element.localName, index),
        labelBounds: labelByElementId.get(elementId)?.bounds || null,
        attachedToRef: asTrimmedString(element.getAttribute('attachedToRef')) || null,
        eventDefinitionType: findEventDefinitionType(element),
        isExpanded: element.getAttribute('isExpanded') === 'true',
      });
    });
  });

  const normalizedParticipants = hasDiagramInterchangeData
    ? participants
    : participants.map((participant) => ensureParticipantBounds(participant, lanes, nodes));
  const normalizedLanes = hasDiagramInterchangeData
    ? lanes
    : fillLaneBounds(normalizedParticipants, lanes);
  const processRefByParticipantId = new Map(
    normalizedParticipants.map((participant) => [participant.id, participant.processRef || null])
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const participantById = new Map(normalizedParticipants.map((participant) => [participant.id, participant]));

  const sequenceFlows = [];
  processElements.forEach((processElement) => {
    const processRef = asTrimmedString(processElement.getAttribute('id'));
    directChildrenByLocalName(processElement, 'sequenceFlow').forEach((sequenceFlowElement) => {
      const sequenceFlowId = asTrimmedString(sequenceFlowElement.getAttribute('id'));
      if (!sequenceFlowId) return;

      const sourceRef = asTrimmedString(sequenceFlowElement.getAttribute('sourceRef'));
      const targetRef = asTrimmedString(sequenceFlowElement.getAttribute('targetRef'));
      const diWaypoints = edgeByElementId.get(sequenceFlowId)?.waypoints || [];
      const fallbackWaypoints = hasDiagramInterchangeData
        ? []
        : buildFallbackWaypoints(
          resolveFlowEndpointBounds(sourceRef, nodeById, participantById),
          resolveFlowEndpointBounds(targetRef, nodeById, participantById)
        );

      sequenceFlows.push({
        id: sequenceFlowId,
        name: asTrimmedString(sequenceFlowElement.getAttribute('name')) || sequenceFlowId,
        processRef,
        sourceRef,
        targetRef,
        waypoints: diWaypoints.length > 0 ? diWaypoints : fallbackWaypoints,
        labelBounds: labelByElementId.get(sequenceFlowId)?.bounds || null,
      });
    });
  });

  const messageFlows = collaborationElement
    ? directChildrenByLocalName(collaborationElement, 'messageFlow').map((messageFlowElement) => {
        const messageFlowId = asTrimmedString(messageFlowElement.getAttribute('id'));
        const sourceRef = asTrimmedString(messageFlowElement.getAttribute('sourceRef'));
        const targetRef = asTrimmedString(messageFlowElement.getAttribute('targetRef'));
        const diWaypoints = edgeByElementId.get(messageFlowId)?.waypoints || [];
        const fallbackWaypoints = hasDiagramInterchangeData
          ? []
          : buildFallbackWaypoints(
            resolveFlowEndpointBounds(sourceRef, nodeById, participantById),
            resolveFlowEndpointBounds(targetRef, nodeById, participantById)
          );

        return {
          id: messageFlowId,
          name: asTrimmedString(messageFlowElement.getAttribute('name')) || messageFlowId,
          sourceRef,
          targetRef,
          sourceParticipantRef: sourceRef,
          targetParticipantRef: targetRef,
          sourceProcessRef: processRefByParticipantId.get(sourceRef) || null,
          targetProcessRef: processRefByParticipantId.get(targetRef) || null,
          waypoints: diWaypoints.length > 0 ? diWaypoints : fallbackWaypoints,
          labelBounds: labelByElementId.get(messageFlowId)?.bounds || null,
        };
      }).filter((messageFlow) => !!messageFlow.id)
    : [];

  const labels = Array.from(labelByElementId.entries()).map(([elementId, label]) => ({
    elementId,
    id: label.id || `${elementId}_label`,
    bounds: label.bounds,
  }));

  return {
    diagramType: 'bpmn',
    sourceXml: String(xml || ''),
    collaboration: collaborationElement
      ? {
          id: asTrimmedString(collaborationElement.getAttribute('id')) || 'Collaboration_1',
          name: asTrimmedString(collaborationElement.getAttribute('name')) || null,
        }
      : null,
    metadata: {
      definitionsId: asTrimmedString(definitionsElement.getAttribute('id')) || null,
      targetNamespace: asTrimmedString(definitionsElement.getAttribute('targetNamespace')) || null,
      importedAt: new Date().toISOString(),
      diagramMeta,
      sourceName: asTrimmedString(options.name) || null,
    },
    processes: processElements.map((processElement) => {
      const processId = asTrimmedString(processElement.getAttribute('id'));
      return {
        id: processId,
        name: asTrimmedString(processElement.getAttribute('name')) || processId,
        participantRef: processId ? participantByProcessRef.get(processId) || null : null,
      };
    }),
    participants: normalizedParticipants,
    laneSets,
    lanes: normalizedLanes,
    nodes,
    sequenceFlows,
    messageFlows,
    labels,
    viewport: buildViewport(normalizedParticipants, normalizedLanes, nodes, sequenceFlows, messageFlows, {
      preserveDiCoordinates: hasDiagramInterchangeData,
    }),
  };
}

export default bpmnXmlToViewModel;