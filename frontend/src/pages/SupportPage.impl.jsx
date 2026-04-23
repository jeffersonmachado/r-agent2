import React, { useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { usePhoneMasking } from '../hooks/usePhoneMasking';
import { useSupportPageController } from '../hooks/useSupportPageController';
import { MaskedPhone } from '../components/MaskedPhone';
import { CrudPageBase } from '../modules/crud-base';
import { SupportResolvedEntityCard } from '../components/support/SupportResolvedEntityCard';
import { SupportEvidenceCard } from '../components/support/SupportEvidenceCard';
import { SupportHistoryCard } from '../components/support/SupportHistoryCard';
import { SupportSuggestedReplyCard } from '../components/support/SupportSuggestedReplyCard';
import {
  SupportWorkspaceHeader,
  SupportFiltersBar,
  SupportTicketList,
  SupportConversationPane,
  SupportDetailsSidebar,
} from '../modules/support-workspace/components';
import { SupportDeliveryFailuresModal } from './support/SupportDeliveryFailuresModal';
import { SupportCloseTicketModal } from './support/SupportCloseTicketModal';
import { SupportNewConversationModal } from './support/SupportNewConversationModal';

/**
 * Pagina de atendimento para gerenciar tickets.
 * Mostra apenas tickets do usuario logado ou sem atribuicao.
 * Estilo inspirado no WhatsApp.
 */
export function SupportPage() {
  const { agent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { enabled: phoneMaskingEnabled } = usePhoneMasking();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return (
      <CrudPageBase title="💬 Atendimento" hideHeader>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const controller = useSupportPageController({
    agent,
    isAuthenticated,
    showToast,
    confirm,
    phoneMaskingEnabled,
  });

  const {
    state,
    ticketContext,
    evidence,
    actions,
    ticketActions,
    responseComposer,
    newConversation,
    closeFlow,
    deliveryModal,
  } = controller;

  return (
    <CrudPageBase title="💬 Atendimento" hideHeader>
      <SupportWorkspaceHeader
        wsStatus={state.wsStatus}
        loadTickets={actions.loadTickets}
        loading={state.loading}
        queues={state.queues}
        setNewConversationQueue={newConversation.setNewConversationQueue}
        setShowNewConversationModal={newConversation.setShowNewConversationModal}
      />

      <div className={`support-grid${state.isMobile ? ' is-mobile' : ''}${state.isMobile && !state.isRightPanelCollapsed ? ' right-open' : ''}`}>
        <div className="support-left-column">
          <SupportFiltersBar
            uiSearch={state.uiSearch}
            setUiSearch={actions.setUiSearch}
            ticketQueueOptions={state.ticketQueueOptions}
            uiQueue={state.uiQueue}
            setUiQueue={actions.setUiQueue}
            onClear={actions.clearTicketFilters}
          />
          <SupportTicketList
            isMobile={state.isMobile}
            loading={state.loading}
            ticketsView={state.ticketsView}
            handleSelectTicket={actions.handleSelectTicket}
            selectedTicket={state.selectedTicket}
            uiSearchDebounced={state.uiSearchDebounced}
            highlightText={actions.highlightText}
            getContactName={actions.getContactName}
            getPhoneNode={(ticket) => {
              const resolvedPhone = ticket?.phoneNumber
                || ticket?.phone
                || ticket?.contactPhone
                || ticket?.context?.metadata?.phoneNumber
                || ticket?.context?.metadata?.phone
                || ticket?.context?.variables?.phoneNumber
                || ticket?.context?.variables?.phone;
              return <MaskedPhone phone={resolvedPhone} mask={state.phoneMaskingEnabled} />;
            }}
            formatTicketMode={actions.formatTicketMode}
            getStatusClass={actions.getStatusClass}
            formatTicketStatus={actions.formatTicketStatus}
            formatTime={actions.formatTime}
            formatBadgeCount={actions.formatBadgeCount}
            getTicketPreview={actions.getTicketPreview}
            getAssignedLabel={actions.getAssignedLabel}
            getQueueLabel={actions.getQueueLabel}
            supportGridColumns={actions.supportGridColumns}
          />
        </div>

        <div className="support-details-panel">
          {state.selectedTicket ? (
            <>
              <div style={{ display: 'flex', gap: '14px', minHeight: 0 }}>
                <SupportConversationPane
                  isMobile={state.isMobile}
                  selectedTicket={state.selectedTicket}
                  setSelectedTicket={actions.setSelectedTicket}
                  setIsRightPanelCollapsed={actions.setIsRightPanelCollapsed}
                  handoverLoading={ticketActions.handoverLoading}
                  handleTakeOver={ticketActions.handleTakeOver}
                  handleReturnToBot={ticketActions.handleReturnToBot}
                  handlePause={ticketActions.handlePause}
                  handleResume={ticketActions.handleResume}
                  deliveryFailuresLoading={ticketActions.deliveryFailuresLoading}
                  openDeliveryFailures={ticketActions.openDeliveryFailures}
                  formatDate={actions.formatDate}
                  messagesContainerRef={ticketContext.messagesContainerRef}
                  timelineMessages={ticketContext.timelineMessages}
                  renderTimelineMessageContent={actions.renderTimelineMessageContent}
                  getDeliveryStatusBadge={actions.getDeliveryStatusBadge}
                  assignedTo={state.assignedTo}
                  setAssignedTo={actions.setAssignedTo}
                  agent={state.agent}
                  handleAssign={ticketActions.handleAssign}
                  quickReplySelectedCategory={responseComposer.quickReplySelectedCategory}
                  setQuickReplySelectedCategory={responseComposer.setQuickReplySelectedCategory}
                  quickReplyCategories={responseComposer.quickReplyCategories}
                  quickReplyCategoryItems={responseComposer.quickReplyCategoryItems}
                  quickReplySuggestions={responseComposer.quickReplySuggestions}
                  insertQuickReply={responseComposer.insertQuickReply}
                  messageText={state.messageText}
                  setMessageText={actions.setMessageText}
                  quickReplySlashOpen={responseComposer.quickReplySlashOpen}
                  quickReplySlashResults={responseComposer.quickReplySlashResults}
                  slashMenuMode={responseComposer.slashMenuMode}
                  slashCommandResults={responseComposer.slashCommandResults}
                  slashMenuCursorIndex={responseComposer.slashMenuCursorIndex}
                  onSelectSlashItem={responseComposer.onSelectSlashItem}
                  onHoverSlashItem={responseComposer.onHoverSlashItem}
                  onComposerKeyDown={responseComposer.onComposerKeyDown}
                  handleSendMessage={actions.handleSendMessage}
                  handleClose={responseComposer.handleClose}
                />

                <SupportDetailsSidebar
                  isMobile={state.isMobile}
                  isRightPanelCollapsed={state.isRightPanelCollapsed}
                  setIsRightPanelCollapsed={actions.setIsRightPanelCollapsed}
                >
                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ fontWeight: 700 }}>Contato</div>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        border: '1px solid #ddd',
                        background: actions.getModeLabel(state.selectedTicket.mode).bg,
                        color: actions.getModeLabel(state.selectedTicket.mode).fg,
                      }}>
                        {actions.getModeLabel(state.selectedTicket.mode).label}
                      </span>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      <div>📞 <strong><MaskedPhone phone={state.selectedTicket.phoneNumber} mask={state.phoneMaskingEnabled} /></strong></div>
                      <div>Fila: <strong>{state.selectedTicket.queue}</strong></div>
                      <div>Status: <strong>{state.selectedTicket.status}</strong></div>
                      {state.selectedTicket.pauseReason ? (
                        <div>Motivo: <strong>{state.selectedTicket.pauseReason}</strong></div>
                      ) : null}
                      {state.selectedTicket?.context?.closeReasonName ? (
                        <div>Motivo de fechamento: <strong>{state.selectedTicket.context.closeReasonName}</strong></div>
                      ) : null}
                      {state.selectedTicket.channelType ? <div>Canal: <strong>{state.selectedTicket.channelType}</strong></div> : null}
                      {state.selectedTicket.conversationId ? <div>ID da conversa: <code>{state.selectedTicket.conversationId}</code></div> : null}
                      <div>Criado: {actions.formatDate(state.selectedTicket.createdAt)}</div>
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700 }}>Resumo IA</div>
                      {ticketContext.aiSummaryLoading ? (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                          Gerando automaticamente...
                        </div>
                      ) : null}
                    </div>
                    {ticketContext.aiSummary ? (
                      typeof ticketContext.aiSummary === 'string' ? (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                          {ticketContext.aiSummary}
                        </div>
                      ) : (
                        <pre style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(ticketContext.aiSummary, null, 2)}
                        </pre>
                      )
                    ) : (
                      <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
                        {ticketContext.aiSummaryLoading ? 'Preparando resumo automatico para este ticket...' : 'Sem resumo disponivel para este ticket.'}
                      </div>
                    )}
                  </div>

                  <SupportResolvedEntityCard
                    identity={evidence.evidenceHistory.identity}
                    loading={evidence.evidenceLoading}
                  />

                  <SupportEvidenceCard
                    evidenceResult={evidence.evidenceHistory.evidence}
                    loading={evidence.evidenceLoading}
                    formatDate={actions.formatDate}
                    onOpenSource={evidence.handleOpenEvidenceSource}
                    onCopyEvidence={evidence.handleCopyEvidence}
                    onUseAsReply={evidence.handleUseEvidenceAsReply}
                  />

                  <SupportHistoryCard
                    timeline={evidence.evidenceHistory.timeline}
                    loading={evidence.evidenceLoading}
                    formatDate={actions.formatDate}
                    onOpenItem={evidence.handleOpenTimelineItem}
                  />

                  <SupportSuggestedReplyCard suggestedReply={evidence.suggestedReply} />

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Entidades</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {(ticketContext.extractedEntities.emails.length === 0
                        && ticketContext.extractedEntities.cpfs.length === 0
                        && ticketContext.extractedEntities.cnpjs.length === 0
                        && ticketContext.extractedEntities.phones.length === 0
                        && ticketContext.extractedEntities.urls.length === 0) ? (
                          <div style={{ color: 'var(--color-text-tertiary)' }}>Nada detectado automaticamente.</div>
                        ) : (
                          <>
                            {ticketContext.extractedEntities.emails.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>E-mails</div>
                                {ticketContext.extractedEntities.emails.map((e) => <div key={e}><code>{e}</code></div>)}
                              </div>
                            ) : null}
                            {ticketContext.extractedEntities.phones.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>Telefones</div>
                                {ticketContext.extractedEntities.phones.map((p) => <div key={p}><code>{p}</code></div>)}
                              </div>
                            ) : null}
                            {ticketContext.extractedEntities.cpfs.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>CPF</div>
                                {ticketContext.extractedEntities.cpfs.map((c) => <div key={c}><code>{c}</code></div>)}
                              </div>
                            ) : null}
                            {ticketContext.extractedEntities.cnpjs.length > 0 ? (
                              <div style={{ marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>CNPJ</div>
                                {ticketContext.extractedEntities.cnpjs.map((c) => <div key={c}><code>{c}</code></div>)}
                              </div>
                            ) : null}
                            {ticketContext.extractedEntities.urls.length > 0 ? (
                              <div style={{ marginBottom: '0px' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>URLs</div>
                                {ticketContext.extractedEntities.urls.map((u) => (
                                  <div key={u}>
                                    <a href={u} target="_blank" rel="noreferrer">{u}</a>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Tags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                      {(state.selectedTicket.tags || []).length === 0 ? (
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>Sem tags</span>
                      ) : (
                        (state.selectedTicket.tags || []).map((t) => (
                          <span
                            key={t}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 10px',
                              borderRadius: '999px',
                              border: '1px solid var(--color-border-default)',
                              background: 'var(--color-bg-secondary)',
                              fontSize: '12px',
                            }}
                          >
                            {t}
                            <button
                              type="button"
                              onClick={() => actions.handleRemoveTag(t)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                color: 'var(--color-text-tertiary)',
                              }}
                              aria-label={`Remover tag ${t}`}
                              title="Remover"
                            >
                              ✕
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={state.tagInput}
                        onChange={(e) => actions.setTagInput(e.target.value)}
                        placeholder="Adicionar tag (ex: cobranca)"
                        className="support-form-input"
                        list="support-known-tags"
                      />
                      <Button onClick={actions.handleAddTag} style={{ width: 'auto' }}>
                        Adicionar
                      </Button>
                    </div>
                  </div>

                  {Array.isArray(state.selectedTicket?.context?.handoverHistory) && state.selectedTicket.context.handoverHistory.length > 0 ? (
                    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                      <div style={{ fontWeight: 700, marginBottom: '8px' }}>Handover & atribuicoes</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {state.selectedTicket.context.handoverHistory.slice(-8).reverse().map((h, idx) => (
                          <div key={`${h.timestamp}-${idx}`} style={{ marginBottom: '6px' }}>
                            <div style={{ color: 'var(--color-text-tertiary)' }}>{actions.formatDate(h.timestamp)}</div>
                            <div>
                              <strong>{h.type}</strong> • {h.mode}
                              {h.actorUsername ? ` • ${h.actorUsername}` : ''}
                              {h.reason ? ` • ${h.reason}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ minHeight: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700 }}>Eventos do ticket</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {Array.isArray(ticketContext.ticketEvents) ? `${ticketContext.ticketEvents.length} item(ns)` : '0 item(ns)'}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'auto', maxHeight: '220px' }}>
                      {Array.isArray(ticketContext.ticketEvents) && ticketContext.ticketEvents.length > 0 ? (
                        ticketContext.ticketEvents.slice(0, 20).map((ev) => (
                          <div key={ev.id} style={{ padding: '8px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                              <div style={{ fontWeight: 600 }}>{ev.type}</div>
                              <div style={{ color: 'var(--color-text-tertiary)' }}>{actions.formatDate(ev.createdAt)}</div>
                            </div>
                            {ev?.payload ? (
                              <div style={{ marginTop: '4px', color: 'var(--color-text-tertiary)' }}>
                                {typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)}
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div style={{ color: 'var(--color-text-tertiary)' }}>
                          Sem eventos registrados para este ticket.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ minHeight: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ fontWeight: 700 }}>Auditoria</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        {ticketContext.ticketAuditLoading ? 'Carregando...' : `${ticketContext.ticketAuditLogs.length} item(ns)`}
                      </div>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'auto', maxHeight: '220px' }}>
                      {ticketContext.ticketAuditLoading ? (
                        <div>Carregando...</div>
                      ) : (ticketContext.ticketAuditLogs.length === 0 ? (
                        <div style={{ color: 'var(--color-text-tertiary)' }}>Sem logs de auditoria para este ticket.</div>
                      ) : (
                        ticketContext.ticketAuditLogs.map((l, idx) => (
                          <div key={`${l.timestamp || l.createdAt || idx}`} style={{ padding: '8px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                              <div style={{ fontWeight: 600 }}>{l.action || 'action'}</div>
                              <div style={{ color: 'var(--color-text-tertiary)' }}>{actions.formatDate(l.timestamp || l.createdAt)}</div>
                            </div>
                            <div style={{ marginTop: '4px' }}>
                              {l.username ? <span><strong>{l.username}</strong></span> : <span><strong>sistema</strong></span>}
                              {l.details ? <span style={{ color: 'var(--color-text-tertiary)' }}> • {typeof l.details === 'string' ? l.details : JSON.stringify(l.details)}</span> : null}
                            </div>
                          </div>
                        ))
                      ))}
                    </div>
                  </div>
                </SupportDetailsSidebar>
              </div>
            </>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um ticket para ver detalhes e acoes</p>
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
      <ConfirmDialog />

      <SupportDeliveryFailuresModal
        isOpen={ticketActions.showDeliveryFailuresModal}
        loading={ticketActions.deliveryFailuresLoading}
        deliveryFailures={ticketActions.deliveryFailures}
        selectedTicket={state.selectedTicket}
        showToast={deliveryModal.showToast}
        showToastRef={deliveryModal.showToastRef}
        onClose={() => ticketActions.setShowDeliveryFailuresModal(false)}
      />

      <SupportCloseTicketModal
        isOpen={closeFlow.showCloseModal}
        closing={closeFlow.closing}
        closeReasons={closeFlow.closeReasons}
        selectedCloseReasonId={closeFlow.selectedCloseReasonId}
        setSelectedCloseReasonId={closeFlow.setSelectedCloseReasonId}
        selectedCloseReasonName={closeFlow.selectedCloseReasonName}
        setSelectedCloseReasonName={closeFlow.setSelectedCloseReasonName}
        closeTagsInput={closeFlow.closeTagsInput}
        setCloseTagsInput={closeFlow.setCloseTagsInput}
        onConfirmClose={closeFlow.handleConfirmClose}
        onClose={closeFlow.closeCloseModal}
      />

      <SupportNewConversationModal
        isOpen={newConversation.showNewConversationModal}
        newConversationPhone={newConversation.newConversationPhone}
        setNewConversationPhone={newConversation.setNewConversationPhone}
        newConversationMessage={newConversation.newConversationMessage}
        setNewConversationMessage={newConversation.setNewConversationMessage}
        newConversationQueue={newConversation.newConversationQueue}
        setNewConversationQueue={newConversation.setNewConversationQueue}
        queues={state.queues}
        showToast={showToast}
        onClose={newConversation.closeNewConversationModal}
        onTicketCreated={newConversation.handleTicketCreated}
      />
    </CrudPageBase>
  );
}
