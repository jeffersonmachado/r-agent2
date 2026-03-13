import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';

import { importBpmnXml } from './bpmnImporter';
import { saveBpmnSvg, saveBpmnXml } from './bpmnExporter';
import { bpmnToInternalFlow } from './bpmnToInternalFlow';
import { importInternalFlowIntoModeler } from './internalFlowToBpmn';
import bpmnVisualModule from './bpmnVisualModule';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import './bpmn.css';

const DEFAULT_EMPTY_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_1"
  targetNamespace="http://r-agent2.io/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="160" y="120" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

export const BpmnEditor = forwardRef(function BpmnEditor(
  {
    initialXml = DEFAULT_EMPTY_BPMN_XML,
    onImport,
    onError,
    onDiagramChanged,
  },
  ref,
) {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const [ready, setReady] = useState(false);

  const notifyError = useCallback((error) => {
    if (typeof onError === 'function') onError(error);
  }, [onError]);

  const fitViewport = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;

    try {
      const canvas = modeler.get('canvas');
      canvas.zoom('fit-viewport');
    } catch {
      // no-op
    }
  }, []);

  const importXml = useCallback(async (xml) => {
    const modeler = modelerRef.current;
    if (!modeler) {
      throw new Error('BPMN modeler is not ready yet.');
    }

    const imported = await importBpmnXml(modeler, xml);

    // Enforce BPMNLabel DI bounds exactly when provided by input XML.
    try {
      const labelGuard = modeler.get('bpmnLabelLayoutGuard');
      if (labelGuard && typeof labelGuard.apply === 'function') {
        labelGuard.apply();
      }
    } catch {
      // best-effort
    }

    fitViewport();

    if (typeof onImport === 'function') {
      onImport({
        xml,
        warnings: imported.warnings,
        hasDiagramInterchange: imported.hasDiagramInterchange,
      });
    }

    return imported;
  }, [fitViewport, onImport]);

  const exportXml = useCallback(async (options = {}) => {
    const modeler = modelerRef.current;
    if (!modeler) throw new Error('BPMN modeler is not ready yet.');
    return saveBpmnXml(modeler, options);
  }, []);

  const exportSvg = useCallback(async () => {
    const modeler = modelerRef.current;
    if (!modeler) throw new Error('BPMN modeler is not ready yet.');
    return saveBpmnSvg(modeler);
  }, []);

  const convertToInternalFlow = useCallback(async (options = {}) => {
    const modeler = modelerRef.current;
    if (!modeler) throw new Error('BPMN modeler is not ready yet.');
    return bpmnToInternalFlow(modeler, options);
  }, []);

  const loadInternalFlow = useCallback(async (flow, options = {}) => {
    const modeler = modelerRef.current;
    if (!modeler) throw new Error('BPMN modeler is not ready yet.');

    const converted = await importInternalFlowIntoModeler(modeler, flow, options);
    fitViewport();
    return converted;
  }, [fitViewport]);

  useImperativeHandle(ref, () => ({
    importXml,
    exportXml,
    exportSvg,
    convertToInternalFlow,
    loadInternalFlow,
    fitViewport,
    getModeler: () => modelerRef.current,
  }), [convertToInternalFlow, exportSvg, exportXml, fitViewport, importXml, loadInternalFlow]);

  useEffect(() => {
    if (!containerRef.current || modelerRef.current) return;

    const modeler = new BpmnModeler({
      container: containerRef.current,
      keyboard: {
        bindTo: window,
      },
      additionalModules: [bpmnVisualModule],
      bpmnRenderer: {
        defaultFillColor: '#131b27',
        defaultStrokeColor: '#8ea2bd',
        defaultLabelColor: '#d9e2ef',
      },
      textRenderer: {
        defaultStyle: {
          fontFamily: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
          fontSize: '13px',
          fontWeight: '500',
          lineHeight: 1.35,
        },
        externalStyle: {
          fontFamily: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
          fontSize: '12px',
          fontWeight: '500',
          lineHeight: 1.35,
        },
      },
    });

    modelerRef.current = modeler;

    const handleChanged = () => {
      if (typeof onDiagramChanged !== 'function') return;

      try {
        const elementRegistry = modeler.get('elementRegistry');
        const count = Array.isArray(elementRegistry?.getAll?.()) ? elementRegistry.getAll().length : 0;
        onDiagramChanged({ elementCount: count });
      } catch {
        onDiagramChanged({ elementCount: 0 });
      }
    };

    modeler.on('commandStack.changed', handleChanged);

    importXml(initialXml)
      .then(() => setReady(true))
      .catch((error) => {
        notifyError(error);
        importXml(DEFAULT_EMPTY_BPMN_XML)
          .then(() => setReady(true))
          .catch((fallbackError) => {
            notifyError(fallbackError);
          });
      });

    return () => {
      modeler.off('commandStack.changed', handleChanged);
      modeler.destroy();
      modelerRef.current = null;
      setReady(false);
    };
  // Intentionally initialize once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bpmn-editor">
      <div className="bpmn-editor__canvas" ref={containerRef} />
      {!ready ? <div className="bpmn-editor__loading">Loading BPMN editor...</div> : null}
    </div>
  );
});

export default BpmnEditor;
