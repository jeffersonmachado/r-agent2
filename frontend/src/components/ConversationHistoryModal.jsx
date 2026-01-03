/**
 * Modal para visualizar histórico completo de uma conversa.
 */

import React from 'react';
import { Button } from '../styles/Button';

/**
 * @param {Object} props
 * @param {Object} props.conversation - Dados da conversa (replay)
 * @param {Function} props.onClose - Função para fechar o modal
 */
export function ConversationHistoryModal({ conversation, onClose }) {
  if (!conversation) return null;

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('pt-BR');
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-xl border border-border-default shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between bg-bg-elevated">
          <div>
            <h2 className="text-xl font-bold text-text-primary">Histórico da Conversa</h2>
            <p className="text-sm text-text-secondary mt-1">
              Session ID: <span className="font-mono">{conversation.sessionId || '-'}</span>
            </p>
            {conversation.flowId && (
              <p className="text-sm text-text-secondary">
                Fluxo: <span className="font-mono">{conversation.flowId}</span>
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕ Fechar
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {conversation.messages && conversation.messages.length > 0 ? (
            <div className="space-y-4">
              {conversation.messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-4 ${
                      msg.from === 'user'
                        ? 'bg-accent-primary text-white'
                        : 'bg-bg-elevated border border-border-default text-text-primary'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium opacity-75">
                        {msg.from === 'user' ? '👤 Usuário' : msg.from === 'bot' ? '🤖 Bot' : '⚙️ Sistema'}
                      </span>
                      <span className="text-xs opacity-60">
                        {formatTime(msg.at)}
                      </span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {msg.text || '(sem texto)'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-text-secondary">
              Nenhuma mensagem encontrada nesta conversa
            </div>
          )}

          {/* Handoffs */}
          {conversation.handoffs && conversation.handoffs.length > 0 && (
            <div className="mt-8 pt-8 border-t border-border-default">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Handoffs</h3>
              <div className="space-y-2">
                {conversation.handoffs.map((handoff, index) => (
                  <div
                    key={index}
                    className="bg-bg-elevated border border-border-default rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-text-primary">
                          Fila: {handoff.queue}
                        </span>
                      </div>
                      <span className="text-xs text-text-secondary">
                        {formatDate(handoff.at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Nós Visitados */}
          {conversation.nodesVisited && conversation.nodesVisited.length > 0 && (
            <div className="mt-8 pt-8 border-t border-border-default">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Nós Visitados</h3>
              <div className="space-y-2">
                {conversation.nodesVisited.map((node, index) => (
                  <div
                    key={index}
                    className="bg-bg-elevated border border-border-default rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono text-text-primary">
                        {node.nodeId || '(sem nó)'}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {formatTime(node.at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-default bg-bg-elevated flex items-center justify-between">
          <div className="text-sm text-text-secondary">
            {conversation.messages?.length || 0} mensagem(ns)
            {conversation.handoffs?.length > 0 && ` • ${conversation.handoffs.length} handoff(s)`}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}

