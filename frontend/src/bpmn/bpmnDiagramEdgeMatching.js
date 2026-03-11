function normalizeRef(value) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

export function resolveDiagramStoredElementRef(rawRef, originalElementIdToExportedElementId) {
  const normalizedRef = normalizeRef(rawRef);
  if (!normalizedRef) return null;
  return originalElementIdToExportedElementId.get(normalizedRef) || normalizedRef;
}

export function resolveDiagramEdgeForSequenceFlow(
  sequenceFlow,
  edgeById,
  edgeFallback,
  fallbackIndex,
  originalElementIdToExportedElementId
) {
  const directMatch = edgeById.get(sequenceFlow.id);
  if (directMatch) return directMatch;

  const refMatch = Array.from(edgeById.values()).find((edge) => {
    if (!edge) return false;

    const resolvedSourceRef = resolveDiagramStoredElementRef(
      edge.sourceRef,
      originalElementIdToExportedElementId
    );
    const resolvedTargetRef = resolveDiagramStoredElementRef(
      edge.targetRef,
      originalElementIdToExportedElementId
    );

    return (
      resolvedSourceRef === sequenceFlow.sourceRef &&
      resolvedTargetRef === sequenceFlow.targetRef
    );
  });
  if (refMatch) return refMatch;

  return edgeFallback[fallbackIndex] || null;
}

export function buildOriginalElementIdToExportedElementIdMap(descriptors) {
  const originalElementIdToExportedElementId = new Map();

  descriptors.forEach((descriptor) => {
    const originalBpmnElementId = normalizeRef(descriptor.originalBpmnElementId);
    if (!originalBpmnElementId) return;
    originalElementIdToExportedElementId.set(originalBpmnElementId, descriptor.elementId);
  });

  return originalElementIdToExportedElementId;
}