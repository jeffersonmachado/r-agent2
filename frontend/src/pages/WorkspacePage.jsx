import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createPaymentEvent,
  createResourceBooking,
  createWorkspaceAction,
  createWorkspaceEntity,
  createWorkspaceTask,
  executeWorkspaceAutoActions,
  getWorkspaceActions,
  getWorkspaceIncidentRuns,
  getWorkspaceInsights,
  getWorkspaceTimeline,
  listWorkspaceEntities,
} from '../api/workspace';
import { WorkspaceLayout } from '../modules/workspace/WorkspaceLayout';
import {
  PaymentActionModal,
  ScheduleActionModal,
  TaskActionModal,
} from '../modules/workspace/WorkspaceActionModals';
import { getWorkspaceTabEventType } from '../modules/workspace/workspaceDevSurface';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { getAgentClassification } from '../utils/classification';

function isFailureEvent(event = {}) {
  return /falha|erro|failed|failure|error|regression|bug/i.test(`${event.summary || ''} ${JSON.stringify(event.payload || {})}`);
}

function computeHealthSummary({ entity = {}, timeline = {}, insights = {}, actions = {}, incidents = {} }) {
  const items = timeline.items || [];
  const allInsights = [...(insights.items || []), ...(insights.persisted || [])];
  const actionItems = actions.items || [];
  const autoRuns = incidents.items || [];
  const now = Date.now();
  const latestEvent = items[0] || null;
  const openTickets = items.filter((item) => item.type === 'ticket' && /open|waiting|assigned|in_progress|paused/i.test(String(item.payload?.status || ''))).length;
  const delayed = allInsights.filter((item) => item.type === 'delay' || /sla/i.test(item.description || '')).length;
  const qaFailures = items.filter((item) => item.type === 'evidence' && isFailureEvent(item)).length + autoRuns.length;
  const pendingPayments = items.filter((item) => item.type === 'payment' && /pending|overdue|open/i.test(String(item.payload?.status || ''))).length;
  const recentMessages = items.filter((item) => item.type === 'message' && ((now - new Date(item.createdAt).getTime()) / 864e5) <= 14).length;
  const inactivityDays = latestEvent ? Math.max(0, (now - new Date(latestEvent.createdAt).getTime()) / 864e5) : 60;
  const pendingActions = actionItems.filter((item) => item.status === 'pending').length;

  let score = 100;
  score -= openTickets * 8;
  score -= delayed * 10;
  score -= qaFailures * 18;
  score -= pendingPayments * 12;
  score -= inactivityDays > 30 ? 18 : inactivityDays > 14 ? 9 : 0;
  score += recentMessages >= 3 ? 6 : recentMessages > 0 ? 2 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const healthLabel = score >= 75 ? 'Saudável' : score >= 45 ? 'Atenção' : 'Crítico';
  const healthTone = score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'critical';
  const riskLevel = qaFailures > 0 || delayed > 0 ? (qaFailures > 0 ? 'Crítico' : 'Atenção') : 'Estável';

  return {
    score,
    healthLabel,
    healthTone,
    riskLevel,
    openTickets,
    delayed,
    qaFailures,
    pendingPayments,
    recentMessages,
    pendingActions,
    lastActivityAt: latestEvent?.createdAt || entity.updated_at || entity.createdAt || null,
    lastInteractionLabel: latestEvent?.summary || 'Sem interações recentes.',
    tags: entity?.metadata?.tags || entity?.metadata?.segments || [],
    status: entity?.metadata?.status || (score >= 45 ? 'ativo' : 'em risco'),
    hasQaFailure: qaFailures > 0,
  };
}

