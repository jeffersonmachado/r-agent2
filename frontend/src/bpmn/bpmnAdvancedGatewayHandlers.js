function isParallelGatewayNode(node) {
  const gatewayType = String(node?.config?.bpmnGatewayType || '').trim();
  return node?.type === 'router' && gatewayType === 'parallel';
}

export function registerAdvancedGatewayHandlers(registry) {
  if (!registry || typeof registry.register !== 'function') return registry;

  registry.register('bpmn:parallelGateway', {
    onExport: ({ node }) => {
      if (!isParallelGatewayNode(node)) return null;

      return {
        tag: 'bpmn:parallelGateway',
      };
    },

    onImport: ({ element }) => {
      if (!element || element.localName !== 'parallelGateway') return null;

      return {
        nodeType: 'router',
        configPatch: {
          bpmnGatewayType: 'parallel',
        },
      };
    },
  });

  return registry;
}
