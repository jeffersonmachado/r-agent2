import React, { useCallback, useRef, useState } from 'react';

import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import { BpmnEditor } from '../bpmn/BpmnEditor';
import { downloadTextFile } from '../bpmn/bpmnExporter';
import { importBpmnFile, readTextFile } from '../bpmn/bpmnImporter';
import pizzaStoreBpmnXml from '../bpmn/__fixtures__/Pizza-Store.bpmn?raw';

export function BpmnEditorPage() {
  const editorRef = useRef(null);
  const bpmnInputRef = useRef(null);
  const internalInputRef = useRef(null);

  const [status, setStatus] = useState('Ready');
  const [lastInternalFlow, setLastInternalFlow] = useState(null);

  const handleImportResult = useCallback((result) => {
    const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
    setStatus(`Imported BPMN (${warningCount} warnings)`);
  }, []);

  const handleError = useCallback((error) => {
    setStatus(`Error: ${error?.message || String(error)}`);
  }, []);

  const handleImportBpmnClick = useCallback(() => {
    bpmnInputRef.current?.click();
  }, []);

  const handleImportBpmnFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file || !editorRef.current) return;

    try {
      const modeler = editorRef.current.getModeler();
      const imported = await importBpmnFile(modeler, file);
      editorRef.current.fitViewport();
      const warningCount = Array.isArray(imported.warnings) ? imported.warnings.length : 0;
      setStatus(`Imported ${file.name} (${warningCount} warnings)`);
    } catch (error) {
      setStatus(`Import failed: ${error?.message || String(error)}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  const handleImportPizzaStore = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      await editorRef.current.importXml(pizzaStoreBpmnXml);
      setStatus('Pizza-Store.bpmn imported with BPMN DI preserved');
    } catch (error) {
      setStatus(`Import failed: ${error?.message || String(error)}`);
    }
  }, []);

  const handleExportXml = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      const xml = await editorRef.current.exportXml({ format: true, preamble: true });
      downloadTextFile(xml, 'diagram.bpmn', 'application/xml;charset=utf-8');
      setStatus('BPMN XML exported');
    } catch (error) {
      setStatus(`Export XML failed: ${error?.message || String(error)}`);
    }
  }, []);

  const handleExportSvg = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      const svg = await editorRef.current.exportSvg();
      downloadTextFile(svg, 'diagram.svg', 'image/svg+xml;charset=utf-8');
      setStatus('BPMN SVG exported');
    } catch (error) {
      setStatus(`Export SVG failed: ${error?.message || String(error)}`);
    }
  }, []);

  const handleConvertToInternalFlow = useCallback(async () => {
    if (!editorRef.current) return;

    try {
      const result = await editorRef.current.convertToInternalFlow({ includeSourceXml: true });
      setLastInternalFlow(result.internalFlow);
      downloadTextFile(
        JSON.stringify(result.internalFlow, null, 2),
        'internal-flow.json',
        'application/json;charset=utf-8',
      );
      setStatus(`Converted BPMN -> internal flow (${result.internalFlow.nodes.length} nodes)`);
    } catch (error) {
      setStatus(`Conversion failed: ${error?.message || String(error)}`);
    }
  }, []);

  const handleImportInternalClick = useCallback(() => {
    internalInputRef.current?.click();
  }, []);

  const handleImportInternalFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file || !editorRef.current) return;

    try {
      const text = await readTextFile(file);
      const parsed = JSON.parse(text);
      await editorRef.current.loadInternalFlow(parsed, { preferOriginal: true });
      setStatus(`Imported internal flow ${file.name} -> BPMN`);
    } catch (error) {
      setStatus(`Internal flow import failed: ${error?.message || String(error)}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  return (
    <div className="bpmn-editor-page">
      <div className="bpmn-editor-page__topbar">
        <NavigationLink to="/editor">Back to current flow editor</NavigationLink>

        <Button variant="default" onClick={handleImportBpmnClick}>Import BPMN</Button>
        <Button variant="default" onClick={handleImportPizzaStore}>Load Pizza-Store.bpmn</Button>
        <Button variant="default" onClick={handleExportXml}>Export BPMN (XML)</Button>
        <Button variant="default" onClick={handleExportSvg}>Export BPMN (SVG)</Button>
        <Button variant="primary" onClick={handleConvertToInternalFlow}>Convert to internal flow</Button>
        <Button variant="default" onClick={handleImportInternalClick}>Import internal flow</Button>

        <span className="bpmn-editor-page__status">{status}</span>
      </div>

      <div className="bpmn-editor-page__main">
        <BpmnEditor
          ref={editorRef}
          initialXml={pizzaStoreBpmnXml}
          onImport={handleImportResult}
          onError={handleError}
        />

        <aside className="bpmn-editor-page__panel">
          <strong>Conversion preview</strong>
          <pre>
            {lastInternalFlow
              ? JSON.stringify(lastInternalFlow, null, 2)
              : 'Use "Convert to internal flow" to generate the r-agent2 flow payload.'}
          </pre>
        </aside>
      </div>

      <input
        ref={bpmnInputRef}
        type="file"
        accept=".bpmn,.xml,application/xml,text/xml"
        className="hidden"
        onChange={handleImportBpmnFile}
      />

      <input
        ref={internalInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportInternalFile}
      />
    </div>
  );
}

export default BpmnEditorPage;
