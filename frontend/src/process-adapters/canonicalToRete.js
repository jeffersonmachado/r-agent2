import { engineFlowToReteJson } from '../engine-mapper/engineMapper';
import { canonicalToEngineFlow } from './canonicalToEngineFlow';

export function canonicalToRete(canonicalProcessDefinition, options = {}) {
  const converted = canonicalToEngineFlow(canonicalProcessDefinition, options);
  const reteJson = engineFlowToReteJson(converted.flowDefinition);

  return {
    reteJson,
    report: {
      ...converted.report,
      source: 'canonical',
    },
  };
}

export default canonicalToRete;
