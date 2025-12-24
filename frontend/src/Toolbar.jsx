import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './styles/Button';
import { useTheme } from './styles/themeContext';

/**
 * Barra de ferramentas simplificada e responsiva
 */
export function Toolbar({
  onImportJson,
  onExportJson,
  onSimulate,
  onSave,
  onValidate,
  onArrange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onResetZoom,
  onCenterCanvas,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onSearchNode,
  onImportTemplate,
  children,
}) {
  const { themeName } = useTheme();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (onSearchNode && searchQuery.trim()) {
      onSearchNode(searchQuery.trim());
      setSearchQuery('');
      setShowSearch(false);
    }
  };

  return (
    <div 
      className="h-12 flex items-center px-2 border-b"
      style={{
        backgroundColor: themeName === 'dark' ? '#1a1a1a' : '#ffffff',
        borderColor: themeName === 'dark' ? '#2a2a2a' : '#e5e7eb'
      }}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        {children && React.Children.toArray(children)[0]}
      </div>

      <div className="toolbar-separator"></div>

      <div className="toolbar-group toolbar-group-main">
        {onSave && (
          <button className="tb-btn" onClick={onSave} title="Salvar fluxo">
            💾 Salvar
          </button>
        )}
        {onValidate && (
          <button className="tb-btn" onClick={onValidate} title="Validar fluxo">
            ✓ Validar
          </button>
        )}
        {onSimulate && (
          <button className="tb-btn" onClick={onSimulate} title="Simular fluxo">
            ▶️ Simular
          </button>
        )}
        {onArrange && (
          <button className="tb-btn" onClick={onArrange} title="Organizar nós">
            ⚙️ Organizar
          </button>
        )}
      </div>

      <div className="toolbar-separator"></div>

      <div className="toolbar-group toolbar-group-zoom">
        {onZoomOut && (
          <button className="tb-btn" onClick={onZoomOut} title="Diminuir zoom">
            ➖
          </button>
        )}
        {onResetZoom && (
          <button className="tb-btn" onClick={onResetZoom} title="Zoom 100%">
            100%
          </button>
        )}
        {onZoomIn && (
          <button className="tb-btn" onClick={onZoomIn} title="Aumentar zoom">
            ➕
          </button>
        )}
        {onZoomFit && (
          <button className="tb-btn" onClick={onZoomFit} title="Ajustar zoom">
            🔍 Fit
          </button>
        )}
      </div>

      <div className="toolbar-separator"></div>

      <div className="toolbar-group toolbar-group-edit">
        {onUndo && (
          <button className="tb-btn" onClick={onUndo} title="Desfazer">
            ↶
          </button>
        )}
        {onRedo && (
          <button className="tb-btn" onClick={onRedo} title="Refazer">
            ↷
          </button>
        )}
        {onCopy && (
          <button className="tb-btn" onClick={onCopy} title="Copiar">
            📋
          </button>
        )}
        {onPaste && (
          <button className="tb-btn" onClick={onPaste} title="Colar">
            📄
          </button>
        )}
      </div>

      <div className="toolbar-spacer"></div>

      {onSearchNode && (
        <>
          {showSearch ? (
            <form onSubmit={handleSearchSubmit} className="toolbar-search-form">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar nó..."
                className="toolbar-search-input"
                autoFocus
                onBlur={() => setTimeout(() => setShowSearch(false), 200)}
              />
              <button className="tb-btn" type="submit" title="Buscar">
                🔍
              </button>
            </form>
          ) : (
            <button className="tb-btn" onClick={() => setShowSearch(true)} title="Buscar nó">
              🔍 Buscar
            </button>
          )}
        </>
      )}

      {(onImportJson || onExportJson || onImportTemplate || onUndo || onRedo || onCopy || onPaste || onDuplicate) && (
        <div className="toolbar-more-container">
          <button
            className="tb-btn"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            title="Mais opções"
          >
            ⋯ Mais
          </button>

          {showMoreMenu && typeof document !== 'undefined' && createPortal(
            <>
              <div
                className="toolbar-more-overlay"
                onClick={() => setShowMoreMenu(false)}
              />
              <div className="toolbar-more-menu">
                <div className="toolbar-more-header">
                  <span>Mais opções</span>
                  <button
                    type="button"
                    onClick={() => setShowMoreMenu(false)}
                    className="toolbar-more-close"
                  >
                    ✕
                  </button>
                </div>
                <div className="toolbar-more-content">
                  {onImportJson && (
                    <button type="button" onClick={() => { onImportJson(); setShowMoreMenu(false); }} className="toolbar-more-item">
                      📥 Importar JSON
                    </button>
                  )}
                  {onExportJson && (
                    <button type="button" onClick={() => { onExportJson(); setShowMoreMenu(false); }} className="toolbar-more-item">
                      📤 Exportar JSON
                    </button>
                  )}
                  {onImportTemplate && (
                    <button type="button" onClick={() => { onImportTemplate(); setShowMoreMenu(false); }} className="toolbar-more-item">
                      📋 Importar Template
                    </button>
                  )}
                  {onDuplicate && (
                    <button type="button" onClick={() => { onDuplicate(); setShowMoreMenu(false); }} className="toolbar-more-item">
                      📑 Duplicar
                    </button>
                  )}
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      )}

      <div className="toolbar-separator"></div>

      <div className="toolbar-group toolbar-group-utils">
        {children && React.Children.toArray(children).slice(1)}
      </div>
    </div>
  );
}
