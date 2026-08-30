import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { getAgentClassification } from '../utils/classification';
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
import { SupportWorkspaceHeader, SupportFiltersBar } from '../modules/support-workspace/components';
import {
  AttendanceMetricsPanel,
  TicketSummaryCard,
  CustomerHistoryCard,
  TicketList,
  ConversationPanel,
  QuickActionsPanel,
  AttendanceTimeline,
  AIInsightsMiniCard,
  JourneyMiniCard,
} from '../components/support/attendance';
import { useAttendanceRuntimeViewModel } from '../hooks/useAttendanceRuntimeViewModel';
import { SupportDeliveryFailuresModal } from './support/SupportDeliveryFailuresModal';
import { SupportCloseTicketModal } from './support/SupportCloseTicketModal';
import { SupportNewConversationModal } from './support/SupportNewConversationModal';

function parseAiSummary(summary) {
  if (!summary) return null;
  if (typeof summary === 'string') {
    const trimmed = summary.trim();
    if (!trimmed) return null;
    try {
      return parseAiSummary(JSON.parse(trimmed));
    } catch (_) {
      return { text: trimmed };
    }
  }

  if (typeof summary !== 'object') {
    return { text: String(summary) };
  }

  const text = summary.text || summary.summary || summary.content || summary.message || '';
  return {
    text: String(text || '').trim(),
    generatedAt: summary.generatedAt || summary.generated_at || summary.createdAt,
    generatedBy: summary.generatedBy?.username || summary.generatedBy?.id || summary.generatedBy,
  };
}

function AiSummaryContent({ summary, loading }) {
  const parsed = parseAiSummary(summary);

  if (!parsed?.text) {
    return (
      <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
        {loading ? 'Preparando resumo automático para este ticket...' : 'Sem resumo disponível para este ticket.'}
      </div>
    );
  }

  const lines = parsed.text
    .split('\n')
    .map((line) => line.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean);

  return (
    <div className="support-ai-summary">
      <div className="support-ai-summary-list">
        {lines.map((line, index) => (
          <div className="support-ai-summary-item" key={`${line}-${index}`}>
            {line}
          </div>
        ))}
      </div>
      {(parsed.generatedAt || parsed.generatedBy) ? (
        <div className="support-ai-summary-meta">
          {parsed.generatedAt ? `Gerado em ${new Date(parsed.generatedAt).toLocaleString('pt-BR')}` : 'Gerado automaticamente'}
          {parsed.generatedBy ? ` • ${parsed.generatedBy}` : ''}
        </div>
      ) : null}
    </div>
  );
}

