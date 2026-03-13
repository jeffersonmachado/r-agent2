import React from 'react';
import { Dialog } from './Dialog';

function FullscreenToggleIcon({ fullscreen }) {
  if (fullscreen) {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
      </svg>
    );
  }

  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  );
}

export function GeneratedFlowModal({
  isOpen,
  editorUrl,
  fullscreen,
  modalSize,
  onClose,
  onToggleFullscreen,
  onSizeChange,
}) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={<span>Fluxo gerado (artefato)</span>}
      headerActions={
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFullscreen();
          }}
          className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          title={fullscreen ? 'Sair da tela cheia (F11)' : 'Tela cheia (F11)'}
        >
          <FullscreenToggleIcon fullscreen={fullscreen} />
        </button>
      }
      size={fullscreen ? 'full' : 'xl'}
      draggable={!fullscreen}
      resizable={!fullscreen}
      dynamicSize={fullscreen ? { width: window.innerWidth - 32, isCollapsed: false } : null}
      onSizeChange={onSizeChange}
    >
      <div
        className="w-full overflow-hidden rounded-lg border border-border-default bg-bg-primary"
        style={{
          height: fullscreen
            ? 'calc(100vh - 6rem)'
            : (modalSize?.height ? Math.max(260, modalSize.height - 140) : 600),
        }}
      >
        <iframe
          title="Editor de Fluxos"
          src={editorUrl}
          className="w-full h-full"
          style={{ border: 0 }}
        />
      </div>
    </Dialog>
  );
}
