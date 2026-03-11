import {
  RAGENT2_BPMN_EXTENSION_NAMESPACE,
  RAGENT2_BPMN_EXTENSION_PREFIX,
} from './bpmnExtensions';
import {
  sanitizeBpmnId,
  openTag,
  closeTag,
  selfClosingTag,
  indentLines,
} from './bpmnXmlBuilder';
import {
  buildNodeElementLines,
  buildSequenceFlowLines,
} from './bpmnExportHelpers';
import { buildBpmnExportModel } from './bpmnExportModelBuilder';
import { buildDiagramInterchangeLines } from './bpmnExportDiagramBuilder';
import { createBpmnHandlerRegistry } from './bpmnHandlerRegistryFactory';

const BPMN_MODEL_NAMESPACE = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';
const DI_NAMESPACE = 'http://www.omg.org/spec/DD/20100524/DI';
const DC_NAMESPACE = 'http://www.omg.org/spec/DD/20100524/DC';
const DEFAULT_TARGET_NAMESPACE = 'http://r-agent2.io/bpmn/definitions';

export const BPMN_EXPORT_MODE = Object.freeze({
  SIMPLE: 'simple',
  EXTENSIONS: 'extensions',
});

function normalizeExportOptions(options = {}) {
  const rawMode = String(options.mode || '').trim().toLowerCase();
  const includeExtensions = rawMode === BPMN_EXPORT_MODE.EXTENSIONS || options.includeExtensions === true;

  return {
    mode: includeExtensions ? BPMN_EXPORT_MODE.EXTENSIONS : BPMN_EXPORT_MODE.SIMPLE,
    includeExtensions,
    targetNamespace: String(options.targetNamespace || DEFAULT_TARGET_NAMESPACE).trim() || DEFAULT_TARGET_NAMESPACE,
  };
}

export function engineFlowToBpmnXml(flowDefinition, options = {}) {
  const exportOptions = normalizeExportOptions(options);
  const nodes = Array.isArray(flowDefinition?.nodes) ? flowDefinition.nodes : [];
  const bpmnRegistry = createBpmnHandlerRegistry({ flags: options.flags });

  const report = {
    mode: exportOptions.mode,
    warnings: [],
    degradedNodes: [],
    exportedNodeCount: 0,
    exportedSequenceFlowCount: 0,
    extensionNodeCount: 0,
  };

  const processId = `Process_${sanitizeBpmnId(flowDefinition?.id || 'flow')}`;
  const definitionsId = `Definitions_${sanitizeBpmnId(flowDefinition?.id || 'flow')}`;
  const { descriptors, sequenceFlows } = buildBpmnExportModel(
    nodes,
    report,
    exportOptions,
    bpmnRegistry
  );

  const processLines = [openTag('bpmn:process', { id: processId, isExecutable: 'true' })];

  descriptors.forEach((descriptor) => {
    processLines.push(...indentLines(buildNodeElementLines(descriptor), 1));
  });

  sequenceFlows.forEach((sequenceFlow) => {
    processLines.push(...indentLines(buildSequenceFlowLines(sequenceFlow), 1));
  });

  processLines.push(closeTag('bpmn:process'));

  const diagramLines = buildDiagramInterchangeLines({
    descriptors,
    nodes,
    sequenceFlows,
    bpmnRegistry,
    processId,
  });

  const definitionsAttributes = {
    id: definitionsId,
    'xmlns:bpmn': BPMN_MODEL_NAMESPACE,
    'xmlns:xsi': XSI_NAMESPACE,
    targetNamespace: exportOptions.targetNamespace,
  };

  if (exportOptions.includeExtensions || report.extensionNodeCount > 0) {
    definitionsAttributes[`xmlns:${RAGENT2_BPMN_EXTENSION_PREFIX}`] = RAGENT2_BPMN_EXTENSION_NAMESPACE;
  }

  if (diagramLines.length > 0) {
    definitionsAttributes['xmlns:di'] = DI_NAMESPACE;
    definitionsAttributes['xmlns:dc'] = DC_NAMESPACE;
  }

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    openTag('bpmn:definitions', definitionsAttributes),
    ...indentLines(processLines, 1),
    ...indentLines(diagramLines, 1),
    closeTag('bpmn:definitions'),
  ];

  return {
    xml: `${xmlLines.join('\n')}\n`,
    report,
  };
}

export default engineFlowToBpmnXml;
