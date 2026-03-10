import { Button } from '../../../styles/Button';

export function SupportConversationPane({
  isMobile,
  selectedTicket,
  setSelectedTicket,
  isRightPanelCollapsed,
  setIsRightPanelCollapsed,
  handleAssign,
  timelineMessages,
  messagesContainerRef,
  formatDate,
  getDeliveryStatusBadge,
  buildReplyTargetFromMessage,
  showToast,
  setReplyTarget,
  focusComposeInput,
  getReplySenderLabel,
  renderTimelineMessageContent,
  replyTarget,
  composeContainerRef,
  attachmentInputRef,
  handleAttachFiles,
  composeTextareaRef,
  messageText,
  setMessageText,
  composeSelectionRef,
  slashMode,
  quickReplySlashOpen,
  slashVisibleItems,
  closeSlashDropdown,
  setSlashMenuActiveIndex,
  slashMenuActiveIndex,
  handleSlashItemSelect,
  executeSlashCommand,
  handleSendMessage,
  handleComposePaste,
  captureComposeSelection,
  setEmojiPickerOpen,
  recordingAudio,
  stopMicrophoneRecording,
  startMicrophoneRecording,
  uploadingAttachment,
  setShowRagAttachModal,
  recordingAudioSeconds,
  emojiPickerOpen,
  emojiPickerRef,
  insertTextAtCursor,
  messageAttachments,
  setMessageAttachments,
  resolveSupportMediaUrl,
  slashQuickReplyLoading,
  slashQuickReplyPickerOpen,
  slashMenuRef,
}) {
  return (
    <div className="support-main-column">
      <div style={{ flexShrink: 0 }}>
        <h3 className="support-details-title">
          {isMobile ? (
            <button
              type="button"
              className="support-mobile-back-button"
              onClick={() => setSelectedTicket(null)}
              aria-label="Voltar para lista de chamados"
              title="Voltar"
            >
              {'<'}
            </button>
          ) : null}
          <span className="support-ticket-title-number">#{selectedTicket.id}</span>
          {isMobile ? (
            <button
              type="button"
              onClick={() => setIsRightPanelCollapsed((prev) => !prev)}
              className="support-mobile-panel-button"
              aria-label={isRightPanelCollapsed ? 'Abrir painel direito' : 'Fechar painel direito'}
              title={isRightPanelCollapsed ? 'Abrir painel direito' : 'Fechar painel direito'}
            >
              {isRightPanelCollapsed ? '☰' : '✕'}
            </button>
          ) : null}
          {selectedTicket.unreadCount > 0 ? (
            <span style={{ marginLeft: '10px', background: '#e74c3c', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'normal' }}>
              {selectedTicket.unreadCount} nova(s)
            </span>
          ) : null}
        </h3>
      </div>

      {selectedTicket.status === 'waiting' ? (
        <div className="support-ticket-actions">
          <Button onClick={handleAssign} size="sm" className="support-ticket-action-btn">
            Atribuir Chamado
          </Button>
        </div>
      ) : null}

      {selectedTicket.status === 'in_progress' ? (
        <div style={{ marginTop: '8px', marginBottom: '12px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                <div
                  key={msg.key}
                  className={`support-message ${msg.sender === 'user' ? 'is-user' : 'is-other'}`}
                >
                  <div className="support-message-meta">
                    {msg.sender === 'user' ? '👤 Usuário' : msg.sender === 'agent' ? '👨‍💼 Atendente' : '🤖 Sistema'}
                    {msg.source === 'channel' ? <span style={{ marginLeft: '6px', color: '#999' }}>(canal)</span> : null}
                    {' • '}
                    {formatDate(msg.timestamp)}
                    {(() => {
                      const idValue = msg.externalMessageId || msg.clientMessageId || null;
                      if (!idValue) return null;
                      const label = msg.externalMessageId ? 'ID' : 'client_id';
                      return (
                        <span style={{ marginLeft: '8px', color: 'var(--color-text-tertiary)' }}>
                          • {label}: {String(idValue)}
                        </span>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => {
                        const nextTarget = buildReplyTargetFromMessage(msg);
                        if (!nextTarget) {
                          showToast('Não foi possível responder esta mensagem.', 'warning');
                          return;
                        }
                        setReplyTarget(nextTarget);
                        focusComposeInput();
                      }}
                      className="support-reply-action"
                      title="Responder esta mensagem"
                      aria-label="Responder esta mensagem"
                    >
                      ↩
                    </button>
                    {(() => {
                      const isOutbound = msg.sender === 'agent' || msg.sender === 'bot';
                      if (!isOutbound) return null;
                      const badge = getDeliveryStatusBadge(msg.deliveryStatus, msg.deliveryError);
                      if (!badge) return null;
                      const tooltipId = `delivery-tooltip-${String(msg.key)}`;
                      return (
                        <span
                          className={`support-delivery-badge ${badge.showTooltip ? 'has-tooltip' : ''}`}
                          style={{ marginLeft: '8px', color: badge.color, fontWeight: 700 }}
                          title={badge.showTooltip ? undefined : badge.title}
                          tabIndex={badge.showTooltip ? 0 : undefined}
                          aria-describedby={badge.showTooltip ? tooltipId : undefined}
                          aria-label={`Status de entrega: ${badge.title}`}
                        >
                          {badge.text}
                          {badge.showTooltip ? <span id={tooltipId} role="tooltip" className="support-delivery-tooltip">{badge.title}</span> : null}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="support-message-text">
                    {msg?.replyTo ? (
                      <div style={{ borderLeft: '3px solid rgba(37, 99, 235, 0.45)', paddingLeft: '8px', marginBottom: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        <div style={{ fontWeight: 600 }}>{getReplySenderLabel(msg.replyTo.sender)}</div>
                        <div>{String(msg.replyTo.text || '[sem texto]').slice(0, 140)}</div>
                      </div>
                    ) : null}
                    {renderTimelineMessageContent(msg)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {selectedTicket.status === 'in_progress' ? (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div className="support-form-group">
            <div className="support-message-compose" ref={composeContainerRef}>
              {replyTarget ? (
                <div style={{ borderLeft: '3px solid rgba(37, 99, 235, 0.55)', background: 'var(--color-bg-elevated)', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      Respondendo {getReplySenderLabel(replyTarget.sender)}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {String(replyTarget.text || '[sem texto]').slice(0, 180)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-link p-0"
                    style={{ textDecoration: 'none', fontSize: '12px' }}
                    onClick={() => setReplyTarget(null)}
                    aria-label="Cancelar resposta"
                    title="Cancelar resposta"
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              <input
                ref={attachmentInputRef}
                type="file"
                style={{ display: 'none' }}
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) handleAttachFiles(files);
                  e.target.value = '';
                }}
              />
              <textarea
                ref={composeTextareaRef}
                id="send-message-textarea"
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  composeSelectionRef.current = {
                    start: e.target.selectionStart || 0,
                    end: e.target.selectionEnd || 0,
                  };
                }}
                placeholder="Digite / para abrir comandos e respostas rápidas."
                rows={1}
                className="support-form-textarea support-message-compose-textarea"
                aria-label="Campo para digitar mensagem"
                onSelect={(e) => {
                  composeSelectionRef.current = {
                    start: e.target.selectionStart || 0,
                    end: e.target.selectionEnd || 0,
                  };
                }}
                onClick={(e) => {
                  composeSelectionRef.current = {
                    start: e.target.selectionStart || 0,
                    end: e.target.selectionEnd || 0,
                  };
                }}
                onKeyUp={(e) => {
                  composeSelectionRef.current = {
                    start: e.target.selectionStart || 0,
                    end: e.target.selectionEnd || 0,
                  };
                }}
                onKeyDown={(e) => {
                  if (slashMode && quickReplySlashOpen && slashVisibleItems.length > 0) {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closeSlashDropdown();
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSlashMenuActiveIndex((prev) => (prev + 1) % slashVisibleItems.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSlashMenuActiveIndex((prev) => (prev - 1 + slashVisibleItems.length) % slashVisibleItems.length);
                      return;
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (slashMode && slashVisibleItems.length > 0) {
                      const typedSlash = String(messageText || '').trim().toLowerCase();
                      const exactCommand = slashVisibleItems.find((item) => item?.kind === 'command' && String(item.title || '').trim().toLowerCase() === typedSlash);
                      const activeItem = slashVisibleItems[slashMenuActiveIndex] || null;
                      handleSlashItemSelect(exactCommand || activeItem || slashVisibleItems[0]);
                      return;
                    }
                    if (slashMode) {
                      const typedSlash = String(messageText || '').trim().toLowerCase();
                      if (executeSlashCommand(typedSlash)) {
                        setMessageText('');
                        closeSlashDropdown();
                        return;
                      }
                    }
                    handleSendMessage();
                  }
                }}
                onPaste={handleComposePaste}
              />
              {!slashMode ? (
                <div className="support-compose-actions">
                  <button type="button" className="support-compose-action-button" onMouseDown={captureComposeSelection} onClick={() => setEmojiPickerOpen((prev) => !prev)} title="Inserir emoji" aria-label="Inserir emoji">🙂</button>
                  <button type="button" className="support-compose-action-button" onClick={() => attachmentInputRef.current?.click()} title="Anexar mídia/arquivo" aria-label="Anexar mídia ou arquivo" disabled={uploadingAttachment || recordingAudio}>📎</button>
                  <button type="button" className="support-compose-action-button" onClick={() => (recordingAudio ? stopMicrophoneRecording() : startMicrophoneRecording())} title={recordingAudio ? 'Parar gravação de áudio' : 'Gravar áudio do microfone'} aria-label={recordingAudio ? 'Parar gravação de áudio' : 'Gravar áudio do microfone'} disabled={uploadingAttachment} style={recordingAudio ? { color: 'var(--color-status-error)' } : undefined}>{recordingAudio ? '⏹️' : '🎙️'}</button>
                  <button type="button" className="support-compose-action-button" onClick={() => setShowRagAttachModal(true)} title="Anexar do RAG" aria-label="Anexar documento do RAG" disabled={recordingAudio}>🧠</button>
                  <Button onClick={handleSendMessage} className="support-send-icon-button" aria-label="Enviar mensagem" title="Enviar mensagem" disabled={recordingAudio}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.2L21.3 12 3.4 3.8l.8 6.8 9.4 1.4-9.4 1.4-.8 6.8z" /></svg>
                  </Button>
                </div>
              ) : null}
            </div>
            {recordingAudio ? (
              <div className="text-xs" style={{ color: 'var(--color-status-error)', marginTop: '6px' }}>
                Gravando áudio... {String(Math.floor(recordingAudioSeconds / 60)).padStart(2, '0')}:{String(recordingAudioSeconds % 60).padStart(2, '0')}
              </div>
            ) : null}
            {emojiPickerOpen && !slashMode ? (
              <div className="support-emoji-picker" role="listbox" aria-label="Seletor de emojis" ref={emojiPickerRef}>
                {['😀', '😁', '😂', '😊', '😉', '😍', '😎', '🤝', '🙏', '👍', '👏', '🎉', '❤️', '✅'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="support-emoji-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      insertTextAtCursor(emoji);
                      setEmojiPickerOpen(false);
                    }}
                    onClick={() => {
                      insertTextAtCursor(emoji);
                      setEmojiPickerOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            {messageAttachments.length > 0 ? (
              <div className="support-attachment-preview">
                <div className="support-attachment-preview-head">
                  <div className="support-attachment-preview-title">Pré-visualização dos anexos ({messageAttachments.length})</div>
                  <button type="button" className="support-attachment-remove-button" onClick={() => setMessageAttachments([])} aria-label="Remover todos os anexos" title="Remover todos os anexos">✕</button>
                </div>
                {messageAttachments.map((attachment) => (
                  <div key={attachment.id} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '8px', marginTop: '8px' }}>
                    <div className="support-attachment-preview-head">
                      <div style={{ fontWeight: 600 }}>{attachment.fileName}</div>
                      <button type="button" className="support-attachment-remove-button" onClick={() => setMessageAttachments((prev) => prev.filter((a) => a.id !== attachment.id))} aria-label={`Remover ${attachment.fileName || 'anexo'}`} title="Remover anexo">✕</button>
                    </div>
                    <div className="support-attachment-preview-body">
                      {attachment.mediaType === 'image' ? <img src={resolveSupportMediaUrl(attachment.mediaUrl)} alt={attachment.fileName || 'imagem'} className="support-attachment-preview-media" /> : null}
                      {attachment.mediaType === 'video' ? <video controls src={resolveSupportMediaUrl(attachment.mediaUrl)} className="support-attachment-preview-media" /> : null}
                      {attachment.mediaType === 'audio' ? <audio controls src={resolveSupportMediaUrl(attachment.mediaUrl)} className="support-attachment-preview-audio" /> : null}
                      {attachment.mediaType === 'document' ? <div className="support-attachment-preview-document">📄 Documento anexado</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {slashMode && quickReplySlashOpen ? (
              <div className="support-slash-menu" ref={slashMenuRef}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
                  Menu de comandos para <code>{(messageText || '').trim()}</code>
                </div>
                {slashVisibleItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`support-slash-menu-item ${index === slashMenuActiveIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => setSlashMenuActiveIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSlashItemSelect(item);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>{item.description}</div>
                  </div>
                ))}
                {slashVisibleItems.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '6px 8px' }}>
                    {slashQuickReplyLoading && slashQuickReplyPickerOpen ? 'Carregando respostas rápidas...' : `Nenhum item para "${String(messageText || '').trim()}"`}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
