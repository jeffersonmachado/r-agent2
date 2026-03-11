function normalizeRef(value) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

export function resolveElementRef(rawRef, descriptorByNodeId) {
  const normalizedRef = normalizeRef(rawRef);
  if (!normalizedRef) return null;

  const descriptor = descriptorByNodeId.get(normalizedRef);
  return descriptor?.elementId || normalizedRef;
}

export const BPMN_REFERENCE_RESOLUTION_RULES = Object.freeze([
  Object.freeze({
    tag: 'bpmn:participant',
    fields: Object.freeze([
      Object.freeze({ sourceKey: 'participantProcessRef', attrKey: 'processRef', required: false }),
    ]),
  }),
  Object.freeze({
    tag: 'bpmn:lane',
    fields: Object.freeze([
      Object.freeze({
        sourceKey: 'laneParentPoolId',
        attrKey: 'parentPoolRef',
        required: true,
        warningCode: 'bpmn_lane_missing_parent_pool',
        warningMessage: 'Lane exported without parentPoolRef due to missing pool reference.',
      }),
    ]),
  }),
  Object.freeze({
    tag: 'bpmn:messageFlow',
    fields: Object.freeze([
      Object.freeze({ sourceKey: 'messageFlowSourceRef', attrKey: 'sourceRef', required: true }),
      Object.freeze({ sourceKey: 'messageFlowTargetRef', attrKey: 'targetRef', required: true }),
    ]),
    aggregateWarningCode: 'bpmn_message_flow_incomplete_ref',
    aggregateWarningMessage: 'Message flow missing source or target reference.',
  }),
]);

export function applyReferenceResolutionRule(descriptor, descriptorByNodeId, report) {
  const rule = BPMN_REFERENCE_RESOLUTION_RULES.find((entry) => entry.tag === descriptor.tag);
  if (!rule) return;

  const resolvedByAttr = {};
  const missingRequiredFields = [];

  rule.fields.forEach((field) => {
    const resolvedValue = resolveElementRef(descriptor[field.sourceKey], descriptorByNodeId);
    resolvedByAttr[field.attrKey] = resolvedValue;

    if (resolvedValue) {
      descriptor.attrs[field.attrKey] = resolvedValue;
      return;
    }

    if (field.required) {
      missingRequiredFields.push(field);
    }
  });

  if (missingRequiredFields.length === 0) return;

  if (rule.aggregateWarningCode && rule.aggregateWarningMessage) {
    rule.fields.forEach((field) => {
      delete descriptor.attrs[field.attrKey];
    });

    report.warnings.push({
      code: rule.aggregateWarningCode,
      nodeId: descriptor.nodeId,
      message: rule.aggregateWarningMessage,
      details: resolvedByAttr,
    });
    return;
  }

  missingRequiredFields.forEach((field) => {
    report.warnings.push({
      code: field.warningCode || 'bpmn_reference_missing',
      nodeId: descriptor.nodeId,
      nodeType: descriptor.nodeType,
      message: field.warningMessage || 'Reference field could not be resolved during export.',
      details: {
        sourceKey: field.sourceKey,
        attrKey: field.attrKey,
      },
    });
  });
}

export function resolveBoundaryEventAttachment(descriptor, descriptorByNodeId, report) {
  const attachedDescriptor = descriptor.boundaryAttachedToNodeId
    ? descriptorByNodeId.get(String(descriptor.boundaryAttachedToNodeId))
    : null;

  if (attachedDescriptor) {
    descriptor.attrs.attachedToRef = attachedDescriptor.elementId;
    return;
  }

  if (descriptor.boundaryAttachedToRef) {
    descriptor.attrs.attachedToRef = resolveElementRef(
      descriptor.boundaryAttachedToRef,
      descriptorByNodeId
    );
    return;
  }

  report.warnings.push({
    code: 'bpmn_boundary_event_missing_attached',
    nodeId: descriptor.nodeId,
    nodeType: descriptor.nodeType,
    message: 'Boundary event exported without attachedToRef due to missing attachment target.',
  });
}

export const BPMN_SPECIAL_REFERENCE_RESOLVERS = Object.freeze({
  'bpmn:boundaryEvent': resolveBoundaryEventAttachment,
});

export function applySpecialReferenceResolver(descriptor, descriptorByNodeId, report) {
  const resolver = BPMN_SPECIAL_REFERENCE_RESOLVERS[descriptor.tag];
  if (typeof resolver !== 'function') return;
  resolver(descriptor, descriptorByNodeId, report);
}