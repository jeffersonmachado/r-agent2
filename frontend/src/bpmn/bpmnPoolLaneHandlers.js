import { isBpmnFeatureEnabled } from './bpmnFeatureFlags';

function asTrimmedString(value) {
  const out = String(value ?? '').trim();
  return out || null;
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

export function registerPoolLaneHandlers(registry) {
  if (!registry || typeof registry.register !== 'function') return registry;

  registry.register('bpmn:participant', {
    onExport: ({ node, flags }) => {
      if (!isBpmnFeatureEnabled('MESSAGE_FLOW', flags)) return null;

      const poolType = node?.config?.bpmnPoolType;
      if (poolType !== true) return null;

      return {
        tag: 'bpmn:participant',
        poolType: 'pool',
        processRef: asTrimmedString(node?.config?.bpmnProcessRef) || null,
      };
    },

    onImport: ({ element, flags, report, elementId }) => {
      if (!isBpmnFeatureEnabled('MESSAGE_FLOW', flags)) return null;
      if (!element || element.localName !== 'participant') return null;

      const processRef = asTrimmedString(element.getAttribute('processRef'));

      report?.warnings?.push({
        code: 'bpmn_participant_pool_degraded',
        elementId,
        message: 'Participant pool imported with degraded semantics - lane execution not supported',
      });

      return {
        nodeType: 'degradedPool',
        degraded: true,
        configPatch: {
          bpmnPoolType: true,
          bpmnProcessRef: processRef,
        },
      };
    },
  });

  registry.register('bpmn:lane', {
    onExport: ({ node, flags }) => {
      if (!isBpmnFeatureEnabled('MESSAGE_FLOW', flags)) return null;

      const laneType = node?.config?.bpmnLaneType;
      if (laneType !== 'lane') return null;

      return {
        tag: 'bpmn:lane',
        laneType: 'lane',
        parentPoolId: asTrimmedString(node?.config?.bpmnParentPoolId) || null,
      };
    },

    onImport: ({ element, flags, report, elementId, parentPoolId }) => {
      if (!isBpmnFeatureEnabled('MESSAGE_FLOW', flags)) return null;
      if (!element || element.localName !== 'lane') return null;

      report?.warnings?.push({
        code: 'bpmn_lane_degraded',
        elementId,
        message: 'Lane imported with degraded semantics as child node - execution not supported',
      });

      return {
        nodeType: 'degradedLane',
        degraded: true,
        configPatch: {
          bpmnLaneType: 'lane',
          bpmnParentPoolId: parentPoolId,
        },
      };
    },
  });

  return registry;
}
