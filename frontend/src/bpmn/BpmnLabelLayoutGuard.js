function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readLabelBounds(labelElement) {
  const targetDiagramElement = labelElement?.labelTarget;
  const bounds = targetDiagramElement?.di?.label?.bounds;
  if (!bounds) return null;

  const x = toFiniteNumber(bounds.x);
  const y = toFiniteNumber(bounds.y);
  const width = toFiniteNumber(bounds.width);
  const height = toFiniteNumber(bounds.height);

  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function sameBounds(labelElement, bounds) {
  return (
    Number(labelElement?.x) === bounds.x &&
    Number(labelElement?.y) === bounds.y &&
    Number(labelElement?.width) === bounds.width &&
    Number(labelElement?.height) === bounds.height
  );
}

/**
 * Keeps external labels exactly where BPMN DI placed them.
 * This avoids subtle runtime label drifts after import.
 */
export default function BpmnLabelLayoutGuard(eventBus, elementRegistry) {
  const apply = () => {
    const elements = Array.isArray(elementRegistry?.getAll?.()) ? elementRegistry.getAll() : [];
    const changed = [];

    elements
      .filter((element) => !!element?.labelTarget)
      .forEach((labelElement) => {
        const bounds = readLabelBounds(labelElement);
        if (!bounds) return;
        if (sameBounds(labelElement, bounds)) return;

        labelElement.x = bounds.x;
        labelElement.y = bounds.y;
        labelElement.width = bounds.width;
        labelElement.height = bounds.height;
        changed.push(labelElement);
      });

    if (changed.length > 0) {
      eventBus.fire('elements.changed', { elements: changed });
    }
  };

  this.apply = apply;
  eventBus.on('import.render.complete', apply);
}

BpmnLabelLayoutGuard.$inject = ['eventBus', 'elementRegistry'];
