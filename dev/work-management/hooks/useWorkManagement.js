import { useEffect, useMemo, useState } from 'react';
import { loadWorkManagementData } from '../services/workManagementService.js';
import { BOARD_COLUMNS, DEFAULT_FILTERS } from '../types/models.js';

function isWithinPeriod(value, period) {
  if (period === 'all') return true;
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const cutoff = new Date('2026-04-23T23:59:59.999Z');
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function sortByDateDescending(list, field) {
  return [...list].sort((left, right) => new Date(right[field]).getTime() - new Date(left[field]).getTime());
}

export function useWorkManagement({ projectId = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [data, setData] = useState({
    projects: [],
    workspaces: [],
    workItems: [],
    executions: [],
    replays: [],
    evidence: [],
    aiSuggestions: [],
    documents: [],
    team: [],
    activity: [],
    operationWaves: [],
    healthDomains: [],
    qaScenarios: [],
  });
  const [selectedExecutionId, setSelectedExecutionId] = useState(null);
  const [selectedReplayId, setSelectedReplayId] = useState(null);
  const [projectView, setProjectView] = useState('cards');
  const [sources, setSources] = useState({});
  const [liveErrors, setLiveErrors] = useState({});

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const next = await loadWorkManagementData();
        if (!active) return;
        if (next.authRequired) {
          // Sem sessão: não exibir mock como se fosse dado real.
          setError('Login necessário para carregar os dados do Work Management.');
          return;
        }
        const { authRequired, sources: nextSources, liveErrors: nextLiveErrors, ...collections } = next;
        setData(collections);
        setSources(nextSources || {});
        setLiveErrors(nextLiveErrors || {});
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Falha ao carregar o modulo Work Management.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const projectsById = useMemo(() => Object.fromEntries(data.projects.map((project) => [project.id, project])), [data.projects]);
  const selectedProject = useMemo(() => (projectId ? projectsById[projectId] || null : null), [projectId, projectsById]);

  const filteredProjects = useMemo(() => {
    return data.projects.filter((project) => {
      if (projectId && project.id !== projectId) return false;
      if (filters.project !== 'all' && project.id !== filters.project) return false;
      if (filters.tenant !== 'all' && project.tenant !== filters.tenant) return false;
      if (filters.environment !== 'all' && project.environment !== filters.environment) return false;
      if (filters.channel !== 'all' && project.channel !== filters.channel) return false;
      if (filters.status !== 'all' && project.status !== filters.status) return false;
      return true;
    });
  }, [data.projects, filters, projectId]);

  const allowedProjectIds = useMemo(() => new Set(filteredProjects.map((project) => project.id)), [filteredProjects]);

  const filteredItems = useMemo(() => {
    return data.workItems.filter((item) => {
      if (!allowedProjectIds.has(item.projectId)) return false;
      if (filters.tenant !== 'all' && item.tenant !== filters.tenant) return false;
      if (filters.environment !== 'all' && item.environment !== filters.environment) return false;
      if (filters.channel !== 'all' && item.channel !== filters.channel) return false;
      if (filters.status !== 'all' && item.status !== filters.status) return false;
      return true;
    });
  }, [allowedProjectIds, data.workItems, filters]);

  const allowedItemIds = useMemo(() => new Set(filteredItems.map((item) => item.id)), [filteredItems]);

  const filteredExecutions = useMemo(() => {
    return sortByDateDescending(
      data.executions.filter((execution) => {
        // entidades live (_live) não têm workItem no mock — não filtrar por vínculo
        if (!execution._live && !allowedItemIds.has(execution.workItemId)) return false;
        if (filters.tenant !== 'all' && execution.tenant !== filters.tenant) return false;
        if (filters.environment !== 'all' && execution.environment !== filters.environment) return false;
        if (filters.channel !== 'all' && execution.channel !== filters.channel) return false;
        return isWithinPeriod(execution.timestamp, filters.period);
      }),
      'timestamp',
    );
  }, [allowedItemIds, data.executions, filters]);

  const filteredReplays = useMemo(() => {
    return sortByDateDescending(
      data.replays.filter((replay) => (replay._live || allowedItemIds.has(replay.workItemId)) && isWithinPeriod(replay.createdAt, filters.period)),
      'createdAt',
    );
  }, [allowedItemIds, data.replays, filters.period]);

  const filteredSuggestions = useMemo(() => {
    return sortByDateDescending(
      data.aiSuggestions.filter((suggestion) => {
        if (projectId && suggestion.projectId !== projectId) return false;
        if (filters.project !== 'all' && suggestion.projectId !== filters.project) return false;
        return isWithinPeriod(suggestion.createdAt, filters.period);
      }),
      'createdAt',
    );
  }, [data.aiSuggestions, filters.period, filters.project, projectId]);

  const filteredActivity = useMemo(() => {
    return sortByDateDescending(
      data.activity.filter((event) => {
        if (projectId && event.projectId !== projectId) return false;
        if (filters.project !== 'all' && event.projectId !== filters.project) return false;
        return isWithinPeriod(event.timestamp, filters.period);
      }),
      'timestamp',
    );
  }, [data.activity, filters.period, filters.project, projectId]);

  const filteredDocuments = useMemo(() => {
    return sortByDateDescending(
      data.documents.filter((document) => {
        if (projectId && document.projectId !== projectId) return false;
        if (filters.project !== 'all' && document.projectId !== filters.project) return false;
        return true;
      }),
      'updatedAt',
    );
  }, [data.documents, filters.project, projectId]);

  const filteredQaScenarios = useMemo(() => {
    return data.qaScenarios.filter((scenario) => {
      if (!scenario._live && !allowedItemIds.has(scenario.workItemId)) return false;
      if (filters.channel !== 'all' && scenario.channel !== filters.channel) return false;
      return true;
    });
  }, [allowedItemIds, data.qaScenarios, filters.channel]);

  const filteredWaves = useMemo(() => {
    return data.operationWaves.filter((wave) => {
      if (projectId && wave.projectId !== projectId) return false;
      if (filters.project !== 'all' && wave.projectId !== filters.project) return false;
      if (filters.channel !== 'all' && wave.domain !== filters.channel) return false;
      return true;
    });
  }, [data.operationWaves, filters.channel, filters.project, projectId]);

  const executionsById = useMemo(() => Object.fromEntries(data.executions.map((execution) => [execution.id, execution])), [data.executions]);
  const replaysById = useMemo(() => Object.fromEntries(data.replays.map((replay) => [replay.id, replay])), [data.replays]);
  const itemsById = useMemo(() => Object.fromEntries(data.workItems.map((item) => [item.id, item])), [data.workItems]);

  const selectedExecution = selectedExecutionId ? executionsById[selectedExecutionId] || null : null;
  const selectedReplay = selectedReplayId ? replaysById[selectedReplayId] || null : null;
  const selectedExecutionEvidence = useMemo(
    () => data.evidence.filter((entry) => entry.executionId === selectedExecutionId),
    [data.evidence, selectedExecutionId],
  );

  const totals = useMemo(() => {
    const openItems = filteredItems.filter((item) => item.status !== 'done').length;
    const atRisk = filteredItems.filter((item) => item.status === 'blocked' || item.priority === 'critical').length;
    const executionsToday = filteredExecutions.filter((execution) => execution.timestamp.startsWith('2026-04-23')).length;
    const passed = filteredExecutions.filter((execution) => execution.status === 'passed').length;
    const successRate = filteredExecutions.length > 0 ? Math.round((passed / filteredExecutions.length) * 100) : 0;
    const criticalFailures = filteredExecutions.filter((execution) => execution.status === 'failed').length;
    return {
      totalProjects: filteredProjects.length,
      openItems,
      atRisk,
      executionsToday,
      successRate,
      criticalFailures,
    };
  }, [filteredExecutions, filteredItems, filteredProjects.length]);

  const board = useMemo(() => {
    return BOARD_COLUMNS.map((columnId) => ({
      id: columnId,
      items: filteredItems.filter((item) => item.status === columnId),
    }));
  }, [filteredItems]);

  const deliverables = useMemo(() => {
    return filteredItems
      .filter((item) => ['rollout', 'validation', 'feature', 'operation', 'document_action', 'approval'].includes(item.type))
      .map((item) => ({
        ...item,
        project: projectsById[item.projectId],
      }));
  }, [filteredItems, projectsById]);

  const metrics = useMemo(() => {
    const doneItems = filteredItems.filter((item) => item.status === 'done').length;
    const reopened = filteredItems.filter((item) => item.status === 'blocked').length;
    const passRate = filteredQaScenarios.length > 0
      ? Math.round((filteredQaScenarios.filter((scenario) => scenario.status === 'passed').length / filteredQaScenarios.length) * 100)
      : 0;
    const avgLatency = filteredExecutions.length > 0
      ? Math.round(filteredExecutions.reduce((sum, execution) => sum + execution.duration, 0) / filteredExecutions.length)
      : 0;
    return {
      leadTime: 12,
      cycleTime: 5,
      throughput: doneItems,
      completionRate: filteredItems.length > 0 ? Math.round((doneItems / filteredItems.length) * 100) : 0,
      reopenRate: filteredItems.length > 0 ? Math.round((reopened / filteredItems.length) * 100) : 0,
      validationPassRate: passRate,
      operationalHealth: Math.round(data.healthDomains.reduce((sum, domain) => sum + domain.availability, 0) / Math.max(data.healthDomains.length, 1)),
      incidentRecurrence: filteredExecutions.filter((execution) => execution.status === 'failed').length,
      slaEntrega: 93,
      avgLatency,
    };
  }, [data.healthDomains, filteredExecutions, filteredItems, filteredQaScenarios]);

  function setFilterValue(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  function moveWorkItem(itemId, nextStatus) {
    setData((current) => ({
      ...current,
      workItems: current.workItems.map((item) => (item.id === itemId ? { ...item, status: nextStatus } : item)),
    }));
  }

  function openExecution(executionId) {
    setSelectedExecutionId(executionId);
  }

  function openReplay(replayId) {
    setSelectedReplayId(replayId);
  }

  return {
    loading,
    error,
    sources,
    liveErrors,
    filters,
    setFilterValue,
    resetFilters,
    selectedProject,
    projects: filteredProjects,
    workspaces: data.workspaces,
    workItems: filteredItems,
    executions: filteredExecutions,
    replays: filteredReplays,
    evidence: data.evidence,
    aiSuggestions: filteredSuggestions,
    documents: filteredDocuments,
    team: data.team,
    activity: filteredActivity,
    waves: filteredWaves,
    healthDomains: data.healthDomains,
    qaScenarios: filteredQaScenarios,
    totals,
    board,
    deliverables,
    metrics,
    itemsById,
    projectsById,
    selectedExecution,
    selectedReplay,
    selectedExecutionEvidence,
    projectView,
    setProjectView,
    moveWorkItem,
    openExecution,
    openReplay,
    closeExecution: () => setSelectedExecutionId(null),
    closeReplay: () => setSelectedReplayId(null),
  };
}

export default useWorkManagement;