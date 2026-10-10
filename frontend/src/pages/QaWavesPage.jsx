import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '../api/client';
import JourneyStatusCard from '../components/qa-waves/JourneyStatusCard';
import JourneyTree from '../components/qa-waves/JourneyTree';
import StepBreakdown from '../components/qa-waves/StepBreakdown';
import ReplayDetailsModal from '../components/qa-waves/ReplayDetailsModal';
import { CoverageGapsTab } from '../components/qa-waves/CoverageGapsTab';
import { QaWavesDocsTab } from '../components/qa-waves/QaWavesDocsTab';
import { useExecutionPolling } from '../components/qa-waves/useExecutionPolling';
import { ExecutionProgress } from '../components/qa-waves/ExecutionProgress';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useWebSocketStatus } from '../utils/webSocketStatusConfig';
import logger from '../utils/logger';
import '../components/qa-waves/qaWaves.css';

function toScenarioId(scenario) {
  if (!scenario) return null;
  if (typeof scenario === 'string') return scenario;
  if (typeof scenario === 'object') return scenario.id || scenario.scenarioId || null;
  return null;
}

const STEP_TYPE_LABELS = {
  send_message: 'Enviar mensagem',
  validate_intent: 'Validar intenção',
  provide_data: 'Informar dados',
  validate_response: 'Validar resposta',
  check_availability: 'Consultar disponibilidade',
  select_slot: 'Selecionar horário',
  create_booking: 'Criar agendamento',
  create_payment: 'Criar pagamento',
  validate_backend: 'Validar backend',
  validate_sla: 'Validar SLA',
  validate_context: 'Validar contexto',
  validate_fallback: 'Validar fallback',
  validate_flow_transition: 'Validar transição de fluxo',
  validate_access_release: 'Validar liberação de acesso',
  wait_for_event: 'Aguardar evento',
  trigger_channel_event: 'Disparar evento de canal',
};

function formatStepTypeLabel(stepType) {
  if (!stepType) return 'Passo sem nome';
  if (STEP_TYPE_LABELS[stepType]) return STEP_TYPE_LABELS[stepType];
  return String(stepType)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^\w)/, (match) => match.toUpperCase());
}

