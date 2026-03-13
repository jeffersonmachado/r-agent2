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
  quickReplyCategoryItems,
  quickReplySuggestions,
  insertQuickReply,
  messageText,
  setMessageText,
  quickReplySlashOpen,
  quickReplySlashResults,
  handleSendMessage,
  handleClose,
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
          Ticket #{selectedTicket.id.slice(0, 12)}
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
            <span style={{ marginLeft: '10px', background: '#e74c3c', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'normal' }}>
              {selectedTicket.unreadCount} nova(s)
            </span>
          ) : null}
        </h3>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {(selectedTicket.mode || 'bot') === 'bot' ? (
          <Button onClick={handleTakeOver} disabled={handoverLoading} className="support-button-full">Assumir atendimento</Button>
        ) : null}
        {(selectedTicket.mode || 'bot') === 'human' ? (
          <>
            <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-button-full">Devolver ao bot</Button>
            <Button onClick={handlePause} disabled={handoverLoading} className="support-button-full">Pausar</Button>
          </>
        ) : null}
        {(selectedTicket.mode || 'bot') === 'paused' ? (
          <>
            <Button onClick={handleResume} disabled={handoverLoading} className="support-button-full">Retomar (humano)</Button>
            <Button onClick={handleReturnToBot} disabled={handoverLoading} className="support-button-full">Devolver ao bot</Button>
          </>
        ) : null}
        <Button
          onClick={openDeliveryFailures}
          disabled={deliveryFailuresLoading}
          className="support-button-full"
          style={{ background: 'var(--color-bg-secondary)' }}
          title="Ver falhas de entrega do outbound"
        >
          {deliveryFailuresLoading ? 'Carregando falhas...' : 'Falhas de entrega'}
        </Button>
      </div>

      {Array.isArray(selectedTicket?.context?.handoverHistory) && selectedTicket.context.handoverHistory.length > 0 ? (
        <div style={{ marginBottom: '10px', fontSize: '12px', color: '#555' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Historico de handover</div>
          {selectedTicket.context.handoverHistory.slice(-5).map((item, index) => (
            <div key={`${item.timestamp}-${index}`}>
              {formatDate(item.timestamp)} • {item.mode === 'human' ? 'Humano' : 'Bot'}
              {item.actorUsername ? ` • ${item.actorUsername}` : ''}
              {item.reason ? ` • ${item.reason}` : ''}
            </div>
          ))}
        </div>
      ) : null}

      {selectedTicket.status === 'in_progress' ? (
        <div style={{ marginTop: '20px', marginBottom: '20px', borderTop: '1px solid #ddd', paddingTop: '20px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h4 style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>Historico de Mensagens</h4>
          <div
            ref={messagesContainerRef}
            style={{ flex: 1, overflowY: 'auto', border: '1px solid #ddd', borderRadius: '8px', padding: '10px', backgroundColor: '#f9f9f9', minHeight: 0 }}
            role="log"
            aria-label="Historico de mensagens do ticket"
          >
            {timelineMessages.length === 0 ? (
              <p style={{ color: '#999', fontSize: '12px', textAlign: 'center' }}>Nenhuma mensagem ainda</p>
            ) : (
              timelineMessages.map((msg) => (
                <div
                  key={msg.key}
                  style={{
                    marginBottom: '12px',
                    padding: '8px',
                    borderRadius: '8px',
                    backgroundColor: msg.sender === 'user' ? '#dcf8c6' : '#ffffff',
                    border: msg.sender === 'user' ? 'none' : '1px solid #ddd',
                    textAlign: msg.sender === 'user' ? 'right' : 'left',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                    {msg.sender === 'user' ? '👤 Usuario' : msg.sender === 'agent' ? '👨‍💼 Atendente' : '🤖 Sistema'}
                    {msg.source === 'channel' ? <span style={{ marginLeft: '6px', color: '#999' }}>(canal)</span> : null}
                    {' • '}
                    {formatDate(msg.timestamp)}
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
                  </div>
                  <div style={{ fontSize: '14px', wordBreak: 'break-word' }}>
                    {renderTimelineMessageContent(msg)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {selectedTicket.status === 'waiting' ? (
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
            <Button onClick={handleAssign} className="support-button-full">Atribuir Ticket</Button>
          </div>
        ) : null}

        {selectedTicket.status === 'in_progress' ? (
          <div className="support-form-group">
            <label htmlFor="send-message-textarea" className="support-form-label">Enviar mensagem:</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Quick Replies</div>
              <select
                value={quickReplySelectedCategory}
                onChange={(event) => setQuickReplySelectedCategory(event.target.value)}
                className="support-form-select"
                style={{ maxWidth: '280px' }}
                aria-label="Filtrar quick replies por categoria"
              >
                <option value="">Todas as categorias</option>
                {quickReplyCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            {quickReplyCategoryItems.length > 0 ? (
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>Atalhos por categoria</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {quickReplyCategoryItems.map((qr) => (
                    <button
                      key={qr.id}
                      type="button"
                      onClick={() => insertQuickReply(qr)}
                      style={{ padding: '6px 10px', borderRadius: '999px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: '12px' }}
                      title={qr.message}
                    >
                      {qr.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {quickReplySuggestions.length > 0 ? (
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>Sugestoes (Respostas Rapidas)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {quickReplySuggestions.map((qr) => (
                    <button
                      key={qr.id}
                      type="button"
                      onClick={() => insertQuickReply(qr)}
                      style={{ padding: '6px 10px', borderRadius: '999px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: '12px' }}
                      title={qr.message}
                    >
                      {qr.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <textarea
              id="send-message-textarea"
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder="Digite sua mensagem..."
              rows={4}
              className="support-form-textarea"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            {quickReplySlashOpen && quickReplySlashResults.length > 0 ? (
              <div style={{ marginTop: '8px', border: '1px solid var(--color-border-default)', borderRadius: '10px', background: 'var(--color-bg-elevated)', padding: '8px', maxHeight: '220px', overflow: 'auto' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
                  Resultados para <code>{(messageText || '').trim()}</code>
                </div>
                {quickReplySlashResults.map((qr) => (
                  <div
                    key={qr.id}
                    style={{ padding: '8px', borderRadius: '8px', cursor: 'pointer' }}
                    onClick={() => insertQuickReply(qr)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') insertQuickReply(qr);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{qr.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                      {String(qr.message || '').slice(0, 120)}{String(qr.message || '').length > 120 ? '…' : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <Button onClick={handleSendMessage} className="support-button-full">Enviar Mensagem</Button>
            <small style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
              Pressione Ctrl+Enter (ou Cmd+Enter no Mac) para enviar
            </small>
          </div>
        ) : null}

        <Button onClick={() => handleClose(selectedTicket.id)} className="support-button-danger" aria-label="Fechar ticket">
          Fechar Ticket
        </Button>
      </div>
    </div>
  );
}
