function assertModeler(modeler) {
  if (!modeler || typeof modeler.importXML !== 'function') {
    throw new Error('BPMN modeler instance is required.');
  }
}

export async function importBpmnXml(modeler, xml) {
  assertModeler(modeler);

  if (!xml || typeof xml !== 'string') {
    throw new Error('BPMN XML must be a non-empty string.');
  }

  // Keep BPMN DI as-is: we only import the XML, never auto-layout.
  const result = await modeler.importXML(xml);
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  return {
    warnings,
    hasDiagramInterchange: /bpmndi:BPMNShape|bpmndi:BPMNEdge|dc:Bounds|di:waypoint/.test(xml),
  };
}

export function readTextFile(file) {
  if (!file) {
    return Promise.reject(new Error('No file provided.'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

export async function importBpmnFile(modeler, file) {
  const xml = await readTextFile(file);
  const imported = await importBpmnXml(modeler, xml);
  return {
    ...imported,
    xml,
    fileName: file?.name || 'diagram.bpmn',
  };
}

export default importBpmnXml;
