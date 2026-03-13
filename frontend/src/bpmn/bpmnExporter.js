function assertModeler(modeler) {
  if (!modeler || typeof modeler.saveXML !== 'function' || typeof modeler.saveSVG !== 'function') {
    throw new Error('BPMN modeler instance is required.');
  }
}

export async function saveBpmnXml(modeler, options = {}) {
  assertModeler(modeler);
  const { format = true, preamble = true } = options;
  const result = await modeler.saveXML({ format, preamble });
  return String(result?.xml || '');
}

export async function saveBpmnSvg(modeler) {
  assertModeler(modeler);
  const result = await modeler.saveSVG();
  return String(result?.svg || '');
}

export function downloadTextFile(content, fileName, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([String(content || '')], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
}

export async function exportBpmnXmlFile(modeler, fileName = 'diagram.bpmn') {
  const xml = await saveBpmnXml(modeler, { format: true, preamble: true });
  downloadTextFile(xml, fileName, 'application/xml;charset=utf-8');
  return xml;
}

export async function exportBpmnSvgFile(modeler, fileName = 'diagram.svg') {
  const svg = await saveBpmnSvg(modeler);
  downloadTextFile(svg, fileName, 'image/svg+xml;charset=utf-8');
  return svg;
}

export default {
  saveBpmnXml,
  saveBpmnSvg,
  exportBpmnXmlFile,
  exportBpmnSvgFile,
  downloadTextFile,
};
