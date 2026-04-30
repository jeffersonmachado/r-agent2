import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkspaceAction,
  createWorkspaceEntity,
  executeWorkspaceAutoActions,
  getWorkspaceActions,
  getWorkspaceAutoCorrections,
  getWorkspaceInsights,
  getWorkspaceTimeline,
  listWorkspaceEntities,
} from '../api/workspace';
import { WorkspaceLayout } from '../modules/workspace/WorkspaceLayout';

function isFailureEvent(event = {}) {
  return /falha|erro|failed|failure|error|regression|bug/i.test(`${event.summary || ''} ${JSON.stringify(event.payload || {})}`);
}

function computeHealthSummary({ entity = {}, timeline = {}, insights = {}, actions = {}, autocorrections = {} }) {
  const items = timeline.items || [];
  const allInsights = [...(insights.items || []), ...(insights.persisted || [])];
  const actionItems = actions.items || [];
  const autoRuns = autocorrections.items || [];
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
  const [entities, setEntities] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [query, setQuery] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('Resumo');
  const [timeline, setTimeline] = useState({ items: [], total: 0, limit: 30, offset: 0, hasMore: false });
  const [insights, setInsights] = useState({ items: [], persisted: [] });
  const [actions, setActions] = useState({ items: [], suggestion: null });
  const [autocorrections, setAutoCorrections] = useState({ items: [], total: 0 });
  const [entitySummaries, setEntitySummaries] = useState({});
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);
  const [loadingAutoCorrections, setLoadingAutoCorrections] = useState(false);

  const tabType = useMemo(() => ({
    Conversas: 'message',
    Tickets: 'ticket',
    Tarefas: 'task',
    Agenda: 'schedule',
    Projetos: 'project',
    Documentos: 'document',
    Pagamentos: 'payment',
    'QA/RPA': 'evidence',
  }[activeTab] || ''), [activeTab]);

  const filteredEntities = useMemo(() => entities.filter((entity) => {
    const summary = entitySummaries[entity.id] || {};
    if (sidebarFilter === 'risk') return summary.healthTone === 'critical' || summary.healthTone === 'warning';
    if (sidebarFilter === 'qa') return summary.hasQaFailure;
    if (sidebarFilter === 'active') return summary.status !== 'inativo';
    return true;
  }), [entities, entitySummaries, sidebarFilter]);

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
    autocorrections,
  }), [selectedEntity, timeline, insights, actions, autocorrections]);

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
    setLoadingAutoCorrections(true);
    try {
      const [timelineResult, insightsResult, actionsResult, autoCorrectionResult] = await Promise.all([
        getWorkspaceTimeline(entityId, { limit: 30, offset, type: tabType }),
        getWorkspaceInsights(entityId),
        getWorkspaceActions(entityId),
        getWorkspaceAutoCorrections(entityId),
      ]);
      setTimeline((current) => append
        ? { ...timelineResult, items: [...(current.items || []), ...(timelineResult.items || [])] }
        : timelineResult);
      setInsights(insightsResult);
      setActions(actionsResult);
      setAutoCorrections(autoCorrectionResult);
      setEntitySummaries((current) => ({
        ...current,
        [entityId]: computeHealthSummary({
          entity: entities.find((item) => item.id === entityId) || { id: entityId },
          timeline: timelineResult,
          insights: insightsResult,
          actions: actionsResult,
          autocorrections: autoCorrectionResult,
        }),
      }));
    } finally {
      setLoadingTimeline(false);
      setLoadingInsights(false);
      setLoadingActions(false);
      setLoadingAutoCorrections(false);
    }
  }, [entities, tabType]);

  useEffect(() => {
    if (selectedEntityId) {
      loadEntityData(selectedEntityId, 0, false);
    }
  }, [selectedEntityId, loadEntityData, tabType]);

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

  const handleCreateTask = useCallback(async () => {
    if (!selectedEntityId) return;
    await createWorkspaceAction({
      entityId: selectedEntityId,
      type: 'task',
      status: 'pending',
      payload: { title: 'Nova tarefa criada no Workspace', source: 'workspace_header' },
    });
    setActions(await getWorkspaceActions(selectedEntityId));
  }, [selectedEntityId]);

  const handleCreateFollowUp = useCallback(async () => {
    if (!selectedEntityId) return;
    await createWorkspaceAction({
      entityId: selectedEntityId,
      type: 'followup',
      status: 'pending',
      payload: { title: 'Novo follow-up criado no Workspace', source: 'workspace_header' },
    });
    setActions(await getWorkspaceActions(selectedEntityId));
  }, [selectedEntityId]);

  return (
    <WorkspaceLayout
      entities={filteredEntities}
      selectedEntity={selectedEntity}
      selectedSummary={selectedSummary}
      selectedEntityId={selectedEntityId}
      entitySummaries={entitySummaries}
      loadingEntities={loadingEntities}
      query={query}
      sidebarFilter={sidebarFilter}
      activeTab={activeTab}
      timeline={timeline}
      insights={insights}
      actions={actions}
      autocorrections={autocorrections}
      loadingTimeline={loadingTimeline}
      loadingInsights={loadingInsights}
      loadingActions={loadingActions}
      loadingAutoCorrections={loadingAutoCorrections}
      onQueryChange={setQuery}
      onSidebarFilterChange={setSidebarFilter}
      onSelectEntity={setSelectedEntityId}
      onTabChange={setActiveTab}
      onCreateDemo={handleCreateDemo}
      onLoadMoreTimeline={handleLoadMoreTimeline}
      onCreateSuggestedAction={handleCreateSuggestedAction}
      onCreateTask={handleCreateTask}
      onCreateFollowUp={handleCreateFollowUp}
    />
  );
}
