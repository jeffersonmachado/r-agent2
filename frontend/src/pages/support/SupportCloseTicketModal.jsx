import React from 'react';
import { Button } from '../../styles/Button';

export function SupportCloseTicketModal({ isOpen, closing, closeReasons, selectedCloseReasonId, setSelectedCloseReasonId, selectedCloseReasonName, setSelectedCloseReasonName, closeTagsInput, setCloseTagsInput, onConfirmClose, onClose }) {
  if (!isOpen) return null;
  const handleConfirmClose = onConfirmClose;
  const safeClose = () => {
    if (closing) return;
    if (typeof onClose === 'function') onClose();
  };

  return (
    <div
      className="support-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-ticket-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          safeClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          safeClose();
        }
      }}
    >
      <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 id="close-ticket-title" style={{ marginTop: 0 }}>
          Encerrar Ticket
        </h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Motivo de encerramento *
          </label>
          <select
            value={selectedCloseReasonId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedCloseReasonId(id);
              const found = closeReasons.find((r) => r.id === id);
              setSelectedCloseReasonName(found?.name || '');
            }}
            className="support-form-select"
          >
            <option value="">Selecione...</option>
            {closeReasons.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <div style={{ marginTop: '10px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Ou digite um motivo
            </label>
            <input
              type="text"
              value={selectedCloseReasonName}
              onChange={(e) => {
                setSelectedCloseReasonName(e.target.value);
                setSelectedCloseReasonId('');
              }}
              placeholder="Ex: resolvido, sem resposta do cliente..."
              className="support-form-input"
            />
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Tags (opcional)
          </label>
          <input
            type="text"
            value={closeTagsInput}
            onChange={(e) => setCloseTagsInput(e.target.value)}
            placeholder="Ex: cobrança, prioridade, vip (separadas por vírgula)"
            className="support-form-input"
            list="support-known-tags"
          />
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            Dica: use tags curtas e consistentes.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <Button
            onClick={safeClose}
            style={{ background: 'var(--color-bg-secondary)' }}
            disabled={closing}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirmClose} className="support-button-danger" disabled={closing}>
            {closing ? 'Fechando...' : 'Fechar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
