import { reteJsonToEngineFlow } from '../engine-mapper/engineMapper';
import { engineFlowToCanonical } from './engineFlowToCanonical';

export function reteToCanonical(reteJson, meta = {}, options = {}) {
  const flowDefinition = reteJsonToEngineFlow(reteJson, meta);
  const result = engineFlowToCanonical(flowDefinition, options);

  return {
    canonicalProcessDefinition: result.canonicalProcessDefinition,
    report: {
      ...result.report,
      source: 'rete',
    },
  };
}

export default reteToCanonical;
