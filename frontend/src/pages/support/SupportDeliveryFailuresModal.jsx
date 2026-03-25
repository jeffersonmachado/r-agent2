import React from 'react';
import { Button } from '../../styles/Button';
import { sendTicketMessage } from '../../api/tickets';
import logger from '../../utils/logger';

export function SupportDeliveryFailuresModal({ isOpen, loading, deliveryFailures, selectedTicket, showToast, showToastRef, onClose }) {
  if (!isOpen) return null;

  const safeClose = () => {
    if (typeof onClose === 'function') onClose();
  };

  return (
    <div
      className="support-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-failures-title"
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
        <h2 id="delivery-failures-title" style={{ marginTop: 0 }}>
          Falhas de entrega
        </h2>

    <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
      Mostra itens com erro no outbound e mensagens do canal marcadas como <strong>failed</strong>.
    </div>

        {loading ? (
          <div style={{ padding: '12px 0' }}>Carregando...</div>
        ) : (
          <>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Outbound queue</div>
          {deliveryFailures.outboundQueue.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#777' }}>Nenhuma falha registrada.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
              {deliveryFailures.outboundQueue.map((it) => {
                const text = it?.message?.body?.text || it?.message?.body?.body || it?.message?.text || '';
                const to = it?.message?.to || null;
                const reasonCode = it?.reason_code || it?.reasonCode || null;
                return (
                  <div key={it.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
                      <strong>{it.channel_type}</strong> • {it.status} • tentativas: {it.attempts ?? '-'}
                      {to ? ` • para: ${to}` : ''}
                    </div>
                    {reasonCode ? (
                      <div style={{ fontSize: '12px', color: '#b45309', marginBottom: '6px' }}>
                        reason_code: <strong>{String(reasonCode)}</strong>
                      </div>
                    ) : null}
                    <div style={{ fontSize: '13px', marginBottom: '6px', whiteSpace: 'pre-wrap' }}>
                      {text ? text : <span style={{ color: '#999' }}>(sem texto)</span>}
                    </div>
                    {it.last_error ? (
                      <div style={{ fontSize: '12px', color: '#b91c1c', marginBottom: '8px' }}>
                        {String(it.last_error).slice(0, 500)}
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                      <Button
                        onClick={async () => {
                          if (!selectedTicket) return;
                          if (!text || !String(text).trim()) {
                            showToast('Não há texto para reenviar', 'warning');
                            return;
                          }
                          try {
                            await sendTicketMessage(selectedTicket.id, String(text));
                            showToastRef.current('Reenvio solicitado', 'success', 2500);
                          } catch (err) {
                            logger.error('Erro ao reenviar', err);
                            showToast('Erro ao reenviar mensagem', 'error');
                          }
                        }}
                      >
                        Reenviar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Channel messages (failed)</div>
            {deliveryFailures.channelMessages.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#777' }}>Nenhuma mensagem do canal marcada como failed.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
                {deliveryFailures.channelMessages.map((m) => {
                  // Tenta encontrar motivo no outbound_queue pelo external_message_id
                  const matchedOut = Array.isArray(deliveryFailures.outboundQueue)
                    ? deliveryFailures.outboundQueue.find(
                        (o) => o.external_message_id && m.external_message_id &&
                          String(o.external_message_id) === String(m.external_message_id)
                      )
                    : null;
                  const reasonCode = m?.reason_code || matchedOut?.reason_code || null;
                  const lastError = m?.last_error || matchedOut?.last_error || null;
                  return (
                    <div key={m.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '10px' }}>
                      <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
                        <strong>{m.channel_type}</strong> • {m.status} • {m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : ''}
                      </div>
                      {reasonCode ? (
                        <div style={{ fontSize: '12px', color: '#b45309', marginBottom: '6px' }}>
                          reason_code: <strong>{String(reasonCode)}</strong>
                        </div>
                      ) : null}
                      <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap', marginBottom: '6px' }}>
                        {m?.body?.text ? String(m.body.text) : JSON.stringify(m.body || {})}
                      </div>
                      {lastError ? (
                        <div style={{ fontSize: '12px', color: '#b91c1c' }}>
                          {String(lastError).slice(0, 500)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <Button
                onClick={safeClose}
                style={{ background: 'var(--color-bg-secondary)' }}
              >
                Fechar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
