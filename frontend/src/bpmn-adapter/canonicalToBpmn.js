import { canonicalToEngineFlow } from '../process-adapters/canonicalToEngineFlow';
import { engineFlowToBpmnXml } from '../bpmn/engineFlowToBpmnXml';

export function canonicalToBpmn(definition, options = {}) {
  const engineFlow = canonicalToEngineFlow(definition, options.meta || {});
  const exported = engineFlowToBpmnXml(engineFlow, options);
  return {
    ...exported,
    engineFlow,
  };
}

export default canonicalToBpmn;
