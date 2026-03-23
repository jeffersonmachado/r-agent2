import { useEffect, useRef } from 'react';
import { Button } from '../../../styles/Button';

export function SupportConversationPane({
  isMobile,
  selectedTicket,
  setSelectedTicket,
  setIsRightPanelCollapsed,
  handoverLoading,
  handleTakeOver,
  handleReturnToBot,
  handlePause,
  handleResume,
  deliveryFailuresLoading,
  openDeliveryFailures,
  formatDate,
  messagesContainerRef,
  timelineMessages,
  renderTimelineMessageContent,
  getDeliveryStatusBadge,
  assignedTo,
  setAssignedTo,
  agent,
  handleAssign,
  quickReplySelectedCategory,
  setQuickReplySelectedCategory,
  quickReplyCategories,
  messageText,
  setMessageText,
  quickReplySlashOpen,
  quickReplySlashResults,
  slashMenuMode,
  slashCommandResults,
  slashMenuCursorIndex,
  onSelectSlashItem,
  onHoverSlashItem,
  onComposerKeyDown,
  formatTicketStatus,
  handleSendMessage,
  handleClose,
}) {
  const slashMenuRef = useRef(null);

  useEffect(() => {
    if (!quickReplySlashOpen) return;
    if (slashMenuCursorIndex < 0) return;
    const menuEl = slashMenuRef.current;
    if (!menuEl) return;

    const activeItem = menuEl.querySelector('.support-slash-menu-item.is-active');
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [quickReplySlashOpen, slashMenuCursorIndex, slashMenuMode]);

  const isWaitingTicket = selectedTicket.status === 'waiting';
  const isInProgressTicket = selectedTicket.status === 'in_progress';
  const showConversationComposer = selectedTicket.status === 'in_progress';
  const showAssignForm = false;
  const shouldRenderHistory =
    selectedTicket.status === 'in_progress'
    || selectedTicket.status === 'paused';

  return (
    <div style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flexShrink: 0 }}>
          <h3 className="support-details-title">
            {isMobile ? (
              <button
                type="button"
                className="support-mobile-back-button"
                onClick={() => setSelectedTicket(null)}
                aria-label="Voltar para lista de chamados"
              >
                ‹
              </button>
            ) : null}
            <span className="support-ticket-title-number">#{selectedTicket.id}</span>
            {isMobile ? (
              <button
                type="button"
                className="support-mobile-panel-button"
                onClick={() => setIsRightPanelCollapsed(false)}
                aria-label="Abrir painel lateral"
              >
                ☰
              </button>
            ) : null}
            {selectedTicket.unreadCount > 0 ? (
              <span className="support-ticket-unread-badge" role="status" aria-label={`${selectedTicket.unreadCount} mensagens não lidas`}>
                {selectedTicket.unreadCount}
              </span>
            ) : null}
          </h3>
        </div>

        {!isWaitingTicket && !isInProgressTicket ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              marginBottom: '12px',
              padding: '10px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: '12px',
              background: 'var(--color-bg-elevated)',
              flexWrap: 'wrap',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span>Status: <strong>{formatTicketStatus ? formatTicketStatus(selectedTicket.status) : selectedTicket.status}</strong></span>
              <span>Modo: <strong>{selectedTicket.mode || 'bot'}</strong></span>
              <span>Fila: <strong>{selectedTicket.queue || 'default'}</strong></span>
            </div>
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              Atualizado: {formatDate(selectedTicket.updatedAt || selectedTicket.createdAt)}
            </div>
          </div>
        ) : null}

        <div className="support-ticket-actions" style={{ flexShrink: 0 }}>
          {isWaitingTicket ? (
            <Button onClick={handleAssign} className="support-ticket-action-btn">Atribuir Chamado</Button>
          ) : null}
          {!isWaitingTicket && !isInProgressTicket && (selectedTicket.mode || 'bot') === 'bot' ? (
            <Button onClick={handleTakeOver} disabled={handoverLoading} className="support-ticket-action-btn">Assumir atendimento</Button>
          ) : null}
          {!isWaitingTicket && !isInProgressTicket && (selectedTicket.mode || 'bot') === 'human' ? (
            <>
              <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-ticket-action-btn">Devolver ao bot</Button>
              <Button onClick={handlePause} disabled={handoverLoading} className="support-ticket-action-btn">Pausar</Button>
            </>
          ) : null}
          {!isWaitingTicket && !isInProgressTicket && (selectedTicket.mode || 'bot') === 'paused' ? (
            <>
              <Button onClick={handleResume} disabled={handoverLoading} className="support-ticket-action-btn">Retomar (humano)</Button>
              <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-ticket-action-btn">Devolver ao bot</Button>
            </>
          ) : null}
          {!isWaitingTicket && !isInProgressTicket ? (
            <>
              <Button
                onClick={openDeliveryFailures}
                disabled={deliveryFailuresLoading}
                className="support-ticket-action-btn"
                style={{ background: 'var(--color-bg-secondary)' }}
                title="Ver falhas de entrega do outbound"
              >
                {deliveryFailuresLoading ? 'Carregando falhas...' : 'Falhas de entrega'}
              </Button>
              <Button onClick={() => handleClose(selectedTicket.id)} className="support-ticket-action-btn support-button-danger" aria-label="Fechar ticket">
                Fechar ticket
              </Button>
            </>
          ) : null}
        </div>

        {!isWaitingTicket && !isInProgressTicket && Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 ? (
          <div style={{ marginBottom: '10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Histórico de handover</div>
            {selectedTicket.context.handoverHistory.slice(-5).map((item, index) => (
              <div key={`${item.timestamp}-${index}`}>
                {formatDate(item.timestamp)} • {item.mode === 'human' ? 'Humano' : 'Bot'}
                {item.actorUsername ? ` • ${item.actorUsername}` : ''}
                {item.reason ? ` • ${item.reason}` : ''}
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ marginTop: isWaitingTicket ? 0 : '8px', marginBottom: isWaitingTicket ? 0 : '12px', flex: '1 1 0%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {shouldRenderHistory ? (
            <div
              ref={messagesContainerRef}
              className="support-history-log"
              role="log"
              aria-label="Histórico de mensagens do chamado"
            >
              {timelineMessages.length === 0 ? (
                <p className="support-history-empty">Nenhuma mensagem ainda</p>
              ) : (
                timelineMessages.map((msg) => (
                  <div key={msg.key} className={`support-message ${msg.sender === 'user' ? 'is-user' : 'is-other'}`}>
                    <div className="support-message-meta">
                      {msg.sender === 'user' ? '👤 Usuário' : msg.sender === 'agent' ? '👨‍💼 Atendente' : '🤖 Sistema'} • {formatDate(msg.timestamp)}
                      {(() => {
                        const isOutbound = msg.sender === 'agent' || msg.sender === 'bot';
                        if (!isOutbound) return null;
                        const badge = getDeliveryStatusBadge(msg.deliveryStatus);
                        if (!badge) return null;
                        return (
                          <span style={{ marginLeft: '8px', color: badge.color, fontWeight: 700 }} title={badge.title} aria-label={`Status de entrega: ${badge.title}`}>
                            {badge.text}
                          </span>
                        );
                      })()}
                      <button
                        type="button"
                        className="support-reply-action"
                        title="Responder esta mensagem"
                        aria-label="Responder esta mensagem"
                      >
                        ↩
                      </button>
                    </div>
                    <div className="support-message-text">
                      {renderTimelineMessageContent(msg)}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }} />
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {showAssignForm ? (
          <div className="support-form-group">
            <label htmlFor="assign-ticket-input" className="support-form-label">Atribuir para:</label>
            <input
              id="assign-ticket-input"
              type="text"
              value={assignedTo || (agent?.username || agent?.id || '')}
              onChange={(event) => setAssignedTo(event.target.value)}
              placeholder="Nome do atendente"
              className="support-form-input"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAssign();
                }
              }}
            />
            <Button onClick={handleAssign} className="support-button-full">Atribuir ticket</Button>
          </div>
        ) : null}

        {showConversationComposer ? (
          <div className="support-form-group">
            <div className="support-message-compose">
              <textarea
                id="send-message-textarea"
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Digite / para abrir comandos e respostas rápidas."
                rows={1}
                className="support-form-textarea support-message-compose-textarea"
                aria-label="Campo para digitar mensagem"
                onKeyDown={onComposerKeyDown}
              />
              <div className="support-compose-actions">
                <button type="button" className="support-compose-action-button" title="Inserir emoji" aria-label="Inserir emoji">🙂</button>
                <button type="button" className="support-compose-action-button" title="Anexar mídia/arquivo" aria-label="Anexar mídia ou arquivo">📎</button>
                <button type="button" className="support-compose-action-button" title="Gravar áudio do microfone" aria-label="Gravar áudio do microfone">🎙️</button>
                <button type="button" className="support-compose-action-button" title="Anexar do RAG" aria-label="Anexar documento do RAG">🧠</button>
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="support-send-icon-button"
                  aria-label="Enviar"
                  title="Enviar mensagem"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.4 20.2L21.3 12 3.4 3.8l.8 6.8 9.4 1.4-9.4 1.4-.8 6.8z" />
                  </svg>
                </button>
              </div>
            </div>

            {quickReplySlashOpen ? (
              <div className="support-slash-menu" ref={slashMenuRef}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
                {slashMenuMode === 'commands' ? 'Comandos do workspace' : <>Resultados para <code>{(messageText || '').trim()}</code></>}
              </div>
              {slashMenuMode === 'commands' ? (
                slashCommandResults.map((command, index) => (
                    <div
                      key={command.id}
                      className={`support-slash-menu-item ${slashMenuCursorIndex === index ? 'is-active' : ''}`}
                      onMouseEnter={() => onHoverSlashItem(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSelectSlashItem(command);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{command.label}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>{command.description}</div>
                    </div>
                  ))
                ) : (
                  quickReplySlashResults.map((qr, index) => (
                    <div
                      key={qr.id}
                      className={`support-slash-menu-item ${slashMenuCursorIndex === index ? 'is-active' : ''}`}
                      onMouseEnter={() => onHoverSlashItem(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSelectSlashItem({ kind: 'quick_reply', reply: qr });
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{qr.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {String(qr.message || '').slice(0, 120)}{String(qr.message || '').length > 120 ? '…' : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <small style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
              Use <code>/</code> para comandos e respostas r&aacute;pidas. Pressione Ctrl+Enter (ou Cmd+Enter no Mac) para enviar.
            </small>
          </div>
        ) : null}
      </div>
    </div>
  );
}
