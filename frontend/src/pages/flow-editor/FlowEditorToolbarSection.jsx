import React from 'react';
import { Toolbar } from '../../Toolbar';
import { FlowSelector } from '../../components/FlowSelector';
import { FlowTemplateSelector } from '../../components/FlowTemplateSelector';
import { FlowGeneratorDialog } from '../../components/FlowGeneratorDialog';
import { SaveAsTemplateDialog } from '../../components/SaveAsTemplateDialog';
import { LogViewer } from '../../components/LogViewer';
import { FlowCurrentDisplay } from '../../components/FlowCurrentDisplay';
import { ThemeSelector } from '../../components/ThemeSelector';

export function FlowEditorToolbarSection({
  // Toolbar action handlers
  handleImportJson,
  handleExportJson,
  handleSimulate,
  handleTest,
  handleSave,
  handleValidate,
  handleArrange,
  handleZoomIn,
  handleZoomOut,
  handleZoomFit,
  handleResetZoom,
  handleCenterCanvas,
  handleUndo,
  handleRedo,
  handleCopy,
  handlePaste,
  handleDuplicate,
  handleSearchNode,
  handleGoToNode,
  handleNextNode,
  handlePreviousNode,
  handleClearEditor,
  handleExportPNG,
  handleExportSVG,
  handleExportPDF,
  handleImportTemplate,
  handleValidateAndFix,
  handleShowErrors,
  handleToggleDebug,
  handleShowStatistics,
  handleOptimizeLayout,
  handleSimplifyGraph,
  handleToggleMinimap,
  minimapVisible,
  // Auth / WebSocket state
  isAuthenticated,
  wsStatus,
  // Flow selector
  handleFlowSelected,
  currentFlow,
  flowListRefreshTrigger,
  // Environment
  flowEnvironment,
  handleEnvironmentChange,
  // Dialog triggers
  setShowTemplateSelector,
  setShowFlowGenerator,
  handleDeleteClick,
  setShowLogViewer,
  setShowSaveAsTemplate,
  // BPMN mode
  isBpmnDiagram,
  editorMode,
  canRenderBpmn,
  handleSwitchEditorMode,
  // Template selector dialog
  showTemplateSelector,
  handleTemplateSelected,
  templateListRefreshTrigger,
  // Flow generator dialog
  showFlowGenerator,
  handleFlowGenerated,
  // Save as template dialog
  showSaveAsTemplate,
  handleSaveAsTemplate,
  // Log viewer dialog
  showLogViewer,
  // Loading state
  loading,
  // FlowCurrentDisplay
  displayedFlow,
  handleFlowKindChange,
}) {
  return (
    <>
      <Toolbar
        onImportJson={handleImportJson}
        onExportJson={handleExportJson}
        onSimulate={handleSimulate}
        onTest={handleTest}
        onSave={handleSave}
        onSaveAsTemplate={() => setShowSaveAsTemplate(true)}
        onValidate={handleValidate}
        onArrange={handleArrange}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onResetZoom={handleResetZoom}
        onCenterCanvas={handleCenterCanvas}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDuplicate={handleDuplicate}
        onSearchNode={handleSearchNode}
        onGoToNode={handleGoToNode}
        onNextNode={handleNextNode}
        onPreviousNode={handlePreviousNode}
        onClearEditor={handleClearEditor}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportPDF={handleExportPDF}
        onImportTemplate={handleImportTemplate}
        onValidateAndFix={handleValidateAndFix}
        onShowErrors={handleShowErrors}
        onToggleDebug={handleToggleDebug}
        onShowStatistics={handleShowStatistics}
        onOptimizeLayout={handleOptimizeLayout}
        onSimplifyGraph={handleSimplifyGraph}
        onToggleMinimap={handleToggleMinimap}
        minimapVisible={minimapVisible}
        currentZoom={1}
      >
        {/* Indicador de status WebSocket */}
        {isAuthenticated && (
          <div 
            className="flex items-center gap-1 px-2 py-1 text-xs"
            title={wsStatus.title}
          >
            <span 
              className={`inline-block w-2 h-2 rounded-full ${wsStatus.indicatorDotClassName}`}
            />
            <span className="hidden sm:inline text-text-secondary">
              {wsStatus.label}
            </span>
          </div>
        )}
        <button className="btn-base" onClick={() => setShowTemplateSelector(true)}>
          <span className="icon icon-plus"></span>
          <span>Novo</span>
        </button>
        <FlowSelector
          onFlowSelected={handleFlowSelected}
          currentFlowId={currentFlow?.id}
          refreshTrigger={flowListRefreshTrigger}
        />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Env</span>
          <select
            value={flowEnvironment}
            disabled={!currentFlow?.id}
            onChange={(e) => handleEnvironmentChange(e.target.value)}
            className="px-2 py-1 rounded border border-border-default bg-bg-elevated text-text-primary"
          >
            <option value="dev">dev</option>
            <option value="stage">stage</option>
            <option value="prod">prod</option>
          </select>
        </div>
        <button className="btn-base" onClick={() => setShowFlowGenerator(true)} title="Gerar fluxo com IA">
          <span className="icon icon-ai"></span>
          <span>Gerar com IA</span>
        </button>
        {currentFlow?.id && (
          <button className="btn-base" onClick={handleDeleteClick}>
            <span className="icon icon-delete"></span>
            <span>Remover</span>
          </button>
        )}
        <button className="btn-base" onClick={() => setShowLogViewer(true)}>
          <span className="icon icon-logs"></span>
          <span>Logs</span>
        </button>
        {isBpmnDiagram ? (
          <div className="flex items-center gap-1 rounded-md border border-border-default bg-bg-elevated p-1">
            <button
              type="button"
              className={`btn-base ${editorMode === 'bpmn' ? 'btn-primary' : ''}`}
              disabled={!canRenderBpmn}
              onClick={() => handleSwitchEditorMode('bpmn')}
              title="Abrir diagrama em modo BPMN visual"
            >
              <span>BPMN</span>
            </button>
            <button
              type="button"
              className={`btn-base ${editorMode === 'engine' ? 'btn-primary' : ''}`}
              onClick={() => handleSwitchEditorMode('engine')}
              title="Abrir fluxo no editor engine atual"
            >
              <span>Engine</span>
            </button>
          </div>
        ) : null}
        <ThemeSelector />
      </Toolbar>

      {showTemplateSelector && (
        <FlowTemplateSelector
          onTemplateSelected={handleTemplateSelected}
          onCancel={() => setShowTemplateSelector(false)}
          refreshTrigger={templateListRefreshTrigger}
        />
      )}

      {showFlowGenerator && (
        <FlowGeneratorDialog
          onFlowGenerated={handleFlowGenerated}
          onCancel={() => setShowFlowGenerator(false)}
        />
      )}

      <SaveAsTemplateDialog
        isOpen={showSaveAsTemplate}
        onClose={() => setShowSaveAsTemplate(false)}
        onSave={handleSaveAsTemplate}
        flowName={currentFlow?.name || 'Fluxo sem nome'}
      />

      {showLogViewer && (
        <LogViewer onClose={() => setShowLogViewer(false)} />
      )}

      {loading && <div className="loading-indicator">Carregando...</div>}

      {/* Barra "Fluxo atual" - EXATAMENTE como no modelo */}
      <FlowCurrentDisplay
        displayedFlow={displayedFlow}
        onRegenerate={() => setShowFlowGenerator(true)}
        kind={displayedFlow?.kind || currentFlow?.kind || 'chat'}
        diagramType={isBpmnDiagram ? 'bpmn' : null}
        onKindChange={handleFlowKindChange}
      />
    </>
  );
}
