import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../styles/Button';
import {
  formatSupportActor,
  formatSupportEventType,
  formatSupportMode,
  formatSupportReason,
} from '../../../components/support/supportHumanization';

const EMOJI_GROUPS = {
  smileys: {
    label: '😀',
    title: 'Carinhas',
    items: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😢', '😭', '😡', '😴', '🤯', '🥳', '🙏'],
  },
  gestures: {
    label: '👍',
    title: 'Gestos',
    items: ['👍', '👎', '👏', '🙌', '🤝', '🤌', '👌', '✌️', '🤞', '👋', '🤙', '💪', '🙏', '👀', '💃', '🕺'],
  },
  hearts: {
    label: '❤️',
    title: 'Corações',
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💘', '💝', '💕', '💞', '💓', '❣️'],
  },
  objects: {
    label: '🎉',
    title: 'Objetos',
    items: ['🎉', '✨', '🔥', '⭐', '✅', '❌', '⚠️', '📌', '📎', '📷', '🎥', '🎧', '🎁', '🚀', '💡', '📣'],
  },
};

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
  handleInsertEmoji,
  handleAttachMedia,
  handleToggleAudioRecording,
  handleAttachRagDocument,
  ragPickerOpen,
  ragDocuments,
  ragDocumentsLoading,
  ragDocumentsError,
  ragSearch,
  setRagSearch,
  onSelectRagDocument,
  onRefreshRagDocuments,
  isComposerBusy,
  isRecordingAudio,
  composerFileInputRef,
  onComposerFileChange,
  handleClose,
}) {
  const slashMenuRef = useRef(null);
  const composerTextareaRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState('smileys');
  const [recentEmojis, setRecentEmojis] = useState([]);

  const activeEmojiItems = useMemo(() => {
    if (emojiCategory === 'recent') return recentEmojis;
    return EMOJI_GROUPS[emojiCategory]?.items || [];
  }, [emojiCategory, recentEmojis]);

  const insertEmojiAtCursor = (emoji) => {
    const symbol = String(emoji || '').trim();
    if (!symbol) return;

    const textarea = composerTextareaRef.current;
    if (textarea && typeof textarea.selectionStart === 'number' && typeof textarea.selectionEnd === 'number') {
      const current = String(messageText || '');
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = `${current.slice(0, start)}${symbol}${current.slice(end)}`;
      const nextCaret = start + symbol.length;
      setMessageText(next);
      requestAnimationFrame(() => {
        try {
          textarea.focus();
          textarea.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // noop
        }
      });
    } else if (typeof handleInsertEmoji === 'function') {
      handleInsertEmoji(symbol);
    } else {
      setMessageText((prev) => `${prev || ''}${symbol}`);
    }

    setRecentEmojis((prev) => {
      const next = [symbol, ...prev.filter((item) => item !== symbol)];
      return next.slice(0, 24);
    });
  };

  const handleEmojiSelect = (emoji) => {
    insertEmojiAtCursor(emoji);
    setEmojiPickerOpen(false);
  };

  const toggleEmojiPicker = () => {
    if (isComposerBusy) return;
    setEmojiPickerOpen((prev) => !prev);
  };

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

  useEffect(() => {
    if (!emojiPickerOpen) return undefined;

    const handlePointerDown = (event) => {
      const pickerEl = emojiPickerRef.current;
      const buttonEl = emojiButtonRef.current;
      const target = event.target;
      if (pickerEl && pickerEl.contains(target)) return;
      if (buttonEl && buttonEl.contains(target)) return;
      setEmojiPickerOpen(false);
    };

    const handleEsc = (event) => {
      if (event.key === 'Escape') setEmojiPickerOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [emojiPickerOpen]);

  const isWaitingTicket = selectedTicket.status === 'waiting';
  const ticketMode = String(selectedTicket.mode || '').toLowerCase();
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

        {!isWaitingTicket ? (
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
              <span>Modo: <strong>{formatSupportMode(selectedTicket.mode)}</strong></span>
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
          {!isWaitingTicket && ticketMode !== 'human' && ticketMode !== 'paused' ? (
            <Button onClick={handleTakeOver} disabled={handoverLoading} className="support-ticket-action-btn">Assumir atendimento</Button>
          ) : null}
            {!isWaitingTicket && ticketMode === 'human' ? (
            <>
              <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-ticket-action-btn">Liberar atendimento</Button>
              <Button onClick={handlePause} disabled={handoverLoading} className="support-ticket-action-btn">Pausar</Button>
            </>
          ) : null}
            {!isWaitingTicket && ticketMode === 'paused' ? (
            <>
              <Button onClick={handleResume} disabled={handoverLoading} className="support-ticket-action-btn">Retomar (humano)</Button>
              <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-ticket-action-btn">Liberar atendimento</Button>
            </>
          ) : null}
            {!isWaitingTicket ? (
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

        {!isWaitingTicket && Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 ? (
          <div style={{ marginBottom: '10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Histórico de handover</div>
            {selectedTicket.context.handoverHistory.slice(-5).map((item, index) => (
              <div key={`${item.timestamp}-${index}`}>
                {formatDate(item.timestamp)} • {formatSupportEventType(item.type || 'handover')}
                {item.mode ? ` • ${formatSupportMode(item.mode)}` : ''}
                {item.actorUsername ? ` • ${formatSupportActor(item.actorUsername)}` : ''}
                {item.reason ? ` • ${formatSupportReason(item.reason) || item.reason}` : ''}
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
                        const badge = getDeliveryStatusBadge(msg.deliveryStatus, msg);
                        if (!badge) return null;
                        const badgeAriaLabel = String(badge.title || '')
                          .replace(/\s*\n+\s*/g, '. ')
                          .trim();
                        return (
                          <span style={{ marginLeft: '8px', color: badge.color, fontWeight: 700 }} title={badge.title} aria-label={`Status de entrega: ${badgeAriaLabel}`}>
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
                    {msg.deliveryStatus === 'failed' && (() => {
                      const raw = msg.raw || {};
                      const reason = raw.reasonCode || raw.reason_code || null;
                      const err = raw.lastError || raw.last_error || null;
                      if (!reason && !err) return null;
                      const parts = [];
                      if (reason) parts.push(formatSupportReason(reason) || reason);
                      if (err && err !== reason) parts.push(String(err).slice(0, 180));
                      return (
                        <div style={{ fontSize: '11px', color: '#b91c1c', marginTop: '3px', wordBreak: 'break-word', padding: '2px 0' }}>
                          ⚠ {parts.join(' · ')}
                        </div>
                      );
                    })()}
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
                ref={composerTextareaRef}
                id="send-message-textarea"
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Digite sua mensagem..."
                rows={1}
                className="support-form-textarea support-message-compose-textarea"
                aria-label="Campo para digitar mensagem"
                onKeyDown={onComposerKeyDown}
              />
              <input
                ref={composerFileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={onComposerFileChange}
                aria-label="Selecionar arquivo para envio"
              />
              <div className="support-compose-actions">
                <button
                  ref={emojiButtonRef}
                  type="button"
                  className="support-compose-action-button"
                  title="Inserir emoji"
                  aria-label="Inserir emoji"
                  onClick={toggleEmojiPicker}
                  disabled={isComposerBusy}
                >
                  🙂
                </button>
                <button
                  type="button"
                  className="support-compose-action-button"
                  title="Anexar mídia/arquivo"
                  aria-label="Anexar mídia ou arquivo"
                  onClick={handleAttachMedia}
                  disabled={isComposerBusy}
                >
                  📎
                </button>
                <button
                  type="button"
                  className="support-compose-action-button"
                  title={isRecordingAudio ? 'Parar gravação e enviar áudio' : 'Gravar áudio do microfone'}
                  aria-label={isRecordingAudio ? 'Parar gravação e enviar áudio' : 'Gravar áudio do microfone'}
                  onClick={handleToggleAudioRecording}
                  disabled={isComposerBusy}
                >
                  {isRecordingAudio ? '⏹️' : '🎙️'}
                </button>
                <button
                  type="button"
                  className="support-compose-action-button"
                  title="Anexar do RAG"
                  aria-label="Anexar documento do RAG"
                  onClick={handleAttachRagDocument}
                  disabled={isComposerBusy}
                >
                  🧠
                </button>
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="support-send-icon-button"
                  aria-label="Enviar"
                  title="Enviar mensagem"
                  disabled={isComposerBusy}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.4 20.2L21.3 12 3.4 3.8l.8 6.8 9.4 1.4-9.4 1.4-.8 6.8z" />
                  </svg>
                </button>
              </div>
            </div>

            {emojiPickerOpen ? (
              <div className="support-emoji-picker" ref={emojiPickerRef}>
                <div className="support-emoji-picker-tabs" role="tablist" aria-label="Categorias de emoji">
                  {recentEmojis.length > 0 ? (
                    <button
                      type="button"
                      className={`support-emoji-picker-tab ${emojiCategory === 'recent' ? 'is-active' : ''}`}
                      onClick={() => setEmojiCategory('recent')}
                      role="tab"
                      aria-selected={emojiCategory === 'recent'}
                      title="Recentes"
                    >
                      🕘
                    </button>
                  ) : null}
                  {Object.entries(EMOJI_GROUPS).map(([key, group]) => (
                    <button
                      key={key}
                      type="button"
                      className={`support-emoji-picker-tab ${emojiCategory === key ? 'is-active' : ''}`}
                      onClick={() => setEmojiCategory(key)}
                      role="tab"
                      aria-selected={emojiCategory === key}
                      title={group.title}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                <div className="support-emoji-picker-grid" role="listbox" aria-label="Lista de emojis">
                  {activeEmojiItems.map((emoji) => (
                    <button
                      key={`${emojiCategory}-${emoji}`}
                      type="button"
                      className="support-emoji-item"
                      onClick={() => handleEmojiSelect(emoji)}
                      title={`Inserir ${emoji}`}
                      aria-label={`Inserir emoji ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {ragPickerOpen ? (
              <div className="support-rag-picker" role="dialog" aria-label="Selecionar documento do RAG">
                <div className="support-rag-picker-head">
                  <div className="support-rag-picker-title">Documentos do RAG</div>
                  <button
                    type="button"
                    className="support-rag-picker-refresh"
                    onClick={onRefreshRagDocuments}
                    disabled={isComposerBusy || ragDocumentsLoading}
                    title="Atualizar lista"
                    aria-label="Atualizar lista de documentos do RAG"
                  >
                    ↻
                  </button>
                </div>

                <input
                  type="text"
                  className="support-rag-picker-search"
                  placeholder="Buscar por título, ID, fonte ou categoria"
                  value={ragSearch}
                  onChange={(event) => setRagSearch(event.target.value)}
                  disabled={isComposerBusy || ragDocumentsLoading}
                  aria-label="Buscar documento do RAG"
                />

                <div className="support-rag-picker-list" role="listbox" aria-label="Lista de documentos RAG">
                  {ragDocumentsLoading ? (
                    <div className="support-rag-picker-empty">Carregando documentos...</div>
                  ) : null}

                  {!ragDocumentsLoading && ragDocumentsError ? (
                    <div className="support-rag-picker-empty">{ragDocumentsError}</div>
                  ) : null}

                  {!ragDocumentsLoading && !ragDocumentsError && (!Array.isArray(ragDocuments) || ragDocuments.length === 0) ? (
                    <div className="support-rag-picker-empty">Nenhum documento encontrado no RAG.</div>
                  ) : null}

                  {!ragDocumentsLoading && !ragDocumentsError && Array.isArray(ragDocuments)
                    ? ragDocuments.slice(0, 60).map((doc) => {
                      const title = String(doc?.title || 'Sem título');
                      const source = String(doc?.metadata?.source || 'manual');
                      const category = String(doc?.metadata?.category || 'sem categoria');
                      const docId = String(doc?.id || '');
                      return (
                        <button
                          key={docId}
                          type="button"
                          className="support-rag-picker-item"
                          onClick={() => onSelectRagDocument(doc)}
                          disabled={isComposerBusy || !docId}
                          aria-label={`Anexar documento ${title}`}
                          title={docId}
                        >
                          <div className="support-rag-picker-item-title">{title}</div>
                          <div className="support-rag-picker-item-meta">
                            <span>{source}</span>
                            <span>•</span>
                            <span>{category}</span>
                            <span>•</span>
                            <span>{docId}</span>
                          </div>
                        </button>
                      );
                    })
                    : null}
                </div>
              </div>
            ) : null}

            {quickReplySlashOpen ? (
              <div className="support-slash-menu" ref={slashMenuRef}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
                {slashMenuMode === 'commands' ? 'Comandos do atendimento' : <>Resultados para <code>{(messageText || '').trim()}</code></>}
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
