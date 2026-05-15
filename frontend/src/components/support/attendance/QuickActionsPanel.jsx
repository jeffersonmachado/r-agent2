import React from 'react';

const MODE_ICON = { Bot: '🤖', Humano: '👤', Híbrido: '⏸' };

export function QuickActionsPanel({ executionMode, onToggleMode, onOpenTemplate, onOpenAttachments, onOpenHistory, onOpenSupport, onOpenInternalNotes }) {
  const modeIcon = MODE_ICON[executionMode] || '🤖';
  return (
    <aside className="attendance-quick-actions">
      <button type="button" className="attendance-quick-btn attendance-quick-btn--mode" onClick={onToggleMode} title="Alternar modo BOT / Atendente humano">
        <span>{modeIcon} BOT / Atendente</span>
        <span className="attendance-quick-btn-mode-label">{executionMode || '-'}</span>
      </button>
      <button type="button" className="attendance-quick-btn attendance-quick-btn--soon" onClick={onOpenTemplate} title="Em breve">
        📋 Template
        <span className="attendance-quick-soon-badge">Em breve</span>
      </button>
      <button type="button" className="attendance-quick-btn attendance-quick-btn--soon" onClick={onOpenAttachments} title="Em breve">
        📎 Anexos
        <span className="attendance-quick-soon-badge">Em breve</span>
      </button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenHistory} title="Ver histórico detalhado no painel inferior">
        🕐 Histórico
      </button>
      <button type="button" className="attendance-quick-btn" onClick={onOpenSupport} title="Ver falhas de entrega">
        🔧 Suporte
      </button>
      <button type="button" className="attendance-quick-btn attendance-quick-btn--soon" onClick={onOpenInternalNotes} title="Em breve">
        📝 Notas internas
        <span className="attendance-quick-soon-badge">Em breve</span>
      </button>
    </aside>
  );
}
