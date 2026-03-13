import { BpmnModdle } from 'bpmn-moddle';
import { engineFlowToBpmnXml } from './engineFlowToBpmnXml';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export async function internalFlowToBpmn(internalFlow, options = {}) {
  const flow = asObject(internalFlow);
  if (!flow) {
    throw new Error('Internal flow must be an object.');
  }

  const metadata = asObject(flow.metadata);
  const bpmnMetadata = asObject(metadata?.bpmn);
  const preferOriginal = options.preferOriginal !== false;

  if (preferOriginal && typeof bpmnMetadata?.sourceXml === 'string' && bpmnMetadata.sourceXml.trim()) {
    return {
      xml: bpmnMetadata.sourceXml,
      source: 'metadata.sourceXml',
      warnings: [],
    };
  }

  const exported = engineFlowToBpmnXml(flow, {
    mode: 'extensions',
    ...options,
  });

  const rawXml = String(exported?.xml || '');
  const moddle = options.moddle || new BpmnModdle();

  try {
    const parsed = await moddle.fromXML(rawXml);
    const serialized = await moddle.toXML(parsed.rootElement, { format: true });

    return {
      xml: String(serialized?.xml || rawXml),
      source: 'engineFlowToBpmnXml',
      warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
      report: exported?.report || null,
    };
  } catch (error) {
    return {
      xml: rawXml,
      source: 'engineFlowToBpmnXml',
      warnings: [
        {
          message: `BPMN moddle validation failed: ${error?.message || 'unknown error'}`,
        },
      ],
      report: exported?.report || null,
    };
  }
}

export async function importInternalFlowIntoModeler(modeler, internalFlow, options = {}) {
  if (!modeler || typeof modeler.importXML !== 'function') {
    throw new Error('BPMN modeler instance is required.');
  }

  const converted = await internalFlowToBpmn(internalFlow, options);
  const imported = await modeler.importXML(converted.xml);

  return {
    ...converted,
    importWarnings: Array.isArray(imported?.warnings) ? imported.warnings : [],
  };
}

export default internalFlowToBpmn;
