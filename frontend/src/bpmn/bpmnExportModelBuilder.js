import {
  BPMN_COMPATIBILITY_STATUS,
  getNodeBpmnMapping,
  requiresExtension,
} from './bpmnNodeMapping';
import {
  buildNodeExtensionPayload,
  RAGENT2_BPMN_EXTENSION_PREFIX,
} from './bpmnExtensions';
import { sanitizeBpmnId, buildExtensionElementsLines } from './bpmnXmlBuilder';
import {
  buildNodeLinks,
  elementPrefix,
  mappingToBpmnTag,
  nodeLabel,
  normalizeNodeId,
} from './bpmnExportHelpers';
import {
  applyReferenceResolutionRule,
  applySpecialReferenceResolver,
} from './bpmnReferenceResolution';

const EXPORT_HANDLER_KEYS = Object.freeze([
  'bpmn:parallelGateway',
  'bpmn:boundaryEvent',
  'bpmn:messageFlow',
  'bpmn:participant',
  'bpmn:lane',
]);

function resolveExportTag(node, report, bpmnRegistry, baseResolvedTag) {
  let resolvedTag = baseResolvedTag;

  EXPORT_HANDLER_KEYS.forEach((handlerKey) => {
    const result = bpmnRegistry.runExport(handlerKey, {
      node,
      report,
      resolvedTag,
    });

    if (result && result.tag) {
      resolvedTag = {
        ...resolvedTag,
        ...result,
      };
    }
  });

  return resolvedTag;
}

function buildDescriptorForNode(node, index, report, exportOptions, bpmnRegistry) {
  const nodeId = normalizeNodeId(node && node.id) || `node_${index + 1}`;
  const nodeType = String((node && node.type) || 'unknown').trim() || 'unknown';
  const mapping = getNodeBpmnMapping(nodeType);
  const mappingStatus = mapping?.status || BPMN_COMPATIBILITY_STATUS.NOT_SUPPORTED;

  const resolvedTag = resolveExportTag(
    node,
    report,
    bpmnRegistry,
    mappingToBpmnTag(mapping)
  );

  const prefix = elementPrefix(resolvedTag.tag, resolvedTag.isTimerCatch);
  const elementId = `${prefix}_${sanitizeBpmnId(nodeId, `n${index + 1}`)}`;

  const attrs = {
    id: elementId,
    name: nodeLabel({ ...node, id: nodeId, type: nodeType }),
  };

  if (resolvedTag.tag === 'bpmn:callActivity') {
    const calledElement =
      node?.config?.calledElement ||
      node?.config?.flowId ||
      node?.config?.subflowId ||
      node?.config?.targetFlowId ||
      `subflow_${nodeId}`;
    attrs.calledElement = sanitizeBpmnId(calledElement, `subflow_${nodeId}`);
  }

  const needsExtension = requiresExtension(nodeType);
  const extensionPayload = needsExtension
    ? buildNodeExtensionPayload(nodeType, node?.config || {})
    : null;

  let extensionLines = [];
  if (exportOptions.includeExtensions && extensionPayload) {
    extensionLines = buildExtensionElementsLines(extensionPayload, {
      prefix: RAGENT2_BPMN_EXTENSION_PREFIX,
    });
    if (extensionLines.length > 0) report.extensionNodeCount += 1;
  } else if (!exportOptions.includeExtensions && needsExtension) {
    report.warnings.push({
      code: 'bpmn_extension_omitted',
      nodeId,
      nodeType,
      message: 'Node-specific r-agent2 extension metadata was omitted in simple export mode.',
    });
  }

  if (
    mappingStatus === BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION ||
    mappingStatus === BPMN_COMPATIBILITY_STATUS.NOT_SUPPORTED ||
    resolvedTag.degraded
  ) {
    report.degradedNodes.push({
      nodeId,
      nodeType,
      status: mappingStatus,
    });
  }

  return {
    nodeId,
    nodeType,
    elementId,
    originalBpmnElementId: normalizeNodeId(node?.config?.bpmnElementId),
    tag: resolvedTag.tag,
    attrs,
    isTimerCatch: resolvedTag.isTimerCatch === true,
    boundaryEventType: resolvedTag.boundaryEventType || null,
    boundaryAttachedToNodeId: resolvedTag.boundaryAttachedToNodeId || null,
    boundaryAttachedToRef: resolvedTag.boundaryAttachedToRef || null,
    messageFlowType: resolvedTag.messageFlowType || null,
    messageFlowSourceRef: resolvedTag.sourceRef || null,
    messageFlowTargetRef: resolvedTag.targetRef || null,
    poolType: resolvedTag.poolType || null,
    participantProcessRef: resolvedTag.processRef || null,
    laneType: resolvedTag.laneType || null,
    laneParentPoolId: resolvedTag.parentId || resolvedTag.parentPoolId || null,
    extensionLines,
  };
}

function buildSequenceFlows(nodes, descriptorsByNodeId, report) {
  const sequenceFlows = [];
  const sequenceDedup = new Set();

  nodes.forEach((node) => {
    const sourceNodeId = normalizeNodeId(node && node.id);
    if (!sourceNodeId) return;

    const sourceDescriptor = descriptorsByNodeId.get(sourceNodeId);
    if (!sourceDescriptor) return;

    const rawLinks = buildNodeLinks(node);

    rawLinks.forEach((link, index) => {
      const targetDescriptor = descriptorsByNodeId.get(link.targetId);
      if (!targetDescriptor) {
        report.warnings.push({
          code: 'bpmn_missing_target_node',
          nodeId: sourceNodeId,
          nodeType: sourceDescriptor.nodeType,
          message: 'Connection target node was not found in the exported flow and was ignored.',
          details: { targetId: link.targetId },
        });
        return;
      }

      const dedupKey = `${sourceDescriptor.elementId}|${targetDescriptor.elementId}|${link.condition || ''}`;
      if (sequenceDedup.has(dedupKey)) return;
      sequenceDedup.add(dedupKey);

      const sequenceId = `SequenceFlow_${sanitizeBpmnId(
        `${sourceDescriptor.nodeId}_${targetDescriptor.nodeId}_${index + 1}`,
        `sf_${index + 1}`
      )}`;

      sequenceFlows.push({
        id: sequenceId,
        sourceRef: sourceDescriptor.elementId,
        targetRef: targetDescriptor.elementId,
        condition: link.condition,
      });
    });
  });

  return sequenceFlows;
}

export function buildBpmnExportModel(nodes, report, exportOptions, bpmnRegistry) {
  const descriptors = [];
  const descriptorByNodeId = new Map();

  nodes.forEach((node, index) => {
    const descriptor = buildDescriptorForNode(node, index, report, exportOptions, bpmnRegistry);
    descriptors.push(descriptor);
    descriptorByNodeId.set(descriptor.nodeId, descriptor);
  });

  const sequenceFlows = buildSequenceFlows(nodes, descriptorByNodeId, report);

  report.exportedNodeCount = descriptors.length;
  report.exportedSequenceFlowCount = sequenceFlows.length;

  descriptors.forEach((descriptor) => {
    applyReferenceResolutionRule(descriptor, descriptorByNodeId, report);
  });

  descriptors.forEach((descriptor) => {
    applySpecialReferenceResolver(descriptor, descriptorByNodeId, report);
  });

  return {
    descriptors,
    sequenceFlows,
  };
}