export function WorkspacePage() {
  const { agent } = useAuth();
  const classification = getAgentClassification(agent);
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [entities, setEntities] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [query, setQuery] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('Resumo');
  const [timeline, setTimeline] = useState({ items: [], total: 0, limit: 30, offset: 0, hasMore: false });
  const [insights, setInsights] = useState({ items: [], persisted: [] });
  const [actions, setActions] = useState({ items: [], suggestion: null });
  const [incidentRuns, setIncidentRuns] = useState({ items: [], total: 0 });
  const [actionModal, setActionModal] = useState(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);
  const [loadingIncidentRuns, setLoadingIncidentRuns] = useState(false);

  const tabType = useMemo(() => getWorkspaceTabEventType(activeTab), [activeTab]);

  const filteredEntities = useMemo(() => entities.filter((entity) => {
    const riskLevel = entity.summary?.riskLevel || 'none';
    if (sidebarFilter === 'risk') return riskLevel === 'attention' || riskLevel === 'critical';
    if (sidebarFilter === 'qa') return riskLevel === 'critical';
    if (sidebarFilter === 'active') return riskLevel !== 'critical';
    return true;
  }), [entities, sidebarFilter]);

  const selectedEntity = useMemo(
    () => filteredEntities.find((entity) => entity.id === selectedEntityId)
      || entities.find((entity) => entity.id === selectedEntityId)
      || null,
    [entities, filteredEntities, selectedEntityId],
  );

  const selectedSummary = useMemo(() => computeHealthSummary({
    entity: selectedEntity || {},
    timeline,
    insights,
    actions,
    incidents: incidentRuns,
  }), [selectedEntity, timeline, insights, actions, incidentRuns]);

  const loadEntities = useCallback(async (nextQuery = query) => {
    setLoadingEntities(true);
    try {
      const result = await listWorkspaceEntities({ q: nextQuery, limit: 60 });
      const items = result.items || [];
      setEntities(items);
      setSelectedEntityId((current) => current || items[0]?.id || null);
    } finally {
      setLoadingEntities(false);
    }
  }, [query]);

  useEffect(() => {
    const id = setTimeout(() => loadEntities(query), 250);
    return () => clearTimeout(id);
  }, [query, loadEntities]);

  const loadEntityData = useCallback(async (entityId, offset = 0, append = false) => {
    if (!entityId) return;
    setLoadingTimeline(true);
    setLoadingInsights(true);
    setLoadingActions(true);
    setLoadingIncidentRuns(true);
    try {
      const [timelineResult, insightsResult, actionsResult, incidentRunsResult] = await Promise.all([
        getWorkspaceTimeline(entityId, { limit: 30, offset, type: tabType }),
        getWorkspaceInsights(entityId),
        getWorkspaceActions(entityId),
        getWorkspaceIncidentRuns(entityId),
      ]);
      setTimeline((current) => append
        ? { ...timelineResult, items: [...(current.items || []), ...(timelineResult.items || [])] }
        : timelineResult);
      setInsights(insightsResult);
      setActions(actionsResult);
      setIncidentRuns(incidentRunsResult);
    } finally {
      setLoadingTimeline(false);
      setLoadingInsights(false);
      setLoadingActions(false);
      setLoadingIncidentRuns(false);
    }
  }, [tabType]);

  useEffect(() => {
    if (selectedEntityId) {
      loadEntityData(selectedEntityId, 0, false);
    }
  }, [selectedEntityId, loadEntityData, tabType]);

  const refreshWorkspace = useCallback(async () => {
    await loadEntities(query);
    if (selectedEntityId) {
      await loadEntityData(selectedEntityId, 0, false);
    }
  }, [loadEntities, loadEntityData, query, selectedEntityId]);

  const handleCreateDemo = useCallback(async () => {
    const suffix = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const result = await createWorkspaceEntity({
      type: 'contact',
      name: `Cliente Workspace ${suffix}`,
      phone: `5511999${suffix.slice(-4)}`,
      metadata: { createdFrom: 'workspace-ui' },
    });
    await loadEntities(query);
    setSelectedEntityId(result.entity?.id || null);
  }, [loadEntities, query]);

  const handleLoadMoreTimeline = useCallback(() => {
    if (!selectedEntityId || !timeline?.hasMore) return;
    loadEntityData(selectedEntityId, (timeline.offset || 0) + (timeline.limit || 30), true);
  }, [loadEntityData, selectedEntityId, timeline]);

  const handleCreateSuggestedAction = useCallback(async (suggestion) => {
    if (!selectedEntityId || !suggestion) return;
    if (suggestion.type === 'task') {
      await executeWorkspaceAutoActions(selectedEntityId);
    } else {
      await createWorkspaceAction({
        entityId: selectedEntityId,
        type: suggestion.type,
        status: 'pending',
        payload: suggestion,
      });
    }
    const result = await getWorkspaceActions(selectedEntityId);
    setActions(result);
  }, [selectedEntityId]);

  const closeActionModal = useCallback(() => setActionModal(null), []);

  const runModalSubmit = useCallback(async (fn, successMessage, errorMessage) => {
    if (!selectedEntityId) return;
    setSubmittingAction(true);
    try {
      await fn();
      showToast(successMessage, 'success');
      closeActionModal();
      await refreshWorkspace();
    } catch {
      showToast(errorMessage, 'error');
    } finally {
      setSubmittingAction(false);
    }
  }, [selectedEntityId, showToast, closeActionModal, refreshWorkspace]);

  const handleSubmitTask = useCallback(async ({ title, description, dueDate, taskType }) => {
    await runModalSubmit(
      () => createWorkspaceTask({
        entityId: selectedEntityId,
        title,
        description: description || undefined,
        dueDate: dueDate || undefined,
        type: taskType === 'followup' ? 'followup' : 'manual',
      }),
      taskType === 'followup' ? 'Follow-up criado com sucesso.' : 'Tarefa criada com sucesso.',
      'Não foi possível salvar. Tente novamente.',
    );
  }, [selectedEntityId, runModalSubmit]);

  const handleSubmitPayment = useCallback(async ({ amount, method, description }) => {
    await runModalSubmit(
      () => createPaymentEvent({
        entityId: selectedEntityId,
        amount,
        status: 'pending',
        type: 'payment',
        metadata: { ...(method ? { method } : {}), ...(description ? { description } : {}) },
      }),
      'Pagamento registrado com sucesso.',
      'Não foi possível registrar o pagamento.',
    );
  }, [selectedEntityId, runModalSubmit]);

  const handleSubmitBooking = useCallback(async ({ resourceId, startsAt, endsAt, notes }) => {
    await runModalSubmit(
      () => createResourceBooking({
        entityId: selectedEntityId,
        resourceId,
        startsAt,
        endsAt,
        metadata: notes ? { notes } : {},
      }),
      'Agendamento criado com sucesso.',
      'Não foi possível criar o agendamento.',
    );
  }, [selectedEntityId, runModalSubmit]);

  const handleExecuteSuggestion = useCallback((suggestion) => {
    const action = suggestion?.action;
    if (!action?.kind) {
      handleCreateSuggestedAction(suggestion);
      return;
    }
    if (action.kind === 'send_message') {
      if (action.conversationId) {
        navigate(`/inbox?conversationId=${encodeURIComponent(action.conversationId)}`);
      }
      return;
    }
    if (action.kind === 'schedule') {
      setActionModal({ kind: 'schedule' });
      return;
    }
    if (action.kind === 'create_task') {
      setActionModal({ kind: 'task', taskType: 'task', prefillTitle: action.label || suggestion.label });
      return;
    }
    if (action.kind === 'register_payment') {
      setActionModal({ kind: 'payment' });
      return;
    }
    if (action.kind === 'review_timeline') {
      setActiveTab('Timeline');
      return;
    }
    handleCreateSuggestedAction(suggestion);
  }, [handleCreateSuggestedAction, navigate]);

  return (
    <>
      <WorkspaceLayout
        entities={filteredEntities}
        selectedEntity={selectedEntity}
        selectedSummary={selectedSummary}
        selectedEntityId={selectedEntityId}
        loadingEntities={loadingEntities}
        query={query}
        sidebarFilter={sidebarFilter}
        activeTab={activeTab}
        timeline={timeline}
        insights={insights}
        actions={actions}
        incidents={incidentRuns}
        loadingTimeline={loadingTimeline}
        loadingInsights={loadingInsights}
        loadingActions={loadingActions}
        loadingIncidents={loadingIncidentRuns}
        classification={classification}
        onQueryChange={setQuery}
        onSidebarFilterChange={setSidebarFilter}
        onSelectEntity={setSelectedEntityId}
        onTabChange={setActiveTab}
        onCreateDemo={handleCreateDemo}
        onLoadMoreTimeline={handleLoadMoreTimeline}
        onCreateSuggestedAction={handleCreateSuggestedAction}
        onExecuteSuggestion={handleExecuteSuggestion}
        onCreateTask={() => setActionModal({ kind: 'task', taskType: 'task' })}
        onCreateFollowUp={() => setActionModal({ kind: 'task', taskType: 'followup' })}
        onRegisterPayment={() => setActionModal({ kind: 'payment' })}
        onSchedule={() => setActionModal({ kind: 'schedule' })}
      />
      <TaskActionModal
        isOpen={actionModal?.kind === 'task'}
        taskType={actionModal?.taskType || 'task'}
        prefillTitle={actionModal?.prefillTitle || ''}
        submitting={submittingAction}
        onClose={closeActionModal}
        onSubmit={handleSubmitTask}
      />
      <PaymentActionModal
        isOpen={actionModal?.kind === 'payment'}
        submitting={submittingAction}
        onClose={closeActionModal}
        onSubmit={handleSubmitPayment}
      />
      <ScheduleActionModal
        isOpen={actionModal?.kind === 'schedule'}
        submitting={submittingAction}
        onClose={closeActionModal}
        onSubmit={handleSubmitBooking}
      />
      <ToastContainer />
    </>
  );
}