function SupportPageInner({ agent, isAuthenticated, showToast, confirm, phoneMaskingEnabled, ToastContainer, ConfirmDialog }) {
  // Ações de diagnóstico (revisão técnica da sessão, teste de fluxo) são
  // superfícies internas da plataforma: escondidas para PRODUCTION.
  const isInternalProfile = getAgentClassification(agent) !== 'PRODUCTION';
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

  const runtimeViewModel = useAttendanceRuntimeViewModel({
    state,
    ticketContext,
    evidence,
  });

  const selectedTicket = state.selectedTicket;
  const [showFilters, setShowFilters] = useState(false);
  const [ticketViewFilter, setTicketViewFilter] = useState('all');
  const [showOtherAgents, setShowOtherAgents] = useState(false);
  const [showClosedTickets, setShowClosedTickets] = useState(false);

  const getTicketPhoneNode = useCallback((ticket) => {
    const resolvedPhone = ticket?.phoneNumber
      || ticket?.phone_number
      || ticket?.phone
      || ticket?.contactPhone
      || ticket?.contact_phone
      || ticket?.contact?.phone
      || ticket?.context?.metadata?.phoneNumber
      || ticket?.context?.metadata?.phone_number
      || ticket?.context?.metadata?.phone
      || ticket?.context?.variables?.phoneNumber
      || ticket?.context?.variables?.phone_number
      || ticket?.context?.variables?.phone;
    return <MaskedPhone phone={resolvedPhone} mask={state.phoneMaskingEnabled} />;
  }, [state.phoneMaskingEnabled]);

  const filteredTicketsView = useMemo(() => {
    const view = state.ticketsView || [];
    if (ticketViewFilter === 'unread') return view.filter((t) => Number(t.unreadCount || 0) > 0);
    if (ticketViewFilter === 'waiting') return view.filter((t) => t.status === 'waiting');
    if (ticketViewFilter === 'in_progress') return view.filter((t) => t.status === 'in_progress');
    if (ticketViewFilter === 'unassigned') return view.filter((t) => !t.assignedTo);
    return view;
  }, [state.ticketsView, ticketViewFilter]);

  useEffect(() => {
    if (!showFilters) return undefined;

    function handleOutsideClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.support-filters-panel')) return;
      if (target.closest('.auto-filter-toggle-btn')) return;
      setShowFilters(false);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showFilters]);

  return (
    <CrudPageBase title="💬 Atendimento" hideHeader>
      <div className="attendance-runtime-shell" data-testid="support-page">
        <main className="attendance-runtime-main">
          <SupportWorkspaceHeader
            wsStatus={state.wsStatus}
            loadTickets={actions.loadTickets}
            loading={state.loading}
            queues={state.queues}
            setNewConversationQueue={newConversation.setNewConversationQueue}
            setShowNewConversationModal={newConversation.setShowNewConversationModal}
            showConversationToggle={Boolean(selectedTicket) && !state.isMobile}
            isConversationListVisibleDesktop={state.isConversationListVisibleDesktop}
            onToggleConversationList={() => actions.setIsConversationListVisibleDesktop((prev) => !prev)}
            showFilters={showFilters}
            onToggleFilters={() => setShowFilters((prev) => !prev)}
            onEnableNotifications={async () => {
              if (!('Notification' in window)) {
                showToast('Notificações não suportadas neste navegador', 'warning');
                return;
              }
              if (Notification.permission === 'granted') {
                showToast('Notificações já estão ativadas', 'info');
                return;
              }
              const result = await Notification.requestPermission();
              if (result === 'granted') {
                showToast('Notificações ativadas com sucesso!', 'success');
              } else {
                showToast('Permissão de notificação negada', 'warning');
              }
            }}
          />

          <div className={`attendance-runtime-board${selectedTicket && !state.isMobile && !state.isConversationListVisibleDesktop ? ' attendance-runtime-board--conversation-collapsed' : ''}`}>
            <div className="attendance-runtime-col attendance-runtime-col--metrics">
              <div
                style={showFilters ? undefined : { display: 'none' }}
                aria-hidden={showFilters ? undefined : 'true'}
              >
                <SupportFiltersBar
                  uiSearch={state.uiSearch}
                  setUiSearch={actions.setUiSearch}
                  ticketQueueOptions={state.ticketQueueOptions}
                  uiQueue={state.uiQueue}
                  setUiQueue={actions.setUiQueue}
                  onClear={actions.clearTicketFilters}
                  ticketViewFilter={ticketViewFilter}
                  setTicketViewFilter={setTicketViewFilter}
                />
              </div>
              <AttendanceMetricsPanel metrics={runtimeViewModel.metrics} />
            </div>

            <div className="attendance-runtime-col attendance-runtime-col--tickets">
              <TicketList
                loading={state.loading}
                ticketsView={filteredTicketsView}
                handleSelectTicket={actions.handleSelectTicket}
                selectedTicket={selectedTicket}
                showOtherAgents={showOtherAgents}
                setShowOtherAgents={setShowOtherAgents}
                showClosedTickets={showClosedTickets}
                setShowClosedTickets={setShowClosedTickets}
                uiSearchDebounced={state.uiSearchDebounced}
                highlightText={actions.highlightText}
                getContactName={actions.getContactName}
                getPhoneNode={getTicketPhoneNode}
                formatTicketMode={actions.formatTicketMode}
                shouldShowTicketModeBadge={actions.shouldShowTicketModeBadge}
                getStatusClass={actions.getStatusClass}
                formatTicketStatus={actions.formatTicketStatus}
                formatTime={actions.formatTime}
                formatBadgeCount={actions.formatBadgeCount}
                getTicketPreview={actions.getTicketPreview}
                getAssignedLabel={actions.getAssignedLabel}
                getQueueLabel={actions.getQueueLabel}
                getTicketDisplayId={actions.getTicketDisplayId}
              />
            </div>

            <div className="attendance-runtime-col attendance-runtime-col--workspace" data-testid="ticket-updated">
              {selectedTicket ? (
                <>
                  <div className="attendance-runtime-top-grid">
                    <TicketSummaryCard
                      ticket={runtimeViewModel.selectedTicket}
                      formatDate={actions.formatDate}
                    />
                    <CustomerHistoryCard customer={runtimeViewModel.customer} />
                    <QuickActionsPanel
                      executionMode={runtimeViewModel.execution.mode}
                      onToggleMode={() => {
                        if (String(selectedTicket?.mode || '').toLowerCase() === 'human') {
                          ticketActions.handleReturnToBot();
                        } else {
                          ticketActions.handleTakeOver();
                        }
                      }}
                      onOpenTemplate={() => showToast('Templates em preparacao', 'info')}
                      onOpenAttachments={() => showToast('Area de anexos em preparacao', 'info')}
                      onOpenHistory={() => showToast('Historico detalhado no painel inferior', 'info')}
                      onOpenSupport={() => ticketActions.openDeliveryFailures()}
                      onOpenInternalNotes={() => showToast('Notas internas em preparacao', 'info')}
                    />
                  </div>

                  <div className="attendance-runtime-insights-grid">
                    <AIInsightsMiniCard
                      ai={runtimeViewModel.ai}
                      execution={runtimeViewModel.execution}
                      onReplay={isInternalProfile ? () => showToast('Revisão de atendimento acionada', 'info') : undefined}
                      onTestFlow={isInternalProfile ? () => showToast('Teste de fluxo acionado', 'info') : undefined}
                    />
                    <JourneyMiniCard
                      journey={runtimeViewModel.journey}
                      execution={runtimeViewModel.execution}
                    />
                  </div>

                  <ConversationPanel
                    paginationLabel={runtimeViewModel.paginationLabel}
                    isMobile={state.isMobile}
                    isConversationListVisibleDesktop={state.isConversationListVisibleDesktop}
                    selectedTicket={selectedTicket}
                    setSelectedTicket={actions.setSelectedTicket}
                    setIsConversationListVisibleDesktop={actions.setIsConversationListVisibleDesktop}
                    setIsRightPanelCollapsed={actions.setIsRightPanelCollapsed}
                    handoverLoading={ticketActions.handoverLoading}
                    handleTakeOver={ticketActions.handleTakeOver}
                    handleReturnToBot={ticketActions.handleReturnToBot}
                    handlePause={ticketActions.handlePause}
                    handleResume={ticketActions.handleResume}
                    deliveryFailuresLoading={ticketActions.deliveryFailuresLoading}
                    openDeliveryFailures={ticketActions.openDeliveryFailures}
                    formatDate={actions.formatDate}
                    formatTicketStatus={actions.formatTicketStatus}
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
                    registerComposer={responseComposer.registerComposer}
                    executeSlashCommand={responseComposer.executeSlashCommand}
                    handleSendMessage={actions.handleSendMessage}
                    handleClose={responseComposer.handleClose}
                    handleAttachMedia={() => showToast('Área de anexos em preparação', 'info')}
                    handleToggleAudioRecording={() => showToast('Gravação de áudio em preparação', 'info')}
                    handleAttachRagDocument={() => showToast('Busca RAG em preparação', 'info')}
                    isComposerBusy={false}
                    isRecordingAudio={false}
                  />

                  <AttendanceTimeline
                    timeline={runtimeViewModel.timeline}
                    formatDate={actions.formatDate}
                  />
                </>
              ) : (
                <div className="support-details-empty">
                  <div className="support-details-empty-icon">💬</div>
                  <p className="support-details-empty-title">Nenhum ticket selecionado</p>
                  <p className="support-details-empty-hint">
                    {filteredTicketsView.filter((t) => t.status === 'waiting').length > 0
                      ? `${filteredTicketsView.filter((t) => t.status === 'waiting').length} ticket(s) aguardando atendimento`
                      : filteredTicketsView.length > 0
                        ? `${filteredTicketsView.length} ticket(s) em andamento`
                        : 'Nenhum ticket ativo no momento'}
                  </p>
                </div>
              )}
            </div>

            <div className="attendance-runtime-col attendance-runtime-col--actions">
              {selectedTicket ? (
                <div className="attendance-side-cards">
                  <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700 }}>Resumo IA</div>
                      {ticketContext.aiSummaryLoading && !ticketContext.aiSummary ? (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                          Gerando automaticamente...
                        </div>
                      ) : null}
                    </div>
                    <AiSummaryContent summary={ticketContext.aiSummary} loading={ticketContext.aiSummaryLoading} />
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
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Tags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                      {(selectedTicket.tags || []).length === 0 ? (
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>Sem tags</span>
                      ) : (
                        (selectedTicket.tags || []).map((t) => (
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
                        placeholder="Adicionar tag"
                        className="support-form-input"
                      />
                      <Button data-testid="ticket-tag-button" onClick={actions.handleAddTag} style={{ width: 'auto' }}>
                        Adicionar
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </main>
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
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SupportPageInner
      agent={agent}
      isAuthenticated={isAuthenticated}
      showToast={showToast}
      confirm={confirm}
      phoneMaskingEnabled={phoneMaskingEnabled}
      ToastContainer={ToastContainer}
      ConfirmDialog={ConfirmDialog}
    />
  );
}