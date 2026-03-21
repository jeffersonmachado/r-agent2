import { useCallback } from 'react';
import { reteJsonToEngineFlow, engineFlowToReteJson } from '../../engine-mapper/engineMapper';
import { bpmnXmlToEngineFlow } from '../../bpmn/bpmnXmlToEngineFlow';
import { bpmnXmlToViewModel } from '../../bpmn/bpmnXmlToViewModel';
import { engineFlowToBpmnXml } from '../../bpmn/engineFlowToBpmnXml';
import { applyBackendValidationErrors } from '../../editor/validation/runFlowValidation';
import logger from '../../utils/logger';

export function useFlowEditorFileIO({
  fileInputRef,
  editorRef,
  showToast,
  activeFlow,
  currentFlow,
  isBpmnDiagram,
  bpmnSourceDirty,
  activeFlowMetadata,
  draftMeta,
  agent,
  draftFlow,
  editorMode,
  setDraftFlow,
  setDraftMeta,
  setBpmnViewModel,
  setBpmnSelection,
  setBpmnSourceDirty,
  setEditorMode,
  setCanvasLocked,
  setCanvasLockReason,
  clearCurrentFlow,
  setSelectedNode,
  bpmnImportSessionRef,
  validateCurrentFlow,
  setValidationCollapsed,
}) {
  const handleImportJson = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, [fileInputRef]);

  const handleExportJson = useCallback(async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const downloadText = (content, fileName, mimeType) => {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      };

      const baseName = (activeFlow?.name || currentFlow?.name || 'flow').replace(/[^a-z0-9]/gi, '_');

      if (isBpmnDiagram) {
        const preservedSourceXml = !bpmnSourceDirty
          ? (typeof activeFlowMetadata?.sourceXml === 'string' ? activeFlowMetadata.sourceXml : null)
          : null;

        if (preservedSourceXml) {
          downloadText(preservedSourceXml, `${baseName || 'flow'}.bpmn`, 'application/xml');
          showToast('BPMN exportado preservando o XML original', 'success', 2500);
          return;
        }

        const reteJson = await editor.toJSON();
        const flowDefinition = reteJsonToEngineFlow(reteJson, {
          tenantId: draftMeta?.tenantId || currentFlow?.tenantId || activeFlow?.tenantId || agent?.tenantId || 'demo-tenant',
          id: draftMeta?.id || currentFlow?.id || activeFlow?.id,
          name: draftMeta?.name || currentFlow?.name || activeFlow?.name || 'Fluxo sem nome',
          kind: currentFlow?.kind || draftFlow?.kind || activeFlow?.kind || draftMeta?.kind || 'chat',
          metadata: {
            ...(activeFlowMetadata && typeof activeFlowMetadata === 'object' ? activeFlowMetadata : {}),
            diagramType: 'bpmn',
            editorMode,
          },
        });
        const exported = engineFlowToBpmnXml(flowDefinition);
        downloadText(exported.xml, `${baseName || 'flow'}.bpmn`, 'application/xml');
        showToast('BPMN exportado a partir do fluxo engine', bpmnSourceDirty ? 'warning' : 'success', bpmnSourceDirty ? 4500 : 2500);
        return;
      }

      const reteJson = await editor.toJSON();
      const blob = new Blob([JSON.stringify(reteJson, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFlow?.name ? `${currentFlow.name.replace(/[^a-z0-9]/gi, '_')}.json` : 'flow.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Fluxo exportado com sucesso', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao exportar JSON', err);
      showToast('Erro ao exportar fluxo', 'error', 3000);
    }
  }, [
    activeFlow?.id,
    activeFlow?.name,
    activeFlow?.tenantId,
    activeFlowMetadata,
    agent?.tenantId,
    bpmnSourceDirty,
    currentFlow?.id,
    currentFlow?.kind,
    currentFlow?.name,
    currentFlow?.tenantId,
    draftFlow?.kind,
    draftMeta,
    editorMode,
    editorRef,
    isBpmnDiagram,
    showToast,
  ]);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const buildBpmnWarningToastMessage = (warnings) => {
      const normalizedWarnings = Array.isArray(warnings) ? warnings : [];
      if (normalizedWarnings.length === 0) return null;

      const uniqueMessages = Array.from(new Set(
        normalizedWarnings
          .map((warning) => String(warning?.message || '').trim())
          .filter(Boolean)
      ));

      const visibleMessages = uniqueMessages.slice(0, 2);
      const remainingCount = uniqueMessages.length - visibleMessages.length;
      const header = uniqueMessages.length === 1
        ? 'BPMN importado com 1 aviso:'
        : `BPMN importado com ${uniqueMessages.length} avisos:`;

      return [
        header,
        ...visibleMessages.map((message) => `- ${message}`),
        ...(remainingCount > 0 ? [`- mais ${remainingCount} aviso(s)`] : []),
      ].join('\n');
    };

    const importJsonFile = (rawText) => {
      const json = JSON.parse(rawText);

      if (!json || typeof json !== 'object') {
        throw new Error('JSON_INVALID_FORMAT');
      }

      let flowData = json;

      // Formato wrapper de template: { id, name, description, icon, flow: {...} }
      if (json.flow && typeof json.flow === 'object' && !json.nodes) {
        logger.debug('JSON detectado como formato wrapper (template), extraindo campo flow', {
          hasMetadata: !!(json.id || json.name || json.description || json.icon),
          jsonKeys: Object.keys(json),
        });
        flowData = json.flow;
      }

      // Formato da engine: nodes como array
      if (Array.isArray(flowData.nodes)) {
        logger.debug('JSON detectado como formato da engine, convertendo para Rete', {
          nodeCount: flowData.nodes.length,
        });
        const converted = engineFlowToReteJson(flowData);
        if (!converted || !converted.nodes || Object.keys(converted.nodes).length === 0) {
          throw new Error('JSON_ENGINE_CONVERSION_FAILED');
        }
        logger.debug('JSON convertido com sucesso', {
          nodeCount: Object.keys(converted.nodes).length,
        });
        return { reteJson: converted, format: 'json' };
      }

      // Formato Rete: nodes como objeto
      if (flowData.nodes && typeof flowData.nodes === 'object') {
        return { reteJson: flowData, format: 'json' };
      }

      logger.warn('JSON com formato desconhecido', {
        hasNodes: !!flowData.nodes,
        nodesType: typeof flowData.nodes,
        nodesIsArray: Array.isArray(flowData.nodes),
        jsonKeys: Object.keys(flowData),
        hasWrapper: !!json.flow,
      });
      throw new Error('JSON_UNKNOWN_FORMAT');
    };

    const inferFlowNameFromFile = (fileName) => {
      const raw = String(fileName || '').trim();
      const stripped = raw.replace(/\.(bpmn|xml)$/i, '').trim();
      return stripped || 'Fluxo BPMN importado';
    };

    const buildBpmnDraftFlow = (rawText) => ({
      tenantId: currentFlow?.tenantId || agent?.tenantId || 'demo-tenant',
      id: currentFlow?.id || `bpmn-import-${Date.now()}`,
      name: currentFlow?.name || inferFlowNameFromFile(file?.name),
      version: Number.isFinite(Number(currentFlow?.version)) ? Number(currentFlow.version) : 1,
      nodes: [],
      metadata: {
        ...(currentFlow?.metadata && typeof currentFlow.metadata === 'object' ? currentFlow.metadata : {}),
        sourceName: file?.name || null,
        diagramType: 'bpmn',
        editorMode: 'bpmn',
        sourceXml: String(rawText || ''),
      },
    });

    const importBpmnFile = (rawText) => {
      const viewModel = bpmnXmlToViewModel(rawText, {
        name: file?.name || currentFlow?.name,
      });
      return {
        viewModel,
        sourceXml: String(rawText || ''),
        format: 'bpmn',
      };
    };

    const isLikelyXml = (rawText) => {
      const trimmed = String(rawText || '').trim();
      return trimmed.startsWith('<?xml') || trimmed.startsWith('<');
    };

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const importSessionId = ++bpmnImportSessionRef.current;
        const rawText = String(reader.result || '');
        const lowerName = String(file.name || '').toLowerCase();
        const isBpmnByExtension = lowerName.endsWith('.bpmn') || lowerName.endsWith('.xml');
        const importResult = (() => {
          if (isBpmnByExtension) {
            return importBpmnFile(rawText);
          }

          try {
            return importJsonFile(rawText);
          } catch (jsonErr) {
            if (jsonErr instanceof SyntaxError && isLikelyXml(rawText)) {
              return importBpmnFile(rawText);
            }
            throw jsonErr;
          }
        })();

        // Carrega o JSON no editor
        const editor = editorRef.current;
        if (!editor || !editor.loadFromJson) {
          showToast('Editor não está pronto', 'warning', 2000);
          return;
        }

        if (importResult.format === 'bpmn') {
          const importedDraftFlow = buildBpmnDraftFlow(importResult.sourceXml);

          setDraftFlow(importedDraftFlow);
          setDraftMeta({
            id: importedDraftFlow?.id,
            name: importedDraftFlow?.name,
            kind: importedDraftFlow?.kind,
            tenantId: importedDraftFlow?.tenantId || currentFlow?.tenantId || agent?.tenantId || 'demo-tenant',
            metadata: importedDraftFlow?.metadata || {},
          });
          setBpmnViewModel(importResult.viewModel || null);
          setBpmnSelection(null);
          setBpmnSourceDirty(false);
          setEditorMode('bpmn');
          setCanvasLocked(false);
          setCanvasLockReason(null);

          // Limpa o fluxo atual do estado para permitir trabalhar com o importado
          clearCurrentFlow();
          setSelectedNode(null);

          showToast('BPMN importado no modo visual', 'success', 2000);

          // Permite que o React pinte o modo visual antes da conversão para engine.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (importSessionId !== bpmnImportSessionRef.current) return;

          const { flowDefinition, report } = bpmnXmlToEngineFlow(importResult.sourceXml, {
            id: currentFlow?.id,
            name: currentFlow?.name,
            metadata: {
              sourceName: file?.name || null,
            },
          });

          const converted = engineFlowToReteJson(flowDefinition);
          if (!converted || !converted.nodes || Object.keys(converted.nodes).length === 0) {
            throw new Error('BPMN_CONVERSION_FAILED');
          }

          await editor.loadFromJson(converted);
          if (importSessionId !== bpmnImportSessionRef.current) return;

          const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
          const warningCount = warnings.length;

          if (warningCount > 0) {
            logger.info('BPMN importado com avisos', {
              warningCount,
              warnings,
              fileName: file.name,
            });
            showToast(
              buildBpmnWarningToastMessage(warnings) || `BPMN importado com ${warningCount} aviso(s)`,
              'warning',
              { duration: 7000, log: false }
            );
          }

          setDraftFlow(flowDefinition);
          setDraftMeta({
            id: flowDefinition?.id,
            name: flowDefinition?.name,
            kind: flowDefinition?.kind,
            tenantId: flowDefinition?.tenantId || currentFlow?.tenantId || agent?.tenantId || 'demo-tenant',
            metadata: flowDefinition?.metadata || {},
          });

          // Opcional: valida o fluxo importado após um pequeno delay
          // O validateCurrentFlow já atualiza o estado validation internamente
          setTimeout(async () => {
            if (importSessionId !== bpmnImportSessionRef.current) return;
            try {
              const reteJson = await editor.editor?.current?.toJSON();
              if (reteJson) {
                const validationResult = await validateCurrentFlow(reteJson);
                if (validationResult) {
                  applyBackendValidationErrors(
                    editor.editor?.current,
                    editor.area,
                    validationResult.errors || []
                  );

                  // Expande painel de validação se houver erros
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    setValidationCollapsed(false);
                  }
                }
              }
            } catch (validationErr) {
              logger.debug('Erro ao validar fluxo importado (não crítico)', { error: validationErr });
            }
          }, 500);

          return;
        }

        const reteJson = importResult.reteJson;

        // Valida se o JSON convertido tem nós válidos
        if (!reteJson.nodes || typeof reteJson.nodes !== 'object' || Object.keys(reteJson.nodes).length === 0) {
          showToast('Arquivo inválido: nenhum nó válido encontrado', 'error', 3000);
          return;
        }

        try {
          await editor.loadFromJson(reteJson);
          const importedAs = importResult.format === 'bpmn' ? 'BPMN' : 'JSON';
          showToast(`${importedAs} importado com sucesso`, 'success', 2000);
          if (importResult.format === 'bpmn' && importResult.warningCount > 0) {
            logger.info('BPMN importado com avisos', {
              warningCount: importResult.warningCount,
              warnings: importResult.warnings,
              fileName: file.name,
            });
            showToast(
              buildBpmnWarningToastMessage(importResult.warnings) || `BPMN importado com ${importResult.warningCount} aviso(s)`,
              'warning',
              { duration: 7000, log: false }
            );
          }
          setCanvasLocked(false);
          setCanvasLockReason(null);

          if (importResult.format === 'bpmn') {
            const importedFlow = importResult.flowDefinition;
            setDraftFlow(importedFlow);
            setDraftMeta({
              id: importedFlow?.id,
              name: importedFlow?.name,
              kind: importedFlow?.kind,
              tenantId: importedFlow?.tenantId || currentFlow?.tenantId || agent?.tenantId || 'demo-tenant',
              metadata: importedFlow?.metadata || {},
            });
            setBpmnViewModel(importResult.viewModel || null);
            setBpmnSelection(null);
            setBpmnSourceDirty(false);
            setEditorMode('bpmn');
          } else {
            setDraftFlow(null);
            setDraftMeta(null);
            setBpmnViewModel(null);
            setBpmnSelection(null);
            setBpmnSourceDirty(false);
            setEditorMode('engine');
          }

          // Limpa o fluxo atual do estado para permitir trabalhar com o importado
          clearCurrentFlow();
          setSelectedNode(null);

          // Opcional: valida o fluxo importado após um pequeno delay
          // O validateCurrentFlow já atualiza o estado validation internamente
          setTimeout(async () => {
            try {
              const reteJson = await editor.editor?.current?.toJSON();
              if (reteJson) {
                const validationResult = await validateCurrentFlow(reteJson);
                if (validationResult) {
                  applyBackendValidationErrors(
                    editor.editor?.current,
                    editor.area,
                    validationResult.errors || []
                  );

                  // Expande painel de validação se houver erros
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    setValidationCollapsed(false);
                  }
                }
              }
            } catch (validationErr) {
              logger.debug('Erro ao validar fluxo importado (não crítico)', { error: validationErr });
            }
          }, 500);
        } catch (loadErr) {
          logger.error('Erro ao carregar JSON no editor', loadErr);
          showToast('Erro ao carregar fluxo no editor', 'error', 3000);
        }
      } catch (err) {
        logger.error('Erro ao importar arquivo', err);
        if (err instanceof SyntaxError || err?.message === 'JSON_INVALID_FORMAT') {
          showToast('Erro ao importar fluxo: JSON malformado', 'error', 3000);
        } else if (err?.message === 'JSON_UNKNOWN_FORMAT') {
          showToast('JSON inválido: formato não reconhecido. Esperado formato Rete ou Engine.', 'error', 3000);
        } else if (err?.message === 'JSON_ENGINE_CONVERSION_FAILED') {
          showToast('JSON inválido: não foi possível converter o formato da engine', 'error', 3000);
        } else if (err?.message === 'BPMN_CONVERSION_FAILED') {
          showToast('Erro ao importar fluxo: BPMN sem nós compatíveis', 'error', 3000);
        } else {
          showToast('Erro ao importar fluxo: arquivo inválido', 'error', 3000);
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [
    activeFlow?.id,
    activeFlow?.name,
    activeFlow?.tenantId,
    activeFlowMetadata,
    agent?.tenantId,
    bpmnImportSessionRef,
    clearCurrentFlow,
    currentFlow?.id,
    currentFlow?.kind,
    currentFlow?.metadata,
    currentFlow?.name,
    currentFlow?.tenantId,
    currentFlow?.version,
    draftFlow?.kind,
    draftMeta,
    editorMode,
    editorRef,
    fileInputRef,
    isBpmnDiagram,
    setBpmnSelection,
    setBpmnSourceDirty,
    setBpmnViewModel,
    setCanvasLockReason,
    setCanvasLocked,
    setDraftFlow,
    setDraftMeta,
    setEditorMode,
    setSelectedNode,
    setValidationCollapsed,
    showToast,
    validateCurrentFlow,
  ]);

  return {
    handleImportJson,
    handleExportJson,
    handleFileChange,
  };
}
