import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkspaceAction,
  createWorkspaceEntity,
  executeWorkspaceAutoActions,
  getWorkspaceActions,
  getWorkspaceInsights,
  getWorkspaceTimeline,
  listWorkspaceEntities,
} from '../api/workspace';
import { WorkspaceLayout } from '../modules/workspace/WorkspaceLayout';

export function WorkspacePage() {
  const [entities, setEntities] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('Resumo');
  const [timeline, setTimeline] = useState({ items: [], total: 0, limit: 30, offset: 0, hasMore: false });
  const [insights, setInsights] = useState({ items: [], persisted: [] });
  const [actions, setActions] = useState({ items: [], suggestion: null });
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);

  const tabType = useMemo(() => ({
    Conversas: 'message',
    Tickets: 'ticket',
    Tarefas: 'task',
    Agenda: 'schedule',
    Projetos: 'project',
    Documentos: 'document',
    'QA/RPA': 'evidence',
  }[activeTab] || ''), [activeTab]);

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.id === selectedEntityId) || null,
    [entities, selectedEntityId],
  );

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
    try {
      const [timelineResult, insightsResult, actionsResult] = await Promise.all([
        getWorkspaceTimeline(entityId, { limit: 30, offset, type: tabType }),
        getWorkspaceInsights(entityId),
        getWorkspaceActions(entityId),
      ]);
      setTimeline((current) => append
        ? { ...timelineResult, items: [...(current.items || []), ...(timelineResult.items || [])] }
        : timelineResult);
      setInsights(insightsResult);
      setActions(actionsResult);
    } finally {
      setLoadingTimeline(false);
      setLoadingInsights(false);
      setLoadingActions(false);
    }
  }, [tabType]);

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

  return (
    <WorkspaceLayout
      entities={entities}
      selectedEntity={selectedEntity}
      selectedEntityId={selectedEntityId}
      loadingEntities={loadingEntities}
      query={query}
      activeTab={activeTab}
      timeline={timeline}
      insights={insights}
      actions={actions}
      loadingTimeline={loadingTimeline}
      loadingInsights={loadingInsights}
      loadingActions={loadingActions}
      onQueryChange={setQuery}
      onSelectEntity={setSelectedEntityId}
      onTabChange={setActiveTab}
      onCreateDemo={handleCreateDemo}
      onLoadMoreTimeline={handleLoadMoreTimeline}
      onCreateSuggestedAction={handleCreateSuggestedAction}
    />
  );
}
