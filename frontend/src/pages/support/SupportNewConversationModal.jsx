import React from 'react';
import { Button } from '../../styles/Button';
import { createTicket } from '../../api/tickets';
import logger from '../../utils/logger';

export function SupportNewConversationModal({ isOpen, newConversationPhone, setNewConversationPhone, newConversationMessage, setNewConversationMessage, newConversationQueue, setNewConversationQueue, queues, onClose, onTicketCreated, showToast }) {
  if (!isOpen) return null;

  const handleStartConversation = async () => {
    if (!newConversationPhone.trim()) {
      showToast('Número de telefone é obrigatório', 'warning');
      return;
    }
    if (!newConversationQueue.trim()) {
      showToast('Fila é obrigatória', 'warning');
      return;
    }
    try {
      const ticket = await createTicket({
        phoneNumber: newConversationPhone.trim(),
        queue: newConversationQueue.trim(),
        initialMessage: newConversationMessage.trim() || undefined,
      });
      showToast('Conversa iniciada com sucesso!', 'success');
      onClose();
      onTicketCreated(ticket);
    } catch (error) {
      logger.error('Erro ao iniciar conversa', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao iniciar conversa';
      showToast(errorMessage, 'error');
    }
  };

  return (
    <div
      className="support-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conversation-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="support-modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 id="new-conversation-title" style={{ marginTop: 0 }}>
          Iniciar Nova Conversa
        </h2>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="new-conversation-phone" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Número de Telefone *
          </label>
          <input
            id="new-conversation-phone"
            type="tel"
            value={newConversationPhone}
            onChange={(e) => setNewConversationPhone(e.target.value)}
            placeholder="+5511999999999 ou 5511999999999"
            className="support-form-input"
            aria-required="true"
            aria-describedby="phone-format-hint"
            autoFocus
          />
          <small id="phone-format-hint" style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            Formato: +5511999999999 ou 5511999999999
          </small>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="new-conversation-queue" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Fila *
          </label>
          <select
            id="new-conversation-queue"
            value={newConversationQueue}
            onChange={(e) => setNewConversationQueue(e.target.value)}
            className="support-form-select"
            aria-required="true"
          >
            <option value="">Selecione uma fila</option>
            {queues.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="new-conversation-message" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Mensagem Inicial (opcional)
          </label>
          <textarea
            id="new-conversation-message"
            value={newConversationMessage}
            onChange={(e) => setNewConversationMessage(e.target.value)}
            placeholder="Olá! Como posso ajudá-lo hoje?"
            rows={4}
            className="support-form-textarea"
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button
            onClick={onClose}
            style={{ backgroundColor: '#6c757d' }}
            aria-label="Cancelar criação de nova conversa"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleStartConversation}
            style={{ backgroundColor: '#25D366', color: 'white' }}
            aria-label="Iniciar nova conversa"
          >
            Iniciar Conversa
          </Button>
        </div>
      </div>
    </div>
  );
}
