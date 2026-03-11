import { isBpmnFeatureEnabled } from './bpmnFeatureFlags';

function asTrimmedString(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

export function registerMessageFlowHandlers(registry) {
  if (!registry || typeof registry.register !== 'function') return registry;

  registry.register('bpmn:messageFlow', {
    onExport: ({ node, flags }) => {
      if (!isBpmnFeatureEnabled('MESSAGE_FLOW', flags)) return null;

      const messageFlowType = asTrimmedString(node?.config?.bpmnMessageFlowType);
      if (messageFlowType !== 'messageFlow') return null;

      const messageFlowSource = asTrimmedString(node?.config?.bpmnMessageFlowSource);
      const messageFlowTarget = asTrimmedString(node?.config?.bpmnMessageFlowTarget);

      if (!messageFlowSource || !messageFlowTarget) return null;

      return {
        tag: 'bpmn:messageFlow',
        messageFlowType: 'messageFlow',
        sourceRef: messageFlowSource,
        targetRef: messageFlowTarget,
      };
    },

    onImport: ({ element, flags, report, elementId }) => {
      if (!isBpmnFeatureEnabled('MESSAGE_FLOW', flags)) return null;
      if (!element || element.localName !== 'messageFlow') return null;

      const sourceRef = asTrimmedString(element.getAttribute('sourceRef'));
      const targetRef = asTrimmedString(element.getAttribute('targetRef'));

      if (!sourceRef || !targetRef) {
        report?.warnings?.push({
          code: 'bpmn_message_flow_incomplete',
          elementId,
          message: 'Message flow without sourceRef/targetRef was ignored.',
        });
        return null;
      }

      report?.warnings?.push({
        code: 'bpmn_message_flow_degraded',
        elementId,
        message: 'Message flows modeled as degraded nodes - execution semantics not supported',
      });

      return {
        nodeType: 'degradedMessageFlow',
        degraded: true,
        configPatch: {
          bpmnMessageFlowType: 'messageFlow',
          bpmnMessageFlowSource: sourceRef,
          bpmnMessageFlowTarget: targetRef,
        },
      };
    },
  });

  return registry;
}
