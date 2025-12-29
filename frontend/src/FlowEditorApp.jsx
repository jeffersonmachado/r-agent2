import React, { useCallback, useRef, useState } from 'react';
import { FlowEditor } from './FlowEditor';
import { SidebarProperties } from './SidebarProperties';
import { Toolbar } from './Toolbar';
import logger from './utils/logger';

/**
 * Componente de alto nível que integra:
 * - Editor visual (Rete.js)
 * - Painel lateral de propriedades
 * - Botões de simulação e import/export JSON
 *
 * Decisão importante:
 * - Este componente não conhece a engine de execução em si;
 *   ele apenas produz/consome JSON de fluxo. Isso mantém o
 *   frontend desacoplado da implementação do backend.
 */
export function FlowEditorApp({ onSimulateFlow }) {
  const [flowJson, setFlowJson] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const fileInputRef = useRef(null);

  const handleFlowChanged = useCallback((json) => {
    setFlowJson(json);
  }, []);

  const handleNodeSelected = useCallback((nodeData) => {
    setSelectedNode(nodeData);
  }, []);

  const handleEvent = useCallback((event) => {
    // Por enquanto apenas logamos; no futuro, pode alimentar
    // um sistema de auditoria ou de analytics.
    // Exemplo de evento: { type: 'NODE_CREATED', payload: {...}, timestamp: ... }
    // console.debug('[FlowEditorEvent]', event);
  }, []);

  const handleImportJson = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleExportJson = () => {
    if (!flowJson) return;

    const blob = new Blob([JSON.stringify(flowJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flow.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        setFlowJson(json);
      } catch (err) {
        logger.error('JSON inválido', err);
      }
    };
    reader.readAsText(file);
  };

  const handleSimulate = () => {
    if (typeof onSimulateFlow === 'function') {
      onSimulateFlow(flowJson);
    } else {
      // Fallback simples: apenas loga o JSON atual.
      logger.debug('Simulação de fluxo (JSON atual):', { flowJson });
    }
  };

  const handleChangeNodeConfig = (newConfig) => {
    // Atualiza apenas a estrutura local de "selectedNode".
    // Para refletir no gráfico, seria necessário sincronizar
    // com a instância de Rete (acesso ao editor).
    setSelectedNode((prev) => (prev ? { ...prev, config: newConfig } : prev));
  };

  return (
    <div className="flow-editor-app">
      <Toolbar onImportJson={handleImportJson} onExportJson={handleExportJson} onSimulate={handleSimulate} />

      <div className="flow-editor-app-content">
        <FlowEditor
          initialFlowJson={flowJson}
          onFlowChanged={handleFlowChanged}
          onNodeSelected={handleNodeSelected}
          onEvent={handleEvent}
        />
        <SidebarProperties selectedNode={selectedNode} onChangeConfig={handleChangeNodeConfig} />
      </div>

      <input
        type="file"
        accept="application/json"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}