function toSemanticStepType(rawStep) {
  return String(rawStep || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom_step';
}

function createSemanticStepsFromJourneySteps(journeySteps = []) {
  return (journeySteps || []).map((journeyStep, index) => ({
    id: `step-${index + 1}-${toSemanticStepType(journeyStep)}`,
    order: index + 1,
    type: toSemanticStepType(journeyStep),
    enabled: true,
  }));
}

function ensureScenarioSemanticSteps(scenario) {
  if (!scenario || typeof scenario !== 'object') return scenario;
  if (Array.isArray(scenario.steps) && scenario.steps.length > 0) return scenario;
  const journeySteps = Array.isArray(scenario.journeySteps) ? scenario.journeySteps : [];
  return {
    ...scenario,
    steps: createSemanticStepsFromJourneySteps(journeySteps),
  };
}

export function QaWavesPage() {
  const [journeysTree, setJourneysTree] = useState([]);
  const [journeyStatus, setJourneyStatus] = useState([]);
  const [stepStatus, setStepStatus] = useState([]);
  const [scenarioItems, setScenarioItems] = useState([]);
  const [executionItems, setExecutionItems] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [scenarioEditor, setScenarioEditor] = useState('');
  const [inferGoal, setInferGoal] = useState('');
  const [inferenceJourneyId, setInferenceJourneyId] = useState('auto');
  const [journeyReview, setJourneyReview] = useState(null);
  const [loadingJourneyReview, setLoadingJourneyReview] = useState(false);
  const [runReplayId, setRunReplayId] = useState('');
  const [selectedSeedId, setSelectedSeedId] = useState('');
  const [currentExecutionId, setCurrentExecutionId] = useState('');
  const [filters, setFilters] = useState({
    wave: '',
    journey: '',
    scenario: '',
    seed: '',
    status: '',
    source: '',
    dateStart: '',
    dateEnd: '',
  });
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [selectedJourneyId, setSelectedJourneyId] = useState('');
  const activeReplayDetailsRef = useRef(null);
  const [activeReplayDetails, setActiveReplayDetailsState] = useState(null);
  const setActiveReplayDetails = (details) => {
    activeReplayDetailsRef.current = details;
    setActiveReplayDetailsState(details);
  };
  const [showExecutionsModal, setShowExecutionsModal] = useState(false);
  const [showNewJourneyForm, setShowNewJourneyForm] = useState(false);
  const [newJourneyFields, setNewJourneyFields] = useState({ id: '', title: '', vertical: '' });
  const [executionFilterWave, setExecutionFilterWave] = useState('');
  const [executionFilterJourney, setExecutionFilterJourney] = useState('');
  const [executionDateTimeStart, setExecutionDateTimeStart] = useState('');
  const [executionDateTimeEnd, setExecutionDateTimeEnd] = useState('');
  const startedPollingExecutionRef = useRef('');
  const lastTransientNetworkToastAtRef = useRef(0);
  const { showToast, ToastContainer } = useToast();

  const notifyError = useCallback((message) => {
    if (!message) return;
    showToast(message, 'error');
  }, [showToast]);

  const notifySuccess = useCallback((message) => {
    if (!message) return;
    showToast(message, 'success');
  }, [showToast]);

  const isTransientNetworkFailure = useCallback((value) => {
    if (!value) return false;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return normalized.includes('failed to fetch')
        || normalized.includes('network')
        || normalized.includes('err_network_changed');
    }
    const msg = String(value?.message || '').toLowerCase();
    return value?.connectionRefused === true
      || Number(value?.status) === 0
      || msg.includes('failed to fetch')
      || msg.includes('network')
      || msg.includes('err_network_changed');
  }, []);

  const notifyRequestError = useCallback((err, fallbackMessage) => {
    if (isTransientNetworkFailure(err)) {
      const now = Date.now();
      // Evita spam de toast quando o proxy/API oscila por alguns segundos.
      if (now - lastTransientNetworkToastAtRef.current > 30000) {
        lastTransientNetworkToastAtRef.current = now;
        notifyError('API temporariamente indisponível. Tentando reconectar...');
      }
      return;
    }
    notifyError(err?.message || fallbackMessage);
  }, [isTransientNetworkFailure, notifyError]);

  // Hook realtime: snapshot inicial + atualizações via WebSocket
  const executionPolling = useExecutionPolling(currentExecutionId);

  const upsertExecutionFromWs = useCallback((payload, message = {}) => {
    if (!payload?.executionId) return;

    const fallbackTimestamp = message?.timestamp || new Date().toISOString();

    setExecutionItems((prev) => {
      const items = Array.isArray(prev) ? [...prev] : [];
      const index = items.findIndex((item) => item.executionId === payload.executionId);
      const existing = index >= 0 ? items[index] : null;
      const replayArtifacts = Array.isArray(existing?.replayArtifacts) && existing.replayArtifacts.length > 0
        ? existing.replayArtifacts
        : (Array.isArray(payload.replayIds)
            ? payload.replayIds.map((replayId) => ({
                replayId,
                waveId: payload.waveId || null,
                journeyId: payload.journeyId || null,
              }))
            : []);

      const nextItem = {
        ...existing,
        executionId: payload.executionId,
        status: payload.status || existing?.status || 'processing',
        progress: Number.isFinite(payload.progress) ? payload.progress : (existing?.progress || 0),
        summary: payload.summary || existing?.summary || null,
        currentStep: payload.currentStep || existing?.currentStep || null,
        startedAt: payload.startedAt || existing?.startedAt || null,
        finishedAt: payload.finishedAt || existing?.finishedAt || null,
        createdAt: existing?.createdAt || payload.startedAt || fallbackTimestamp,
        replayArtifacts,
        waveId: payload.waveId || existing?.waveId || null,
        journeyId: payload.journeyId || existing?.journeyId || null,
        results: Array.isArray(payload.results) ? payload.results : (existing?.results || []),
      };

      if (index >= 0) {
        items[index] = nextItem;
      } else {
        items.unshift(nextItem);
      }

      return items;
    });
  }, []);

  // WebSocket: atualiza a lista local de execuções sem recarga REST automática.
  const handleWsEvent = useCallback((eventName, payload, message) => {
    if (eventName !== 'qa-waves.execution.updated' && eventName !== 'qa-waves.execution.started') return;
    upsertExecutionFromWs(payload, message);

    // Auto-refresh do modal de replay quando a execução que gerou o replay visível finaliza.
    const terminalStatuses = ['completed', 'success', 'failed', 'failure', 'cancelled', 'timeout'];
    const isTerminal = terminalStatuses.includes(String(payload?.status || '').toLowerCase());
    if (isTerminal && activeReplayDetailsRef.current) {
      const openReplayId = activeReplayDetailsRef.current.replayId || activeReplayDetailsRef.current.id;
      const wsReplayIds = Array.isArray(payload?.replayIds) ? payload.replayIds : [];
      if (openReplayId && wsReplayIds.includes(openReplayId)) {
        setTimeout(() => openReplayPage(openReplayId), 600);
      }
    }
  }, [upsertExecutionFromWs]); // eslint-disable-line react-hooks/exhaustive-deps

  const { connected: wsConnected, authenticated: wsAuthenticated, authFailed: wsAuthFailed } = useWebSocketContext({
    onEvent: handleWsEvent,
    subscribeEvents: ['qa-waves.execution.updated', 'qa-waves.execution.started'],
  });

  const wsStatus = useWebSocketStatus({
    connected: wsConnected,
    authenticated: wsAuthenticated,
    authFailed: wsAuthFailed,
  });

  // Inicia acompanhamento somente uma vez por executionId.
  useEffect(() => {
    if (!currentExecutionId) {
      startedPollingExecutionRef.current = '';
      return;
    }

    if (startedPollingExecutionRef.current === currentExecutionId) {
      return;
    }

    startedPollingExecutionRef.current = currentExecutionId;
    executionPolling.startPolling();
  }, [currentExecutionId, executionPolling]);

  // Auto-abre replay quando execução termina com sucesso
  useEffect(() => {
    if (executionPolling.isFinished && runReplayId) {
      setTimeout(() => {
        openReplayPage(runReplayId);
      }, 500);
    }
  }, [executionPolling.isFinished, runReplayId]);

  // Pré-carrega último replay disponível para o cenário selecionado
  useEffect(() => {
    if (!selectedScenarioId) {
      setRunReplayId('');
      return;
    }
    let cancelled = false;
    setRunReplayId(''); // limpa enquanto busca
    fetchJson(`/api/test-executions/replays?scenarioId=${encodeURIComponent(selectedScenarioId)}&limit=1&sortBy=modifiedAt&sortOrder=desc`)
      .then((result) => {
        if (cancelled) return;
        const files = result?.files || [];
        setRunReplayId(files.length > 0 ? (files[0].replayId || '') : '');
      })
      .catch(() => { if (!cancelled) setRunReplayId(''); });
    return () => { cancelled = true; };
  }, [selectedScenarioId]);

  const selectedDomain = useMemo(
    () => journeysTree.find((domain) => domain.id === selectedDomainId) || null,
    [journeysTree, selectedDomainId]
  );

  const selectedJourney = useMemo(
    () => selectedDomain?.journeys?.find((journey) => journey.journeyId === selectedJourneyId) || null,
    [selectedDomain, selectedJourneyId]
  );

  const availableJourneys = useMemo(
    () => selectedDomain?.journeys || [],
    [selectedDomain]
  );

  const selectedJourneyScenarios = useMemo(
    () => (scenarioItems || []).filter((scenario) => scenario?.journeyId === selectedJourneyId),
    [scenarioItems, selectedJourneyId]
  );

  const parsedScenario = useMemo(() => {
    try {
      return scenarioEditor ? JSON.parse(scenarioEditor) : null;
    } catch {
      return null;
    }
  }, [scenarioEditor]);

  const treeForSidebar = useMemo(() => {
    const statusByJourney = new Map(journeyStatus.map((item) => [item.journeyId, item]));
    return journeysTree.map((domain) => ({
      ...domain,
      journeys: (domain.journeys || []).map((journey) => ({
        ...journey,
        status: statusByJourney.get(journey.journeyId)?.status || journey.status || 'WARNING',
      })),
    }));
  }, [journeysTree, journeyStatus]);

  // Sidebar mostra apenas o domínio selecionado (a navegação entre domínios
  // agora é feita pelos pills no topo).
  const sidebarTree = useMemo(() => {
    if (!selectedDomainId) return treeForSidebar;
    return treeForSidebar.filter((domain) => domain.id === selectedDomainId);
  }, [treeForSidebar, selectedDomainId]);

  const domainSummary = useMemo(() => {
    if (!selectedDomain) {
      return {
        totalItems: 0,
        criticalItems: 0,
        coverage: 0,
        scenarioIds: [],
      };
    }

    // Cenários reais de QA deste domínio (mesmo critério da lista "Cenários").
    const scenarioIds = (scenarioItems || [])
      .filter((s) => s.vertical === selectedDomain.id)
      .map((s) => s.id);

    let criticalSelectedDomain = 0;
    let executedSelectedDomain = 0;
    let totalScenariosSelected = 0;

    for (const journey of selectedDomain?.journeys || []) {
      const totalScenarios = journey.totalScenarios || 0;
      totalScenariosSelected += totalScenarios;
      criticalSelectedDomain += journey.criticalFailures || 0;
      executedSelectedDomain += Math.round(((journey.executedRate || 0) / 100) * totalScenarios);
    }

    const coverage = totalScenariosSelected > 0
      ? Math.min(100, Math.round((executedSelectedDomain / totalScenariosSelected) * 100))
      : 0;

    return {
      totalItems: scenarioIds.length,
      criticalItems: criticalSelectedDomain,
      coverage,
      scenarioIds,
    };
  }, [selectedDomain, scenarioItems]);

  async function loadJourneyStatus() {
    const response = await fetchJson('/api/qa-waves/journey-status', { suppressErrorLog: true });
    setJourneyStatus(Array.isArray(response.items) ? response.items : []);
  }

  async function loadScenarios() {
    const params = new URLSearchParams();
    if (filters.wave) params.set('waveId', filters.wave);
    if (filters.journey) params.set('journey', filters.journey);
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    const suffix = params.toString();
    const response = await fetchJson(`/api/qa-waves/scenarios${suffix ? `?${suffix}` : ''}`, { suppressErrorLog: true });
    const items = Array.isArray(response.items) ? response.items : [];
    setScenarioItems(items);

    if (!selectedScenarioId && items.length > 0) {
      const firstScenario = ensureScenarioSemanticSteps(items[0]);
      setSelectedScenarioId(firstScenario.id);
      setScenarioEditor(JSON.stringify(firstScenario, null, 2));
    }
  }

  async function loadStepStatus() {
    const params = new URLSearchParams();
    if (selectedJourneyId) params.set('journeyId', selectedJourneyId);
    const suffix = params.toString();
    const response = await fetchJson(`/api/qa-waves/step-status${suffix ? `?${suffix}` : ''}`, { suppressErrorLog: true });
    setStepStatus(Array.isArray(response.items) ? response.items : []);
  }

  async function loadExecutions() {
    const response = await fetchJson('/api/qa-waves/executions?limit=50', { suppressErrorLog: true });
    setExecutionItems(Array.isArray(response.items) ? response.items : []);
  }

  async function loadAll() {
    try {
      const [journeysData, journeyStatusData] = await Promise.all([
        fetchJson('/api/qa-waves/journeys'),
        fetchJson('/api/qa-waves/journey-status'),
        loadScenarios(),
        loadExecutions(),
      ]);

      const domains = Array.isArray(journeysData.domains) ? journeysData.domains : [];
      setJourneysTree(domains);
      setJourneyStatus(Array.isArray(journeyStatusData.items) ? journeyStatusData.items : []);

      if (!selectedDomainId && domains.length > 0) {
        const firstDomain = domains[0];
        const firstJourney = firstDomain?.journeys?.[0];
        setSelectedDomainId(firstDomain.id || '');
        setSelectedJourneyId(firstJourney?.journeyId || '');
      } else if (selectedJourneyId) {
        await loadStepStatus();
      }
    } catch (err) {
      notifyRequestError(err, 'Falha ao carregar QA Waves');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (selectedJourneyId) {
      // DEFEITO REAL medido em 2026-10-01: sem `.catch`, uma falha transitoria de rede no
      // `loadStepStatus` virava REJEIÇÃO NÃO TRATADA (`page_error: Failed to fetch`) no console.
      // O RPA classifica erro crítico de página como falha do cenário e isolou
      // `fitness-matricula-leads` como `infra_error` => `CRITICAL_DOMAIN_FAILED:omnichannel`.
      // Este dado é AUXILIAR (status dos steps na sidebar): falhar nele não pode quebrar a
      // página nem alarmar o usuário com toast — mantém o último estado e registra um aviso
      // (`logger.warn` => `console.warn`, nunca `console.error`).
      loadStepStatus().catch((err) => {
        logger.warn('Falha ao carregar status dos steps (dado auxiliar, mantendo estado):', err);
      });
    }
  }, [selectedJourneyId]);

  useEffect(() => {
    setInferenceJourneyId(selectedJourneyId || 'auto');
  }, [selectedJourneyId]);

  useEffect(() => {
    const pollingError = executionPolling.error;
    if (!pollingError) return;
    if (pollingError === 'Aguardando registro da execução...') return;
    if (isTransientNetworkFailure(pollingError)) return;
    notifyError(pollingError);
  }, [executionPolling.error, isTransientNetworkFailure, notifyError]);

  useEffect(() => {
    loadScenarios().catch((err) => notifyRequestError(err, 'Falha ao carregar cenários'));
  }, [filters.wave, filters.journey, filters.status, filters.source, notifyRequestError]);

  async function enqueueScenarios(scenarioIds, successMessage) {
    const safeIds = Array.from(new Set((scenarioIds || []).filter(Boolean)));
    if (safeIds.length === 0) {
      notifyError('Nenhum cenário encontrado para execução');
      return;
    }

    await fetchJson('/api/test-executions', {
      method: 'POST',
      body: JSON.stringify({
        source: 'qa_waves',
        mode: 'real',
        scenarioIds: safeIds,
      }),
    });

    notifySuccess(successMessage);
    await Promise.all([loadJourneyStatus(), loadStepStatus()]);
  }

  function updateScenarioEditor(mutator) {
    try {
      const parsed = JSON.parse(scenarioEditor);
      const updated = mutator(parsed);
      setScenarioEditor(JSON.stringify(updated, null, 2));
    } catch {
      notifyError('Dados do cenário inválidos para edição');
    }
  }

  function loadScenarioInEditor(scenarioId) {
    const item = scenarioItems.find((scenario) => scenario.id === scenarioId);
    if (!item) return;
    const itemWithSemanticSteps = ensureScenarioSemanticSteps(item);
    setSelectedScenarioId(itemWithSemanticSteps.id);
    setSelectedSeedId(itemWithSemanticSteps.seeds?.[0]?.id || '');
    if (itemWithSemanticSteps.vertical) {
      setSelectedDomainId(itemWithSemanticSteps.vertical);
    }
    if (itemWithSemanticSteps.journeyId) {
      setSelectedJourneyId(itemWithSemanticSteps.journeyId);
      setInferenceJourneyId(itemWithSemanticSteps.journeyId);
    }
    setScenarioEditor(JSON.stringify(itemWithSemanticSteps, null, 2));
  }

  function createBlankScenario() {
    const vertical = selectedDomain?.id || selectedDomainId || 'fitness';
    const journeyId = inferenceJourneyId !== 'auto' ? inferenceJourneyId : (selectedJourneyId || 'leads');
    const ts = Date.now();
    const blank = {
      id: `${vertical}-${journeyId}-novo@v1`,
      name: 'Novo cenário',
      description: '',
      vertical,
      journeyId,
      status: 'draft',
      source: 'manual',
      version: 'v1',
      risk: 'medium',
      priority: 'medium',
      channels: ['whatsapp'],
      steps: [],
      seeds: [],
      createdAt: new Date(ts).toISOString(),
      updatedAt: new Date(ts).toISOString(),
    };
    setSelectedScenarioId('');
    setScenarioEditor(JSON.stringify(blank, null, 2));
  }

  async function inferScenario() {
    try {
      const channels = ['whatsapp', 'chat'];
      const response = await fetchJson('/api/qa-waves/infer-scenario', {
        method: 'POST',
        body: JSON.stringify({
          vertical: selectedDomain?.id || 'fitness',
          ...(inferenceJourneyId !== 'auto' ? { journeyId: inferenceJourneyId } : {}),
          goal: inferGoal,
          channels,
          constraints: {
            semanticStepsOnly: true,
            platformCompatibleOnly: true,
            generateSeeds: true,
          },
        }),
      });

      setScenarioEditor(JSON.stringify(response.scenario, null, 2));
      setSelectedScenarioId(response.scenario?.id || '');
      if (response.scenario?.vertical) setSelectedDomainId(response.scenario.vertical);
      if (response.scenario?.journeyId) setSelectedJourneyId(response.scenario.journeyId);
      notifySuccess('Cenário inferido por IA e normalizado para passos semânticos.');
    } catch (err) {
      notifyError(err?.message || 'Falha ao inferir cenário com IA');
    }
  }

  // ─── Revisão de Jornada (inferir → desalinhamento → ajustar → re-inferir →
  //      aprovar → atualizar) ───────────────────────────────────────────────

  function resolveReviewJourneyId() {
    return inferenceJourneyId !== 'auto' ? inferenceJourneyId : (selectedJourneyId || 'leads');
  }

  async function reviewJourney() {
    const vertical = selectedDomainId || 'fitness';
    const journeyId = resolveReviewJourneyId();
    if (!journeyId) {
      notifyError('Selecione uma jornada para revisar.');
      return;
    }
    setLoadingJourneyReview(true);
    setJourneyReview(null);
    try {
      const data = await fetchJson('/api/qa-waves/review-journey/infer', {
        method: 'POST',
        body: JSON.stringify({ vertical, journeyId, goal: inferGoal }),
      });
      setJourneyReview(data);
      if (data.inferredScenario) {
        setScenarioEditor(JSON.stringify(data.inferredScenario, null, 2));
        setSelectedScenarioId(data.inferredScenario.id || '');
        if (data.inferredScenario.vertical) setSelectedDomainId(data.inferredScenario.vertical);
        if (data.inferredScenario.journeyId) setSelectedJourneyId(data.inferredScenario.journeyId);
      }
      notifySuccess(`Jornada revisada: ${(data.misalignment || []).length} desalinhamento(s), ${(data.suggestions || []).length} sugestão(ões).`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao revisar a jornada');
    } finally {
      setLoadingJourneyReview(false);
    }
  }

  async function reInferJourney() {
    const vertical = selectedDomainId || 'fitness';
    const journeyId = resolveReviewJourneyId();
    let baseScenario = null;
    try { baseScenario = JSON.parse(scenarioEditor); } catch (_) { baseScenario = null; }
    setLoadingJourneyReview(true);
    try {
      const data = await fetchJson('/api/qa-waves/review-journey/infer', {
        method: 'POST',
        body: JSON.stringify({ vertical, journeyId, goal: inferGoal, baseScenario }),
      });
      setJourneyReview(data);
      if (data.inferredScenario) {
        setScenarioEditor(JSON.stringify(data.inferredScenario, null, 2));
        setSelectedScenarioId(data.inferredScenario.id || '');
      }
      notifySuccess('Nova inferência concluída. Revise o resultado e aprove.');
    } catch (err) {
      notifyError(err?.message || 'Falha na nova inferência');
    } finally {
      setLoadingJourneyReview(false);
    }
  }

  async function approveJourneyReview() {
    let scenario;
    try {
      scenario = JSON.parse(scenarioEditor);
    } catch (_) {
      notifyError('Editor com JSON inválido. Corrija antes de aprovar.');
      return;
    }
    try {
      const data = await fetchJson('/api/qa-waves/review-journey/apply', {
        method: 'POST',
        body: JSON.stringify({
          scenario,
          approved: true,
          reviewToken: journeyReview?.reviewToken,
          changes: ['revisão de jornada aprovada'],
        }),
      });
      setScenarioEditor(JSON.stringify(data.scenario, null, 2));
      setSelectedScenarioId(data.scenario?.id || '');
      await loadScenarios();
      notifySuccess(`Jornada atualizada (versão ${data.scenario?.version}).`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao aprovar e atualizar a jornada');
    }
  }

  async function validateScenario() {
    try {
      const scenario = JSON.parse(scenarioEditor);
      const response = await fetchJson('/api/qa-waves/validate-scenario', {
        method: 'POST',
        body: JSON.stringify({ scenario }),
      });
      setScenarioEditor(JSON.stringify(response.normalizedScenario, null, 2));
      if (!response.valid) {
        notifyError(`Validação falhou com ${response.errors?.length || 0} erro(s)`);
        return;
      }
      notifySuccess(`Cenário válido (${response.warnings?.length || 0} aviso(s)).`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao validar cenário');
    }
  }

  async function saveScenario() {
    try {
      const scenario = JSON.parse(scenarioEditor);
      const response = await fetchJson('/api/qa-waves/save-scenario', {
        method: 'POST',
        body: JSON.stringify({ scenario, changedBy: 'manual', changes: ['edicao manual via /dev/qa-waves'] }),
      });
      setScenarioEditor(JSON.stringify(response.scenario, null, 2));
      setSelectedScenarioId(response.scenario?.id || '');
      notifySuccess(`Cenário salvo com versão ${response.scenario?.version}.`);
      await loadScenarios();
    } catch (err) {
      notifyError(err?.message || 'Falha ao salvar cenário');
    }
  }

  async function generateSeeds() {
    try {
      const scenario = JSON.parse(scenarioEditor);
      const response = await fetchJson('/api/qa-waves/generate-seeds', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId: scenario.id,
          count: 5,
          variationTypes: ['persona', 'behavior', 'edge_case', 'channel'],
        }),
      });

      setScenarioEditor(JSON.stringify({ ...scenario, seeds: response.seeds || [] }, null, 2));
      notifySuccess(`Seeds geradas por IA: ${(response.seeds || []).length}.`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao gerar seeds');
    }
  }

  async function handleDeleteScenario(scenarioId) {
    if (!window.confirm(`Excluir cenário "${scenarioId}"?`)) return;
    try {
      await fetchJson(`/api/qa-waves/scenarios/${encodeURIComponent(scenarioId)}`, { method: 'DELETE' });
      if (selectedScenarioId === scenarioId) setSelectedScenarioId('');
      await loadScenarios();
      notifySuccess('Cenário excluído');
    } catch (err) {
      notifyError(err?.message || 'Falha ao excluir cenário');
    }
  }

  async function handleCreateJourney() {
    const id = newJourneyFields.id.trim();
    const title = newJourneyFields.title.trim();
    const vertical = newJourneyFields.vertical.trim() || selectedDomainId;
    if (!id || !vertical) {
      notifyError('Preencha ID e vertical');
      return;
    }
    try {
      await fetchJson('/api/qa-waves/journeys', {
        method: 'POST',
        body: JSON.stringify({ id, title: title || id, vertical }),
      });
      setNewJourneyFields({ id: '', title: '', vertical: '' });
      setShowNewJourneyForm(false);
      await loadAll();
      notifySuccess('Jornada criada');
    } catch (err) {
      notifyError(err?.message || 'Falha ao criar jornada');
    }
  }

  async function handleDeleteJourney(journeyId, vertical) {
    if (!window.confirm(`Excluir jornada "${journeyId}"?`)) return;
    try {
      await fetchJson(`/api/qa-waves/journeys/${encodeURIComponent(journeyId)}?vertical=${encodeURIComponent(vertical || '')}`, { method: 'DELETE' });
      if (selectedJourneyId === journeyId) setSelectedJourneyId('');
      await loadAll();
      notifySuccess('Jornada excluída');
    } catch (err) {
      notifyError(err?.message || 'Falha ao excluir jornada');
    }
  }

  function updateSeedStatus(seedId, status) {
    updateScenarioEditor((scenario) => ({
      ...scenario,
      source: status === 'regression' ? 'replay_regression' : scenario.source,
      seeds: (scenario.seeds || []).map((seed) => {
        if (seed.id !== seedId) return seed;
        return {
          ...seed,
          status,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }

  function moveStep(stepId, direction) {
    updateScenarioEditor((scenario) => {
      const steps = [...(scenario.steps || [])];
      const index = steps.findIndex((step) => step.id === stepId);
      if (index < 0) return scenario;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= steps.length) return scenario;
      const tmp = steps[index];
      steps[index] = steps[target];
      steps[target] = tmp;
      const reordered = steps.map((step, i) => ({ ...step, order: i + 1 }));
      return { ...scenario, steps: reordered };
    });
  }

  function toggleStep(stepId) {
    updateScenarioEditor((scenario) => ({
      ...scenario,
      steps: (scenario.steps || []).map((step) => (
        step.id === stepId ? { ...step, enabled: step.enabled === false } : step
      )),
    }));
  }

  async function runScenarioReal(targetScenarioIds, options = {}) {
    if (executionPolling.isPolling) {
      notifyError('Já existe uma execução em andamento. Aguarde a conclusão antes de iniciar uma nova onda.');
      return;
    }
    setRunReplayId('');
    setCurrentExecutionId('');
    try {
      const seedIds = Array.isArray(options.seedIds)
        ? options.seedIds.filter(Boolean)
        : (selectedSeedId ? [selectedSeedId] : []);
      const response = await fetchJson('/api/test-executions', {
        method: 'POST',
        body: JSON.stringify({
          source: 'qa_waves',
          scenarioIds: targetScenarioIds,
          seedIds,
          mode: 'real',
          replay: true,
        }),
      });

      if (response?.status === 'blocked') {
        const blocked = Array.isArray(response.blocked) ? response.blocked : [];
        const detail = blocked.length > 0
          ? blocked.map((item) => `${item.scenarioId} (${item.code})`).join(', ')
          : (response.message || 'Nenhum cenário executável localmente.');
        notifyError(`Nenhum cenário executado: ${detail}`);
        await Promise.all([loadJourneyStatus(), loadStepStatus()]);
        return;
      }

      const legacyRun = response?.compatibility || null;
      const resolvedReplayId = response.replayId || legacyRun?.replayId || '';
      setRunReplayId(resolvedReplayId);
      setCurrentExecutionId(response.executionId || '');
      const blockedCount = Array.isArray(response.blocked) ? response.blocked.length : 0;
      notifySuccess(
        blockedCount > 0
          ? `Execução enfileirada (${blockedCount} cenário(s) bloqueado(s) por recurso indisponível). executionId=${response.executionId}`
          : `Execução real enfileirada. executionId=${response.executionId} replayId=${resolvedReplayId || 'n/a'}`
      );
      await Promise.all([loadJourneyStatus(), loadStepStatus()]);
    } catch (err) {
      if (err?.status === 409 || err?.code === 'EXECUTION_ALREADY_RUNNING') {
        notifyError('Já existe uma execução em andamento. Aguarde a conclusão antes de iniciar uma nova onda.');
        return;
      }
      notifyError(err?.message || 'Falha ao executar cenário real via QA Mesh');
    }
  }

  async function openReplayPage(replayId) {
    if (!replayId) {
      notifyError('Nenhum replay disponível para abrir.');
      return;
    }

    try {
      const filename = String(replayId).endsWith('.json') ? String(replayId) : `${replayId}.json`;
      const details = await fetchJson(`/api/test-executions/replays/${encodeURIComponent(filename)}`);
      setActiveReplayDetails(details || null);
    } catch (err) {
      notifyError(err?.message || 'Falha ao abrir replay');
    }
  }

  function openReplayListing(replayId, executionId) {
    const params = new URLSearchParams();
    params.set('source', 'qa-waves');
    if (replayId) params.set('search', replayId);
    if (executionId) params.set('executionId', executionId);
    window.open(`/rpa-replays?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  function getReplayScenarioCandidates(scenarioId) {
    const candidates = new Set();
    if (scenarioId) candidates.add(String(scenarioId));

    const selectedScenario = (scenarioItems || []).find((item) => item?.id === scenarioId);
    const platformIds = Array.isArray(selectedScenario?.platform?.platformScenarioIds)
      ? selectedScenario.platform.platformScenarioIds
      : [];

    for (const platformId of platformIds) {
      if (platformId) candidates.add(String(platformId));
    }

    return Array.from(candidates);
  }

  async function findLatestReplayIdByScenario(scenarioId) {
    const scenarioCandidates = getReplayScenarioCandidates(scenarioId);
    if (scenarioCandidates.length === 0) return null;

    const page = await fetchJson('/api/test-executions/replays?limit=200&offset=0');
    const files = Array.isArray(page?.files) ? page.files : [];

    const candidate = files.find((item) => {
      return scenarioCandidates.includes(String(item?.scenarioId || ''));
    });

    return candidate?.replayId || null;
  }

  async function handleExecuteJourney() {
    try {
      // Novo modelo: extrair IDs de cenários do estado scenarioItems filtrado por journeyId
      const journeyScenarios = scenarioItems.filter(
        (scenario) => scenario.journeyId === selectedJourney?.journeyId
      );
      const scenarioIds = journeyScenarios.map((scenario) => scenario.id);

      await enqueueScenarios(scenarioIds, `Execução da jornada ${selectedJourney?.journeyName || ''} enfileirada com sucesso`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao enfileirar execução da jornada');
    }
  }

  async function handleExecuteDomain() {
    try {
      await enqueueScenarios(
        domainSummary.scenarioIds,
        `Execução do domínio ${selectedDomain?.name || ''} enfileirada com sucesso`
      );
    } catch (err) {
      notifyError(err?.message || 'Falha ao enfileirar execução do domínio');
    }
  }

  async function handleExecuteStep(stepId) {
    try {
      // Novo modelo: extrair IDs de cenários do estado scenarioItems filtrado por journeyId
      const stepScenarios = scenarioItems.filter(
        (scenario) => scenario.journeyId === selectedJourney?.journeyId
      );
      const scenarioIds = stepScenarios.map((scenario) => scenario.id);

      const step = (selectedJourney?.steps || []).find((item) => item.stepId === stepId);
      await enqueueScenarios(scenarioIds, `Execução do passo ${step?.stepName || stepId} enfileirada com sucesso`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao enfileirar execução do passo');
    }
  }

  async function handleExecuteScenario(scenarioId) {
    try {
      await enqueueScenarios([scenarioId], `Execução do cenário ${scenarioId} enfileirada com sucesso`);
    } catch (err) {
      notifyError(err?.message || 'Falha ao enfileirar execução do cenário');
    }
  }

  async function handleScenarioReplayDetails(scenarioId) {
    try {
      const replayId = await findLatestReplayIdByScenario(scenarioId);
      if (!replayId) {
        notifyError('Nenhum replay encontrado para este cenário nesta jornada.');
        return;
      }
      await openReplayPage(replayId);
    } catch (err) {
      notifyError(err?.message || 'Falha ao abrir replay do cenário');
    }
  }

  function handleSelectJourney(domainId, journeyId) {
    setSelectedDomainId(domainId);
    setSelectedJourneyId(journeyId);
    setInferenceJourneyId(journeyId || 'auto');
    const firstScenario = (scenarioItems || []).find((s) => s?.journeyId === journeyId);
    if (firstScenario) {
      const firstScenarioWithSemanticSteps = ensureScenarioSemanticSteps(firstScenario);
      setSelectedScenarioId(firstScenarioWithSemanticSteps.id);
      setSelectedSeedId(firstScenarioWithSemanticSteps.seeds?.[0]?.id || '');
      setScenarioEditor(JSON.stringify(firstScenarioWithSemanticSteps, null, 2));
    } else {
      setSelectedScenarioId('');
      setSelectedSeedId('');
      setScenarioEditor('');
    }
  }

  function handleSelectDomain(domainId) {
    const domain = (journeysTree || []).find((item) => item.id === domainId);
    if (!domain) return;
    setSelectedDomainId(domainId);
    const firstJourney = domain.journeys?.[0];
    const nextJourneyId = firstJourney?.journeyId || '';
    setSelectedJourneyId(nextJourneyId);
    setInferenceJourneyId(nextJourneyId || 'auto');
    const firstScenario = (scenarioItems || []).find((s) => s?.journeyId === nextJourneyId);
    if (firstScenario) {
      const firstScenarioWithSemanticSteps = ensureScenarioSemanticSteps(firstScenario);
      setSelectedScenarioId(firstScenarioWithSemanticSteps.id);
      setSelectedSeedId(firstScenarioWithSemanticSteps.seeds?.[0]?.id || '');
      setScenarioEditor(JSON.stringify(firstScenarioWithSemanticSteps, null, 2));
    } else {
      setSelectedScenarioId('');
      setSelectedSeedId('');
      setScenarioEditor('');
    }
  }

  function labelJourneySource(source) {
    if (source === 'ai') return 'IA';
    if (source === 'inferred') return 'Template';
    if (source === 'manual') return 'Manual';
    return source || 'n/a';
  }

  function updateJourneySteps(rawValue) {
    const nextSteps = String(rawValue || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    updateScenarioEditor((scenario) => ({
      ...scenario,
      journeySteps: nextSteps,
      steps: Array.isArray(scenario.steps) && scenario.steps.length > 0
        ? scenario.steps
        : createSemanticStepsFromJourneySteps(nextSteps),
      journeySource: 'manual',
    }));
  }

  const filteredExecutionItems = (executionItems || []).filter((item) => {
    const createdAt = new Date(item.createdAt || item.startedAt || 0).getTime();
    const replayArtifact = item.replayArtifacts?.[0] || {};
    const waveId = String(replayArtifact.waveId || item.waveId || '').toLowerCase();
    const journeyId = String(replayArtifact.journeyId || item.journeyId || '').toLowerCase();
    const byWave = !executionFilterWave || waveId.includes(executionFilterWave.toLowerCase());
    const byJourney = !executionFilterJourney || journeyId.includes(executionFilterJourney.toLowerCase());
    const byDateStart = !executionDateTimeStart || createdAt >= new Date(executionDateTimeStart).getTime();
    const byDateEnd = !executionDateTimeEnd || createdAt <= new Date(executionDateTimeEnd).getTime();
    return byWave && byJourney && byDateStart && byDateEnd;
  });

  return (
    <>
      <div className="qa-waves-page" data-testid="qa-waves-page">
      <header className="qa-waves-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 className="qa-waves-title" data-testid="qa-waves-title">QA Waves Integrado</h1>
            <p className="qa-waves-subtitle">
              Opera na mesma API e frontend do r-agent2, sem porta adicional.
            </p>
          </div>
          <div
            className="flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-3 py-1.5"
            title={wsStatus.title}
            style={{ flexShrink: 0, marginTop: 4 }}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${wsStatus.indicatorDotClassName}`} />
            <span className="text-sm text-text-secondary">{wsStatus.label}</span>
          </div>
        </div>
      </header>

      {/* Navegação por domínio */}
      <nav className="qa-domain-pills" aria-label="Verticais">
        {(journeysTree || []).map((domain) => (
          <button
            key={domain.id}
            type="button"
            onClick={() => handleSelectDomain(domain.id)}
            className={`qa-domain-pill${selectedDomainId === domain.id ? ' qa-domain-pill--active' : ''}`}
            aria-pressed={selectedDomainId === domain.id}
          >
            {domain.name || domain.id}
          </button>
        ))}
      </nav>
      {currentExecutionId && (
        <div style={{ marginBottom: '16px' }}>
          <ExecutionProgress
            status={executionPolling.status}
            progress={executionPolling.progress}
            currentStep={executionPolling.currentStep}
            summary={executionPolling.summary}
            durationMs={executionPolling.durationMs}
            onCancel={() => {
              setCurrentExecutionId('');
              executionPolling.stopPolling();
            }}
          />
        </div>
      )}

      <div className="qa-waves-business-main">
        <section className="qa-waves-panel qa-waves-business-sidebar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="qa-waves-section-title">Domínio e Jornada</h2>
            <button
              type="button"
              title="Nova jornada"
              onClick={() => setShowNewJourneyForm((v) => !v)}
              className="qa-btn-ghost"
            >
              + Jornada
            </button>
          </div>
          {showNewJourneyForm && (
            <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 10, marginBottom: 8, display: 'grid', gap: 6 }}>
              <input
                type="text"
                placeholder="ID (ex: leads)"
                value={newJourneyFields.id}
                onChange={(e) => setNewJourneyFields((f) => ({ ...f, id: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Título (opcional)"
                value={newJourneyFields.title}
                onChange={(e) => setNewJourneyFields((f) => ({ ...f, title: e.target.value }))}
              />
              <input
                type="text"
                placeholder={`Vertical (padrão: ${selectedDomainId || 'fitness'})`}
                value={newJourneyFields.vertical}
                onChange={(e) => setNewJourneyFields((f) => ({ ...f, vertical: e.target.value }))}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="qa-btn-primary" onClick={handleCreateJourney}>Criar</button>
                <button type="button" onClick={() => setShowNewJourneyForm(false)}>Cancelar</button>
              </div>
            </div>
          )}
          <JourneyTree
            domains={sidebarTree}
            selectedDomainId={selectedDomainId}
            selectedJourneyId={selectedJourneyId}
            onSelectJourney={handleSelectJourney}
            onDeleteJourney={handleDeleteJourney}
          />
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <section className="qa-waves-panel qa-waves-business-content" style={{ marginBottom: 0 }}>
          <h2 className="qa-waves-section-title">Jornada e Cenários</h2>
          <article className="qa-domain-summary-card">
            <h3>Resumo consolidado do domínio</h3>
            <div className="qa-domain-summary-metrics">
              <div>
                <strong>{domainSummary.totalItems}</strong>
                <span>Cenários</span>
              </div>
              <div>
                <strong>{domainSummary.criticalItems}</strong>
                <span>Críticos</span>
              </div>
              <div>
                <strong>{domainSummary.coverage}%</strong>
                <span>Cobertura</span>
              </div>
            </div>
          </article>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div className="qa-journey-actions-buttons">
              <select value={selectedSeedId} onChange={(event) => setSelectedSeedId(event.target.value)}>
                <option value="">Todas as seeds</option>
                {(parsedScenario?.seeds || []).map((seed) => (
                  <option key={seed.id} value={seed.id}>{seed.id}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => runScenarioReal([selectedScenarioId])}
                disabled={!selectedScenarioId || executionPolling.isPolling}
                className="qa-btn-primary"
                data-testid="qa-waves-run-button"
                title={executionPolling.isPolling ? 'Execução em andamento. Aguarde a conclusão.' : ''}
              >
                ▶ Executar cenário
              </button>
              <button
                type="button"
                onClick={() => runScenarioReal([selectedScenarioId], { seedIds: (parsedScenario?.seeds || []).map((seed) => seed.id) })}
                disabled={!selectedScenarioId || (parsedScenario?.seeds || []).length === 0 || executionPolling.isPolling}
                title={executionPolling.isPolling ? 'Execução em andamento. Aguarde a conclusão.' : ''}
              >
                ▶ Executar seeds
              </button>
              <button
                type="button"
                onClick={() => openReplayPage(runReplayId)}
                disabled={!runReplayId}
              >
                ↗ Abrir replay
              </button>
            </div>
            <div className="qa-journey-actions-buttons">
              <input
                type="text"
                value={inferGoal}
                onChange={(event) => setInferGoal(event.target.value)}
                placeholder="Objetivo para inferência IA"
              />
              <select value={inferenceJourneyId} onChange={(event) => setInferenceJourneyId(event.target.value)}>
                <option value="auto">Jornada automática</option>
                {availableJourneys.map((journey) => (
                  <option key={journey.journeyId} value={journey.journeyId}>{journey.journeyName}</option>
                ))}
              </select>
              <button type="button" onClick={inferScenario}>✦ IA</button>
              <button
                type="button"
                onClick={reviewJourney}
                disabled={loadingJourneyReview}
                className="qa-btn-primary"
                data-testid="qa-waves-review-journey-button"
                title="Inferir a jornada, mostrar desalinhamentos e sugerir correções"
              >
                {loadingJourneyReview ? 'Revisando…' : '🔍 Revisar jornada'}
              </button>
              <button type="button" onClick={validateScenario}>✓ Validar</button>
              <button type="button" onClick={saveScenario}>⎘ Salvar</button>
              <button type="button" onClick={createBlankScenario}>+ Novo</button>
              <button type="button" onClick={generateSeeds}>◎ Seeds</button>
              <button type="button" onClick={() => setShowExecutionsModal(true)}>▣ Execuções</button>
            </div>
          </div>

          {journeyReview && (
            <div
              data-testid="qa-waves-journey-review-panel"
              style={{
                border: '1px solid var(--color-border-default)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
                background: 'var(--color-bg-elevated)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>🔍 Revisão da Jornada {journeyReview.journeyId}</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={reInferJourney} disabled={loadingJourneyReview}>
                    {loadingJourneyReview ? 'Inferindo…' : '↻ Nova inferência'}
                  </button>
                  <button
                    type="button"
                    onClick={approveJourneyReview}
                    className="qa-btn-primary"
                    disabled={loadingJourneyReview || !journeyReview.reviewToken}
                  >
                    ✓ Aprovar e atualizar jornada
                  </button>
                </div>
              </div>

              {(journeyReview.misalignment || []).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>Desalinhamentos ({journeyReview.misalignment.length})</strong>
                  <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                    {journeyReview.misalignment.map((item, i) => (
                      <li key={i} style={{ marginBottom: 3 }}>
                        <span style={{
                          color: item.severity === 'critical' ? 'var(--color-status-error)'
                            : item.severity === 'warning' ? 'var(--color-status-warning)'
                            : 'var(--color-text-secondary)',
                          fontWeight: 600,
                        }}>
                          [{item.type}]
                        </span>{' '}
                        {item.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(journeyReview.suggestions || []).length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    Falhas/gaps e correções sugeridas ({journeyReview.suggestions.length})
                  </summary>
                  <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                    {journeyReview.suggestions.map((sug, i) => (
                      <li key={i} style={{ marginBottom: 3 }}>
                        <span style={{ color: 'var(--color-status-warning)', fontWeight: 600 }}>[{sug.source}]</span>{' '}
                        {sug.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {journeyReview.inferredScenario && (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
                  Proposta no editor abaixo (id: {journeyReview.inferredScenario.id}). Ajuste, clique em "↻ Nova inferência" e depois aprove.
                </div>
              )}
            </div>
          )}

          {showExecutionsModal && (
            <div
              style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onClick={(e) => { if (e.target === e.currentTarget) setShowExecutionsModal(false); }}
            >
              <div style={{
                background: 'var(--color-bg-elevated)',
                borderRadius: 10,
                padding: 24,
                width: '90%', maxWidth: 860,
                maxHeight: '80vh', overflowY: 'auto',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                position: 'relative',
              }}>
                <button
                  type="button"
                  onClick={() => setShowExecutionsModal(false)}
                  style={{ position: 'absolute', top: 12, right: 16, fontSize: 20, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                  title="Fechar"
                >✕</button>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Execuções reais QA Waves</h3>
                  <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                    <input
                      type="text"
                      value={executionFilterWave}
                      onChange={(event) => setExecutionFilterWave(event.target.value)}
                      placeholder="Filtrar wave"
                      title="Filtrar replay por wave"
                    />
                    <input
                      type="text"
                      value={executionFilterJourney}
                      onChange={(event) => setExecutionFilterJourney(event.target.value)}
                      placeholder="Filtrar jornada"
                      title="Filtrar replay por jornada"
                    />
                    <input
                      type="datetime-local"
                      value={executionDateTimeStart}
                      onChange={(event) => setExecutionDateTimeStart(event.target.value)}
                      title="Filtrar execuções a partir de"
                    />
                    <input
                      type="datetime-local"
                      value={executionDateTimeEnd}
                      onChange={(event) => setExecutionDateTimeEnd(event.target.value)}
                      title="Filtrar execuções até"
                    />
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '0 4px' }}>
                      Atualização automática ativa
                    </span>
                  </div>
                </div>

                {filteredExecutionItems.length === 0 ? (
                  <p className="qa-empty">Nenhuma execução real encontrada para o filtro atual.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {filteredExecutionItems.map((execution) => {
                      const replayId = execution.replayArtifacts?.[0]?.replayId || '';
                      const replayWaveId = execution.replayArtifacts?.[0]?.waveId || execution.waveId || 'n/a';
                      const replayJourneyId = execution.replayArtifacts?.[0]?.journeyId || execution.journeyId || 'n/a';
                      const liveStatus = execution.executionId === currentExecutionId && executionPolling.status !== 'idle'
                        ? executionPolling.status
                        : execution.status;
                      const isApiAdapter = (execution.replayArtifacts || []).some(
                        (a) => a.platformAdapter === 'api',
                      ) || (execution.replayArtifacts || []).length === 0 && execution.platformAdapter === 'api';

                      return (
                        <div
                          key={execution.executionId}
                          style={{
                            border: execution.executionId === currentExecutionId ? '2px solid var(--color-accent-primary)' : '1px solid var(--color-border-default)',
                            borderRadius: 8,
                            padding: 10,
                            background: execution.executionId === currentExecutionId ? 'var(--color-accent-light)' : 'var(--color-bg-elevated)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                              <strong>{execution.executionId}</strong>
                              {isApiAdapter && (
                                <span
                                  title="Este cenário usa adapter:api (sem Playwright/RPA). O padrão é adapter:rpa."
                                  style={{
                                    marginLeft: 8,
                                    display: 'inline-block',
                                    background: 'var(--qa-warning-muted)',
                                    border: '1px solid var(--color-status-warning)',
                                    color: 'var(--color-status-warning)',
                                    borderRadius: 4,
                                    padding: '2px 7px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    verticalAlign: 'middle',
                                    letterSpacing: 0.3,
                                  }}
                                >
                                  ⚠ Adapter: API
                                </span>
                              )}
                              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                Status: {liveStatus} | Criado em: {execution.createdAt ? new Date(execution.createdAt).toLocaleString('pt-BR') : 'n/a'}
                              </div>
                            </div>
                            <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                              <button
                                type="button"
                                onClick={() => openReplayPage(replayId)}
                                disabled={!replayId}
                              >
                                ↗ Abrir replay
                              </button>
                              <button
                                type="button"
                                onClick={() => openReplayListing(replayId, execution.executionId)}
                              >
                                🔎 Abrir em /rpa-replays
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: 12, marginTop: 6 }}>
                            Wave: {replayWaveId} | Jornada: {replayJourneyId}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            Replays: {(execution.replayArtifacts || []).map((artifact) => artifact.replayId).filter(Boolean).join(', ') || 'n/a'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <JourneyStatusCard journey={selectedJourney} stepStatuses={selectedJourney?.steps || []} />
          <StepBreakdown
            steps={selectedJourney?.steps || []}
            scenarios={selectedJourneyScenarios}
            onExecuteStep={handleExecuteStep}
            onExecuteScenario={handleExecuteScenario}
            onReplayScenario={handleScenarioReplayDetails}
          />

        </section>

          <section className="qa-waves-panel qa-waves-business-content" style={{ marginBottom: 0 }}>
            <div className="qa-journey-actions">
              <h2 className="qa-waves-section-title">Cenários</h2>
            </div>
            <div className="qa-scenario-editor-grid">
              <div className="qa-scenario-list-panel">
                {(scenarioItems || [])
                  .filter((item) => {
                    const byDomain = !selectedDomainId || !item.vertical || item.vertical === selectedDomainId;
                    const byScenario = !filters.scenario || `${item.id} ${item.name}`.toLowerCase().includes(filters.scenario.toLowerCase());
                    const bySeed = !filters.seed || (item.seeds || []).some((seed) => String(seed.id).toLowerCase().includes(filters.seed.toLowerCase()));
                    const byDateStart = !filters.dateStart || new Date(item.updatedAt || item.createdAt || 0).getTime() >= new Date(`${filters.dateStart}T00:00:00`).getTime();
                    const byDateEnd = !filters.dateEnd || new Date(item.updatedAt || item.createdAt || 0).getTime() <= new Date(`${filters.dateEnd}T23:59:59`).getTime();
                    return byDomain && byScenario && bySeed && byDateStart && byDateEnd;
                  })
                  .map((item) => {
                    const selected = item.id === selectedScenarioId;
                    const sourceBadge = item.source === 'ai_inferred' ? 'IA' : item.source === 'replay_regression' ? 'Regressao' : 'Manual';
                    return (
                      <div key={`${item.id}-${item.version}`} style={{ position: 'relative', marginBottom: 6 }}>
                        <button
                          type="button"
                          onClick={() => loadScenarioInEditor(item.id)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            borderRadius: 6,
                            border: selected ? '2px solid var(--color-accent-primary)' : '1px solid var(--color-border-default)',
                            padding: 8,
                            paddingRight: 32,
                            background: selected ? 'var(--color-accent-light)' : 'var(--color-bg-elevated)',
                          }}
                        >
                          <div className="font-semibold">{item.name}</div>
                          <div style={{ fontSize: 12 }}>{item.id}@{item.version}</div>
                          <div style={{ fontSize: 12 }}>Status: {item.status} | Origem: {sourceBadge}</div>
                        </button>
                        <button
                          type="button"
                          title="Excluir cenário"
                          aria-label="Excluir cenário"
                          onClick={(e) => { e.stopPropagation(); handleDeleteScenario(item.id); }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-status-error)',
                            fontSize: 14,
                            lineHeight: 1,
                            padding: '2px 4px',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
              </div>

              <div>
                {!parsedScenario ? (
                  <p className="qa-empty">Selecione um cenário válido para habilitar a edição guiada.</p>
                ) : (
                  <div style={{ marginTop: 4 }}>
                    <h4>Edição guiada do cenário</h4>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8, marginBottom: 10 }} open>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Jornada dinâmica</summary>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          Vertical
                          <input
                            type="text"
                            value={parsedScenario.vertical || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, vertical: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Jornada
                          <input
                            type="text"
                            value={parsedScenario.journeyId || parsedScenario.journey || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({
                              ...scenario,
                              journeyId: event.target.value,
                              journey: event.target.value,
                              journeySource: 'manual',
                            }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Origem
                          <input type="text" value={labelJourneySource(parsedScenario.journeySource)} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Template base
                          <input type="text" value={parsedScenario.baseTemplateId || 'customer_lifecycle_v1'} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                          Steps da jornada
                          <textarea
                            value={(parsedScenario.journeySteps || []).join('\n')}
                            rows={6}
                            onChange={(event) => updateJourneySteps(event.target.value)}
                          />
                        </label>
                      </div>
                    </details>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Dados gerais</summary>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          Nome
                          <input
                            type="text"
                            value={parsedScenario.name || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, name: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Versão
                          <input type="text" value={parsedScenario.version || ''} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                          Descrição
                          <textarea
                            value={parsedScenario.description || ''}
                            rows={3}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, description: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Risco
                          <select
                            value={parsedScenario.risk || 'medium'}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, risk: event.target.value }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Prioridade
                          <select
                            value={parsedScenario.priority || 'medium'}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, priority: event.target.value }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>

                        <fieldset style={{ gridColumn: '1 / -1', border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 8 }}>
                          <legend>Canais</legend>
                          <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                            {['whatsapp', 'chat', 'email', 'voice'].map((channel) => {
                              const selected = Array.isArray(parsedScenario.channels) && parsedScenario.channels.includes(channel);
                              return (
                                <label key={channel} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => updateScenarioEditor((scenario) => {
                                      const current = Array.isArray(scenario.channels) ? scenario.channels : [];
                                      const next = current.includes(channel)
                                        ? current.filter((item) => item !== channel)
                                        : [...current, channel];
                                      return { ...scenario, channels: next };
                                    })}
                                  />
                                  {channel}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      </div>
                    </details>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Passos semânticos</summary>
                      <div style={{ marginTop: 8 }}>
                        {(parsedScenario.steps || []).map((step) => (
                          <div key={step.id} className="qa-step-editor-row">
                            <span className="qa-step-editor-title">{step.order}. {formatStepTypeLabel(step.type)} ({step.enabled === false ? 'desativado' : 'ativo'})</span>
                            <button type="button" onClick={() => moveStep(step.id, 'up')} title="Subir passo">↑</button>
                            <button type="button" onClick={() => moveStep(step.id, 'down')} title="Descer passo">↓</button>
                            <button
                              type="button"
                              onClick={() => toggleStep(step.id)}
                              title={step.enabled === false ? 'Ativar passo' : 'Desativar passo'}
                              aria-label={step.enabled === false ? 'Ativar passo' : 'Desativar passo'}
                            >
                              {step.enabled === false ? '▶' : '⏻'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Seeds</summary>
                      <div style={{ marginTop: 8 }}>
                        <div className="qa-journey-actions-buttons" style={{ marginBottom: 8 }}>
                          <select value={selectedSeedId} onChange={(event) => setSelectedSeedId(event.target.value)}>
                            <option value="">Todas as seeds</option>
                            {(parsedScenario.seeds || []).map((seed) => (
                              <option key={seed.id} value={seed.id}>{seed.id}</option>
                            ))}
                          </select>
                        </div>

                        {(parsedScenario.seeds || []).map((seed) => {
                          const sourceBadge = seed.status === 'regression' ? 'Regressao' : (parsedScenario.source === 'ai_inferred' ? 'IA' : 'Manual');
                          return (
                            <div key={seed.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <strong>{seed.id}</strong>
                                <span>{sourceBadge}</span>
                              </div>
                              <div style={{ fontSize: 12 }}>Status: {seed.status} | Persona: {seed.persona?.type || 'n/a'}</div>
                              <div className="qa-journey-actions-buttons" style={{ marginTop: 6 }}>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'reviewed')}>◔ Revisar</button>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'approved')}>✓ Aprovar</button>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'regression')}>↺ Regressão</button>
                                <button
                                  type="button"
                                  onClick={() => updateSeedStatus(seed.id, 'disabled')}
                                  title="Desativar seed"
                                  aria-label="Desativar seed"
                                >
                                  ⏻
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Seção: Cobertura e Gaps (escopada por domínio) */}
      <CoverageGapsTab domainId={selectedDomainId} />

      {/* Seção: Documentação (escopada por domínio) */}
      <QaWavesDocsTab domainId={selectedDomainId} />

      {/* bloco antigo removido */}
      {false && (
        <article>
          <div>
              <div>
                {(scenarioItems || [])
                  .filter((item) => {
                    const byJourney = !selectedJourneyId || item.journeyId === selectedJourneyId;
                    const byScenario = !filters.scenario || `${item.id} ${item.name}`.toLowerCase().includes(filters.scenario.toLowerCase());
                    const bySeed = !filters.seed || (item.seeds || []).some((seed) => String(seed.id).toLowerCase().includes(filters.seed.toLowerCase()));
                    const byDateStart = !filters.dateStart || new Date(item.updatedAt || item.createdAt || 0).getTime() >= new Date(`${filters.dateStart}T00:00:00`).getTime();
                    const byDateEnd = !filters.dateEnd || new Date(item.updatedAt || item.createdAt || 0).getTime() <= new Date(`${filters.dateEnd}T23:59:59`).getTime();
                    return byJourney && byScenario && bySeed && byDateStart && byDateEnd;
                  })
                  .map((item) => {
                    const selected = item.id === selectedScenarioId;
                    const sourceBadge = item.source === 'ai_inferred' ? 'IA' : item.source === 'replay_regression' ? 'Regressao' : 'Manual';
                    return (
                      <div key={`${item.id}-${item.version}`} style={{ position: 'relative', marginBottom: 6 }}>
                        <button
                          type="button"
                          onClick={() => loadScenarioInEditor(item.id)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            borderRadius: 6,
                            border: selected ? '2px solid var(--color-accent-primary)' : '1px solid var(--color-border-default)',
                            padding: 8,
                            paddingRight: 32,
                            background: selected ? 'var(--color-accent-light)' : 'var(--color-bg-elevated)',
                          }}
                        >
                          <div className="font-semibold">{item.name}</div>
                          <div style={{ fontSize: 12 }}>{item.id}@{item.version}</div>
                          <div style={{ fontSize: 12 }}>Status: {item.status} | Origem: {sourceBadge}</div>
                        </button>
                        <button
                          type="button"
                          title="Excluir cenário"
                          aria-label="Excluir cenário"
                          onClick={(e) => { e.stopPropagation(); handleDeleteScenario(item.id); }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-status-error)',
                            fontSize: 14,
                            lineHeight: 1,
                            padding: '2px 4px',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
              </div>

              <div>
                {!parsedScenario ? (
                  <p className="qa-empty">Selecione um cenário válido para habilitar a edição guiada.</p>
                ) : (
                  <div style={{ marginTop: 4 }}>
                    <h4>Edição guiada do cenário</h4>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8, marginBottom: 10 }} open>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Jornada dinâmica</summary>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          Vertical
                          <input
                            type="text"
                            value={parsedScenario.vertical || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, vertical: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Jornada
                          <input
                            type="text"
                            value={parsedScenario.journeyId || parsedScenario.journey || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({
                              ...scenario,
                              journeyId: event.target.value,
                              journey: event.target.value,
                              journeySource: 'manual',
                            }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Origem
                          <input type="text" value={labelJourneySource(parsedScenario.journeySource)} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Template base
                          <input type="text" value={parsedScenario.baseTemplateId || 'customer_lifecycle_v1'} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                          Steps da jornada
                          <textarea
                            value={(parsedScenario.journeySteps || []).join('\n')}
                            rows={6}
                            onChange={(event) => updateJourneySteps(event.target.value)}
                          />
                        </label>
                      </div>
                    </details>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Dados gerais</summary>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          Nome
                          <input
                            type="text"
                            value={parsedScenario.name || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, name: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Versão
                          <input type="text" value={parsedScenario.version || ''} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                          Descrição
                          <textarea
                            value={parsedScenario.description || ''}
                            rows={3}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, description: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Risco
                          <select
                            value={parsedScenario.risk || 'medium'}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, risk: event.target.value }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Prioridade
                          <select
                            value={parsedScenario.priority || 'medium'}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, priority: event.target.value }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>

                        <fieldset style={{ gridColumn: '1 / -1', border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 8 }}>
                          <legend>Canais</legend>
                          <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                            {['whatsapp', 'chat', 'email', 'voice'].map((channel) => {
                              const selected = Array.isArray(parsedScenario.channels) && parsedScenario.channels.includes(channel);
                              return (
                                <label key={channel} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => updateScenarioEditor((scenario) => {
                                      const current = Array.isArray(scenario.channels) ? scenario.channels : [];
                                      const next = current.includes(channel)
                                        ? current.filter((item) => item !== channel)
                                        : [...current, channel];
                                      return { ...scenario, channels: next };
                                    })}
                                  />
                                  {channel}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      </div>
                    </details>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Passos semânticos</summary>
                      <div style={{ marginTop: 8 }}>
                        {(parsedScenario.steps || []).map((step) => (
                          <div key={step.id} className="qa-step-editor-row">
                            <span className="qa-step-editor-title">{step.order}. {formatStepTypeLabel(step.type)} ({step.enabled === false ? 'desativado' : 'ativo'})</span>
                            <button type="button" onClick={() => moveStep(step.id, 'up')} title="Subir passo">↑</button>
                            <button type="button" onClick={() => moveStep(step.id, 'down')} title="Descer passo">↓</button>
                            <button
                              type="button"
                              onClick={() => toggleStep(step.id)}
                              title={step.enabled === false ? 'Ativar passo' : 'Desativar passo'}
                              aria-label={step.enabled === false ? 'Ativar passo' : 'Desativar passo'}
                            >
                              {step.enabled === false ? '▶' : '⏻'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>

                    <details style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Seeds</summary>
                      <div style={{ marginTop: 8 }}>
                        <div className="qa-journey-actions-buttons" style={{ marginBottom: 8 }}>
                          <select value={selectedSeedId} onChange={(event) => setSelectedSeedId(event.target.value)}>
                            <option value="">Todas as seeds</option>
                            {(parsedScenario.seeds || []).map((seed) => (
                              <option key={seed.id} value={seed.id}>{seed.id}</option>
                            ))}
                          </select>
                        </div>

                        {(parsedScenario.seeds || []).map((seed) => {
                          const sourceBadge = seed.status === 'regression' ? 'Regressao' : (parsedScenario.source === 'ai_inferred' ? 'IA' : 'Manual');
                          return (
                            <div key={seed.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <strong>{seed.id}</strong>
                                <span>{sourceBadge}</span>
                              </div>
                              <div style={{ fontSize: 12 }}>Status: {seed.status} | Persona: {seed.persona?.type || 'n/a'}</div>
                              <div className="qa-journey-actions-buttons" style={{ marginTop: 6 }}>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'reviewed')}>◔ Revisar</button>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'approved')}>✓ Aprovar</button>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'regression')}>↺ Regressão</button>
                                <button
                                  type="button"
                                  onClick={() => updateSeedStatus(seed.id, 'disabled')}
                                  title="Desativar seed"
                                  aria-label="Desativar seed"
                                >
                                  ⏻
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          </article>
      )}
      </div>

      <ReplayDetailsModal
        details={activeReplayDetails}
        onClose={() => setActiveReplayDetails(null)}
      />
      <ToastContainer />
    </>
  );
}

export default QaWavesPage;
