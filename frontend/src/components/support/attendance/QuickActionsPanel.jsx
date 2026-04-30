import React from 'react';

export function QuickActionsPanel({ executionMode, onToggleMode, onOpenTemplate, onOpenAttachments, onOpenHistory, onOpenSupport, onOpenInternalNotes }) {
  return (
    <aside className="attendance-quick-actions">
      <button type="button" className="attendance-quick-btn attendance-quick-btn--mode" onClick={onToggleMode}>
        BOT / Atendente
        <span>{executionMode || '-'}</span>
      </button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenTemplate}>Template</button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenAttachments}>Anexos</button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenHistory}>Historico</button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenSupport}>Suporte</button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenInternalNotes}>Notas internas</button>
    </aside>
  );
}
