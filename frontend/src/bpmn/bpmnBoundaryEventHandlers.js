import { isBpmnFeatureEnabled } from './bpmnFeatureFlags';

function asTrimmedString(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function directChildElements(element) {
  if (!element || !element.children) return [];
  return Array.from(element.children);
}

function hasLocalChild(element, localName) {
  return directChildElements(element).some((child) => child.localName === localName);
}

export function registerBoundaryEventHandlers(registry) {
  if (!registry || typeof registry.register !== 'function') return registry;

  registry.register('bpmn:boundaryEvent', {
    onExport: ({ node, flags }) => {
      if (!isBpmnFeatureEnabled('BOUNDARY_EVENTS', flags)) return null;

      const boundaryType = asTrimmedString(node?.config?.bpmnBoundaryEventType);
      if (!boundaryType) return null;

      const attachedToNodeId = asTrimmedString(node?.config?.bpmnAttachedToNodeId);
      const attachedToRef = asTrimmedString(node?.config?.bpmnAttachedToRef);

      if (boundaryType === 'timer') {
        return {
          tag: 'bpmn:boundaryEvent',
          isTimerCatch: false,
          boundaryEventType: 'timer',
          boundaryAttachedToNodeId: attachedToNodeId,
          boundaryAttachedToRef: attachedToRef,
        };
      }

      if (boundaryType === 'error') {
        return {
          tag: 'bpmn:boundaryEvent',
          isTimerCatch: false,
          boundaryEventType: 'error',
          boundaryAttachedToNodeId: attachedToNodeId,
          boundaryAttachedToRef: attachedToRef,
        };
      }

      return null;
    },

    onImport: ({ element, flags, report, elementId }) => {
      if (!isBpmnFeatureEnabled('BOUNDARY_EVENTS', flags)) return null;
      if (!element || element.localName !== 'boundaryEvent') return null;

      const attachedToRef = asTrimmedString(element.getAttribute('attachedToRef'));

      if (hasLocalChild(element, 'timerEventDefinition')) {
        report?.warnings?.push({
          code: 'bpmn_boundary_event_degraded',
          elementId,
          message: 'Timer boundaryEvent imported with degraded semantics as delay node.',
        });

        return {
          nodeType: 'delay',
          degraded: true,
          configPatch: {
            bpmnBoundaryEventType: 'timer',
            ...(attachedToRef ? { bpmnAttachedToRef: attachedToRef } : {}),
          },
        };
      }

      if (hasLocalChild(element, 'errorEventDefinition')) {
        report?.warnings?.push({
          code: 'bpmn_boundary_event_degraded',
          elementId,
          message: 'Error boundaryEvent imported with degraded semantics as fallback node.',
        });

        return {
          nodeType: 'fallback',
          degraded: true,
          configPatch: {
            bpmnBoundaryEventType: 'error',
            ...(attachedToRef ? { bpmnAttachedToRef: attachedToRef } : {}),
          },
        };
      }

      return null;
    },
  });

  return registry;
}
